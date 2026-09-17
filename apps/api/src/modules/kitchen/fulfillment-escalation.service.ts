import { Injectable, Inject, Logger } from '@nestjs/common';
import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PrismaService } from '../prisma/prisma.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ServiceNotificationService } from './service-notification.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { KdsGateway } from './kds.gateway';

const ESCALATION_POLL_MS = 30_000; // Check every 30 seconds

/**
 * Periodic escalation and reminder service.
 *
 * Checks for unresolved ready notifications that have exceeded the branch's
 * configured reminder/escalation thresholds and creates appropriate notifications.
 */
@Injectable()
export class FulfillmentEscalationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FulfillmentEscalationService.name);
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ServiceNotificationService) private readonly notificationService: ServiceNotificationService,
    @Inject(KdsGateway) private readonly kdsGateway: KdsGateway,
  ) {}

  onModuleInit() {
    this.start();
  }

  onModuleDestroy() {
    this.stop();
  }

  start() {
    if (this.pollTimer) return;
    this.logger.log('Fulfillment escalation service started');
    this.pollTimer = setInterval(() => this.checkEscalations(), ESCALATION_POLL_MS);
  }

  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.logger.log('Fulfillment escalation service stopped');
  }

  /**
   * Check for notifications that need reminders or escalation.
   */
  async checkEscalations() {
    try {
      // Find branches with active fulfillment policies that have escalation configured
      const policies = await this.prisma.branchFulfillmentPolicy.findMany({
        where: {
          OR: [
            { readyReminderSeconds: { gt: 0 } },
            { readyEscalationSeconds: { gt: 0 } },
          ],
        },
        select: {
          tenantId: true,
          branchId: true,
          readyReminderSeconds: true,
          readyEscalationSeconds: true,
        },
      });

      for (const policy of policies) {
        await this.processBranchEscalation(policy);
      }
    } catch (err) {
      this.logger.error(`Escalation check failed: ${err}`);
    }
  }

  private async processBranchEscalation(policy: {
    tenantId: string;
    branchId: string;
    readyReminderSeconds: number | null;
    readyEscalationSeconds: number | null;
  }) {
    const { tenantId, branchId, readyReminderSeconds, readyEscalationSeconds } = policy;

    // Check for reminder threshold
    if (readyReminderSeconds && readyReminderSeconds > 0) {
      const reminders = await this.notificationService.getUnreadyNotificationsForEscalation({
        tenantId,
        branchId,
        olderThanSeconds: readyReminderSeconds,
      });

      for (const notification of reminders) {
        // Send reminder to assigned waiter
        if (notification.assignedUserId) {
          this.kdsGateway.broadcastServiceNotification(
            branchId,
            notification.assignedUserId,
            {
              type: 'reminder',
              notificationId: notification.id,
              orderId: notification.orderId,
              orderNumber: notification.order?.orderNumber,
              tableId: notification.order?.tableId,
              collectionLabel: notification.collectionLabelSnapshot,
              age: Date.now() - new Date(notification.createdAt).getTime(),
            },
          );
        }
      }
    }

    // Check for escalation threshold (notify manager/owner)
    if (readyEscalationSeconds && readyEscalationSeconds > 0) {
      const escalations = await this.notificationService.getUnreadyNotificationsForEscalation({
        tenantId,
        branchId,
        olderThanSeconds: readyEscalationSeconds,
      });

      for (const escalation of escalations) {
        // Create an escalation notification
        await this.notificationService.createEscalation({
          tenantId,
          branchId,
          orderId: escalation.orderId,
          originalNotificationId: escalation.id,
          assignedUserId: escalation.order?.assignedWaiterUserId ?? undefined,
          collectionLabelSnapshot: escalation.collectionLabelSnapshot ?? undefined,
        });

        // Broadcast to the branch operations room
        this.kdsGateway.broadcastToServiceBoard(branchId, 'escalation:ready', {
          orderId: escalation.orderId,
          orderNumber: escalation.order?.orderNumber,
          tableId: escalation.order?.tableId,
          age: Date.now() - new Date(escalation.createdAt).getTime(),
        });
      }
    }
  }
}
