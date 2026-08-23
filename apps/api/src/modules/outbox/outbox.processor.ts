import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PrismaService } from '../prisma/prisma.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { KitchenTicketsService } from '../kitchen/kitchen-tickets.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { FeatureResolver } from '../features/feature-resolver.service';
import { FeatureKey } from '@rms/contracts';
const POLL_INTERVAL_MS = 2000;
const BATCH_SIZE = 10;
const MAX_ATTEMPTS = 5;

@Injectable()
export class OutboxProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxProcessor.name);
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(KitchenTicketsService)
    private readonly kitchenTickets: KitchenTicketsService,
    @Inject(FeatureResolver)
    private readonly featureResolver: FeatureResolver,
  ) {}

  onModuleInit() {
    this.start();
  }

  onModuleDestroy() {
    this.stop();
  }

  start() {
    if (this.pollTimer) return;
    this.logger.log('Outbox processor started');
    this.pollTimer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      this.logger.log('Outbox processor stopped');
    }
  }

  async poll() {
    try {
      const events = await this.prisma.outboxEvent.findMany({
        where: {
          publishedAt: null,
          attemptCount: { lt: MAX_ATTEMPTS },
        },
        orderBy: { occurredAt: 'asc' },
        take: BATCH_SIZE,
      });

      for (const event of events) {
        await this.processEvent(event);
      }
    } catch (err) {
      this.logger.error(`Outbox poll failed: ${err}`);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async processEvent(event: any) {
    try {
      switch (event.eventType) {
        case 'order.confirmed':
          await this.handleOrderConfirmed(event);
          break;
        default:
          this.logger.warn(`Unknown outbox event type: ${event.eventType}`);
      }

      try {
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: { publishedAt: new Date() },
        });
      } catch {
        this.logger.warn(`Outbox event ${event.id} already removed by another process`);
      }
    } catch (err) {
      this.logger.error(`Failed to process outbox event ${event.id}: ${err}`);
      try {
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            attemptCount: { increment: 1 },
            lastError: err instanceof Error ? err.message : String(err),
          },
        });
      } catch {
        this.logger.warn(`Outbox event ${event.id} already removed during error handling`);
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handleOrderConfirmed(event: any) {
    const payload = event.payload as { orderId: string; paymentId: string };

    // Check if KDS is effective for this tenant/branch
    const kdsState = await this.featureResolver.resolve(
      event.tenantId!,
      FeatureKey.KDS,
      event.branchId!,
    );

    if (!kdsState.effective) {
      this.logger.log(
        `KDS disabled for tenant ${event.tenantId} branch ${event.branchId} — skipping kitchen ticket creation for order ${payload.orderId}. Reason: ${kdsState.disabledReason}`,
      );

      // Audit trail: mark that we intentionally skipped ticket creation
      await this.prisma.auditLog.create({
        data: {
          actorUserId: null,
          tenantId: event.tenantId!,
          branchId: event.branchId!,
          action: 'OUTBOX_KDS_SKIP',
          entityType: 'Order',
          entityId: payload.orderId,
          afterJson: {
            reason: 'KDS_DISABLED',
            disabledReason: kdsState.disabledReason,
            orderId: payload.orderId,
          },
        },
      });

      return; // Mark handled without creating tickets
    }

    await this.kitchenTickets.createTicketsForOrder({
      tenantId: event.tenantId!,
      branchId: event.branchId!,
      orderId: payload.orderId,
      actorUserId: undefined,
    });
  }
}
