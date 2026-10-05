import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { ServiceNotification } from '@prisma/client';
import { ServiceNotificationType, ServiceNotificationStatus } from '@rms/contracts';

/**
 * Durable service-notification management.
 *
 * Notifications are append-only and deduplicated by `dedupeKey`.
 * Used for waiter-facing readiness, recall, escalation, and assignment changes.
 */
@Injectable()
export class ServiceNotificationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  /**
   * Create a service notification. If a notification with the same dedupeKey
   * already exists, returns the existing one (idempotent).
   */
  async createNotification(params: {
    tenantId: string;
    branchId: string;
    orderId: string;
    ticketId?: string;
    assignedUserId?: string;
    type: ServiceNotificationType;
    collectionLabelSnapshot?: string;
    dedupeKey: string;
    actorUserId?: string;
  }) {
    const {
      tenantId, branchId, orderId, ticketId, assignedUserId,
      type, collectionLabelSnapshot, dedupeKey, actorUserId,
    } = params;

    return this.prisma.$transaction(async (tx) => {
      // Serialize competing creators for the global unique dedupe key. The lock
      // lasts only for this transaction; a hash collision merely serializes work.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${dedupeKey}, 0))::text AS locked`;
      const existing = await tx.serviceNotification.findUnique({
        where: { dedupeKey },
      });
      if (existing) {
        if (existing.tenantId !== tenantId || existing.branchId !== branchId || existing.orderId !== orderId) {
          throw new NotFoundException('Notification not found');
        }
        return this.serializeNotification(existing);
      }

      const order = await tx.order.findFirst({
        where: { id: orderId, tenantId, branchId }, select: { id: true },
      });
      if (!order) throw new NotFoundException('Order not found');
      if (ticketId) {
        const ticket = await tx.kitchenTicket.findFirst({
          where: { id: ticketId, orderId, tenantId, branchId }, select: { id: true },
        });
        if (!ticket) throw new NotFoundException('Ticket not found');
      }

      const notification = await tx.serviceNotification.create({
        data: {
          tenantId,
          branchId,
          orderId,
          ticketId: ticketId ?? null,
          assignedUserId: assignedUserId ?? null,
          type,
          status: ServiceNotificationStatus.UNREAD,
          collectionLabelSnapshot: collectionLabelSnapshot ?? null,
          dedupeKey,
        },
      });

      // Audit trail
      await tx.auditLog.create({
        data: {
          actorUserId: actorUserId ?? null,
          tenantId,
          branchId,
          action: 'SERVICE_NOTIFICATION_CREATE',
          entityType: 'ServiceNotification',
          entityId: notification.id,
          afterJson: {
            orderId,
            ticketId,
            type,
            assignedUserId,
            collectionLabelSnapshot,
          },
        },
      });

      return this.serializeNotification(notification);
    });
  }

  /**
   * List notifications for a user within a branch.
   */
  async listNotifications(params: {
    tenantId: string;
    branchId: string;
    assignedUserId?: string;
    status?: ServiceNotificationStatus;
    limit?: number;
    after?: string;
  }) {
    const { tenantId, branchId, assignedUserId, status, limit = 50, after } = params;

    const notifications = await this.prisma.serviceNotification.findMany({
      where: {
        tenantId,
        branchId,
        ...(assignedUserId && { assignedUserId }),
        ...(status && { status }),
      },
      include: {
        order: { select: { orderNumber: true, tableId: true, orderType: true } },
        ticket: { select: { ticketNumber: true, stationId: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
    });

    return notifications.map((n) => ({
      ...this.serializeNotification(n),
      orderNumber: n.order?.orderNumber?.toString(),
      tableId: n.order?.tableId,
      orderType: n.order?.orderType,
      ticketNumber: n.ticket?.ticketNumber?.toString(),
      stationId: n.ticket?.stationId,
    }));
  }

  /**
   * Acknowledge a notification.
   */
  async acknowledgeNotification(params: {
    tenantId: string;
    branchId: string;
    notificationId: string;
    actorUserId: string;
  }) {
    const { tenantId, branchId, notificationId } = params;

    const notification = await this.prisma.serviceNotification.findFirst({
      where: { id: notificationId, tenantId, branchId },
    });
    if (!notification) throw new NotFoundException('Notification not found');

    if (notification.status !== ServiceNotificationStatus.UNREAD) {
      return this.serializeNotification(notification);
    }

    const updated = await this.prisma.serviceNotification.update({
      where: { id: notificationId },
      data: { status: ServiceNotificationStatus.ACKNOWLEDGED, acknowledgedAt: new Date() },
    });

    return this.serializeNotification(updated);
  }

  /**
   * Resolve a notification (e.g., when order is collected or served).
   */
  async resolveNotification(params: {
    tenantId: string;
    branchId: string;
    notificationId: string;
    actorUserId: string;
  }) {
    const { tenantId, branchId, notificationId } = params;

    const notification = await this.prisma.serviceNotification.findFirst({
      where: { id: notificationId, tenantId, branchId },
    });
    if (!notification) throw new NotFoundException('Notification not found');

    if (notification.status === ServiceNotificationStatus.RESOLVED ||
        notification.status === ServiceNotificationStatus.CANCELLED) {
      return this.serializeNotification(notification);
    }

    const updated = await this.prisma.serviceNotification.update({
      where: { id: notificationId },
      data: { status: ServiceNotificationStatus.RESOLVED, resolvedAt: new Date() },
    });

    return this.serializeNotification(updated);
  }

  /**
   * Cancel notifications for an order (e.g., when order is cancelled).
   * Idempotent: already-cancelled notifications are not modified.
   */
  async cancelNotificationsForOrder(params: {
    tenantId: string;
    branchId: string;
    orderId: string;
    actorUserId?: string;
  }) {
    const { tenantId, branchId, orderId } = params;

    await this.prisma.serviceNotification.updateMany({
      where: {
        tenantId,
        branchId,
        orderId,
        status: { notIn: [ServiceNotificationStatus.RESOLVED, ServiceNotificationStatus.CANCELLED] },
      },
      data: { status: ServiceNotificationStatus.CANCELLED },
    });
  }

  /**
   * Cancel notifications for a specific ticket (e.g., when ticket is recalled or cancelled).
   */
  async cancelNotificationsForTicket(params: {
    tenantId: string;
    branchId: string;
    ticketId: string;
    actorUserId?: string;
  }) {
    const { tenantId, branchId, ticketId } = params;

    await this.prisma.serviceNotification.updateMany({
      where: {
        tenantId,
        branchId,
        ticketId,
        status: { notIn: [ServiceNotificationStatus.RESOLVED, ServiceNotificationStatus.CANCELLED] },
      },
      data: { status: ServiceNotificationStatus.CANCELLED },
    });
  }

  /**
   * Get unresolved ready notifications older than threshold (for escalation).
   */
  async getUnreadyNotificationsForEscalation(params: {
    tenantId: string;
    branchId: string;
    olderThanSeconds: number;
    limit?: number;
  }) {
    const { tenantId, branchId, olderThanSeconds, limit = 20 } = params;
    const threshold = new Date(Date.now() - olderThanSeconds * 1000);

    return this.prisma.serviceNotification.findMany({
      where: {
        tenantId,
        branchId,
        type: { in: [ServiceNotificationType.STATION_READY, ServiceNotificationType.ORDER_READY, ServiceNotificationType.EXPO_RELEASED] },
        status: ServiceNotificationStatus.UNREAD,
        createdAt: { lt: threshold },
      },
      include: {
        order: { select: { id: true, orderNumber: true, tableId: true, assignedWaiterUserId: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  /**
   * Create an escalation notification when a ready notification goes unresolved.
   */
  async createEscalation(params: {
    tenantId: string;
    branchId: string;
    orderId: string;
    originalNotificationId: string;
    assignedUserId?: string;
    collectionLabelSnapshot?: string;
  }) {
    const dedupeKey = `escalation:${params.orderId}:from:${params.originalNotificationId}`;
    return this.createNotification({
      ...params,
      type: ServiceNotificationType.ESCALATION,
      dedupeKey,
    });
  }

  private serializeNotification(notification: ServiceNotification) {
    return {
      id: notification.id,
      tenantId: notification.tenantId,
      branchId: notification.branchId,
      orderId: notification.orderId,
      ticketId: notification.ticketId,
      assignedUserId: notification.assignedUserId,
      type: notification.type,
      status: notification.status,
      collectionLabelSnapshot: notification.collectionLabelSnapshot,
      dedupeKey: notification.dedupeKey,
      createdAt: notification.createdAt,
      acknowledgedAt: notification.acknowledgedAt,
      resolvedAt: notification.resolvedAt,
    };
  }
}
