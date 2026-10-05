import { Injectable, Inject, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FeatureResolver } from '../features/feature-resolver.service';
import { FeatureKey, FulfillmentStatus, ServiceNotificationType } from '@rms/contracts';
import { ServiceNotificationService } from './service-notification.service';
import { KdsGateway } from './kds.gateway';
import { KITCHEN_FULFILLMENT_ERRORS } from '@rms/contracts';

/**
 * Expo workflow service.
 *
 * Handles:
 * - Listing orders ready for expo review
 * - Releasing orders from expo to waiters
 * - Recalling released orders back to expo
 * - Collecting orders at expo stations
 */
@Injectable()
export class ExpoService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FeatureResolver) private readonly featureResolver: FeatureResolver,
    @Inject(ServiceNotificationService) private readonly notificationService: ServiceNotificationService,
    @Inject(KdsGateway) private readonly kdsGateway: KdsGateway,
  ) {}

  /**
   * List orders visible on the expo screen for a branch.
   * Shows orders in READY_FOR_EXPO or READY_FOR_SERVICE status.
   */
  async listExpoOrders(params: {
    tenantId: string;
    branchId: string;
    updatedAfter?: string;
    limit?: number;
    after?: string;
  }) {
    const { tenantId, branchId, updatedAfter, limit = 50, after } = params;

    await this.featureResolver.assertEffective(tenantId, FeatureKey.KDS, branchId);

    const orders = await this.prisma.order.findMany({
      where: {
        tenantId,
        branchId,
        fulfillmentStatus: {
          in: [
            FulfillmentStatus.READY_FOR_EXPO,
            FulfillmentStatus.READY_FOR_SERVICE,
            FulfillmentStatus.PARTIALLY_READY,
            FulfillmentStatus.PARTIALLY_SERVED,
          ],
        },
        ...(updatedAfter && { updatedAt: { gte: new Date(updatedAfter) } }),
      },
      include: {
        kitchenTickets: {
          select: {
            id: true,
            stationId: true,
            kitchenId: true,
            ticketType: true,
            status: true,
            readyAt: true,
            collectedAt: true,
            collectionLabelSnapshot: true,
            station: { select: { name: true, isExpo: true } },
            kitchen: { select: { name: true } },
          },
        },
        waiter: { select: { id: true, phoneE164: true } },
      },
      orderBy: [{ readyForServiceAt: 'asc' }, { createdAt: 'asc' }],
      take: limit,
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
    });

    return orders.map((order) => this.serializeExpoOrder(order));
  }

  /**
   * Get detailed expo view for a single order.
   */
  async getExpoOrderDetail(params: {
    tenantId: string;
    branchId: string;
    orderId: string;
  }) {
    const { tenantId, branchId, orderId } = params;

    await this.featureResolver.assertEffective(tenantId, FeatureKey.KDS, branchId);

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId, branchId },
      include: {
        kitchenTickets: {
          include: {
            station: { select: { name: true, isExpo: true, collectionLabelOverride: true } },
            kitchen: { select: { name: true, collectionLabel: true } },
            lines: true,
          },
        },
        waiter: { select: { id: true, phoneE164: true } },
      },
    });

    if (!order) throw new NotFoundException('Order not found');

    // Fetch order line details for snapshot data
    const orderLineIds = order.kitchenTickets.flatMap((t: any) => t.lines.map((l: any) => l.orderLineId));
    const orderLines = orderLineIds.length > 0
      ? await this.prisma.orderLine.findMany({
          where: { id: { in: orderLineIds } },
          select: { id: true, itemNameSnapshot: true, variantNameSnapshot: true, quantity: true },
        })
      : [];
    const orderLineMap = new Map(orderLines.map((ol) => [ol.id, ol]));

    return {
      id: order.id,
      orderNumber: order.orderNumber?.toString(),
      tableId: order.tableId,
      orderType: order.orderType,
      fulfillmentStatus: order.fulfillmentStatus,
      expoReleasedAt: order.expoReleasedAt,
      readyForServiceAt: order.readyForServiceAt,
      servedAt: order.servedAt,
      assignedWaiterUserId: order.assignedWaiterUserId,
      version: order.version,
      tickets: order.kitchenTickets.map((t: any) => ({
        id: t.id,
        stationId: t.stationId,
        stationName: t.station?.name,
        kitchenName: t.kitchen?.name,
        ticketType: t.ticketType,
        status: t.status,
        readyAt: t.readyAt,
        collectedAt: t.collectedAt,
        collectionLabel: t.station?.collectionLabelOverride ?? t.kitchen?.collectionLabel,
        lines: t.lines.map((l: any) => {
          const ol = orderLineMap.get(l.orderLineId);
          return {
            id: l.id,
            itemName: l.itemNameSnapshot ?? ol?.itemNameSnapshot,
            variantName: l.variantNameSnapshot ?? ol?.variantNameSnapshot,
            quantity: l.quantity,
            quantityReady: l.quantityReady,
            quantityCollected: l.quantityCollected,
            quantityServed: l.quantityServed,
            status: l.status,
            routeType: l.routeType,
            isRequired: l.isRequired,
          };
        }),
      })),
    };
  }

  /**
   * Release an order from expo.
   * Requires all required preparation tickets to be READY.
   * When expoMode is REQUIRED, this is the only way to make order ready for service.
   */
  async releaseOrder(params: {
    tenantId: string;
    branchId: string;
    orderId: string;
    actorUserId: string;
    expectedVersion: number;
  }) {
    const { tenantId, branchId, orderId, actorUserId, expectedVersion } = params;

    await this.featureResolver.assertEffective(tenantId, FeatureKey.KDS, branchId);

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId, branchId },
    });
    if (!order) throw new NotFoundException('Order not found');

    // Check version
    if (order.version !== expectedVersion) {
      throw new ConflictException({
        code: KITCHEN_FULFILLMENT_ERRORS.ORDER_VERSION_CONFLICT,
        message: 'Order has been modified. Please refresh.',
        currentVersion: order.version,
      });
    }

    // Check not already released
    if (order.expoReleasedAt) {
      throw new ConflictException({
        code: KITCHEN_FULFILLMENT_ERRORS.EXPO_ALREADY_RELEASED,
        message: 'Order has already been released from expo.',
        releasedAt: order.expoReleasedAt,
      });
    }

    // Check fulfillment status allows release
    if (order.fulfillmentStatus !== FulfillmentStatus.READY_FOR_EXPO &&
        order.fulfillmentStatus !== FulfillmentStatus.PARTIALLY_READY) {
      throw new ConflictException({
        code: KITCHEN_FULFILLMENT_ERRORS.EXPO_RELEASE_BLOCKED,
        message: `Cannot release order in status ${order.fulfillmentStatus}. All required preparation tickets must be ready.`,
        fulfillmentStatus: order.fulfillmentStatus,
      });
    }

    // Verify all required preparation tickets are READY/COMPLETED
    const tickets = await this.prisma.kitchenTicket.findMany({
      where: { orderId, tenantId, branchId, ticketType: 'PREPARATION' },
      include: { lines: { select: { isRequired: true, status: true } } },
    });

    const hasBlockingPrep = tickets.some((t) => {
      const hasRequiredLine = t.lines.some((l) => l.isRequired && l.status !== 'CANCELLED');
      return hasRequiredLine && t.status !== 'READY' && t.status !== 'COMPLETED';
    });

    if (hasBlockingPrep) {
      throw new ConflictException({
        code: KITCHEN_FULFILLMENT_ERRORS.EXPO_RELEASE_BLOCKED,
        message: 'Not all required preparation tickets are ready.',
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.updateMany({
        where: { id: orderId, version: expectedVersion },
        data: {
          expoReleasedAt: new Date(),
          expoReleasedByUserId: actorUserId,
          fulfillmentStatus: FulfillmentStatus.READY_FOR_SERVICE,
          readyForServiceAt: new Date(),
          version: { increment: 1 },
        },
      });

      if (updated.count !== 1) {
        throw new ConflictException('Version conflict');
      }

      const latestOrder = await tx.order.findUnique({ where: { id: orderId } });

      // History
      await tx.orderStatusHistory.create({
        data: {
          tenantId,
          branchId,
          orderId,
          fromStatus: order.fulfillmentStatus,
          toStatus: FulfillmentStatus.READY_FOR_SERVICE,
          actorUserId,
        },
      });

      // Audit
      await tx.auditLog.create({
        data: {
          actorUserId,
          tenantId,
          branchId,
          action: 'EXPO_RELEASE',
          entityType: 'Order',
          entityId: orderId,
          beforeJson: { fulfillmentStatus: order.fulfillmentStatus },
          afterJson: { fulfillmentStatus: FulfillmentStatus.READY_FOR_SERVICE },
        },
      });

      // Outbox
      await tx.outboxEvent.create({
        data: {
          tenantId,
          branchId,
          aggregateType: 'Order',
          aggregateId: orderId,
          eventType: 'order.expo.released',
          payload: {
            orderId,
            fromStatus: order.fulfillmentStatus,
            toStatus: FulfillmentStatus.READY_FOR_SERVICE,
            releasedByUserId: actorUserId,
          },
        },
      });

      // Cancel any OPEN/UNREAD notifications for this order (they'll be superseded)
      await tx.serviceNotification.updateMany({
        where: {
          orderId,
          status: { in: ['UNREAD'] },
          type: { in: [ServiceNotificationType.STATION_READY, ServiceNotificationType.ORDER_READY] },
        },
        data: { status: 'CANCELLED' },
      });

      return latestOrder;
    });

    // Create EXPO_RELEASED notification for assigned waiter
    await this.notificationService.createNotification({
      tenantId,
      branchId,
      orderId,
      assignedUserId: order.assignedWaiterUserId ?? undefined,
      type: ServiceNotificationType.EXPO_RELEASED,
      dedupeKey: `order:${orderId}:expo-released:v${result!.version}`,
      actorUserId,
    });

    // Broadcast
    this.broadcastExpoReleased(branchId, {
      orderId,
      fulfillmentStatus: FulfillmentStatus.READY_FOR_SERVICE,
      version: result!.version,
    });

    return {
      id: result!.id,
      fulfillmentStatus: result!.fulfillmentStatus,
      expoReleasedAt: result!.expoReleasedAt,
      version: result!.version,
    };
  }

  /**
   * Recall an order from expo (undo release).
   * Requires Manager/Owner or explicit policy.
   */
  async recallOrder(params: {
    tenantId: string;
    branchId: string;
    orderId: string;
    actorUserId: string;
    reason: string;
    expectedVersion: number;
  }) {
    const { tenantId, branchId, orderId, actorUserId, reason, expectedVersion } = params;

    await this.featureResolver.assertEffective(tenantId, FeatureKey.KDS, branchId);

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId, branchId },
    });
    if (!order) throw new NotFoundException('Order not found');

    if (order.version !== expectedVersion) {
      throw new ConflictException({
        code: KITCHEN_FULFILLMENT_ERRORS.ORDER_VERSION_CONFLICT,
        message: 'Order has been modified. Please refresh.',
        currentVersion: order.version,
      });
    }

    // Cannot recall if already collected/served
    if (order.servedAt) {
      throw new ConflictException({
        code: KITCHEN_FULFILLMENT_ERRORS.ORDER_ALREADY_SERVED,
        message: 'Cannot recall an order that has already been served.',
      });
    }

    if (!order.expoReleasedAt) {
      throw new ConflictException({
        code: KITCHEN_FULFILLMENT_ERRORS.EXPO_RECALL_BLOCKED,
        message: 'Order has not been released from expo yet.',
      });
    }

    // Recompute the fulfillment status to go back to READY_FOR_EXPO
    const result = await this.prisma.$transaction(async (tx) => {
      // Determine previous status from the fulfillment derivation
      const tickets = await tx.kitchenTicket.findMany({
        where: { orderId, tenantId, branchId },
        select: { id: true, status: true, readyAt: true, ticketType: true },
      });

      const ticketIds = tickets.map((t) => t.id);
      const allLines = await tx.kitchenTicketLine.findMany({
        where: { ticketId: { in: ticketIds } },
        select: { ticketId: true, isRequired: true, status: true },
      });

      const requiredTicketIds = new Set<string>();
      for (const line of allLines) {
        if (line.isRequired && line.status !== 'CANCELLED') {
          requiredTicketIds.add(line.ticketId);
        }
      }

      const prepRequired = tickets.filter(
        (t) => t.ticketType === 'PREPARATION' && requiredTicketIds.has(t.id),
      );
      const prepActive = prepRequired.filter((t) => t.status !== 'CANCELLED');
      const prepAllDone = prepActive.length > 0 && prepActive.every((t) => t.status === 'READY' || t.status === 'COMPLETED');

      let previousStatus: FulfillmentStatus;
      if (prepAllDone) {
        previousStatus = FulfillmentStatus.READY_FOR_EXPO;
      } else {
        const hasReady = prepActive.some((t) => t.status === 'READY');
        const hasInProgress = prepActive.some((t) => t.status === 'IN_PROGRESS');
        if (hasReady && (hasInProgress || prepActive.some((t) => t.status === 'QUEUED'))) {
          previousStatus = FulfillmentStatus.PARTIALLY_READY;
        } else if (hasInProgress) {
          previousStatus = FulfillmentStatus.PREPARING;
        } else {
          previousStatus = FulfillmentStatus.QUEUED;
        }
      }

      const updated = await tx.order.updateMany({
        where: { id: orderId, version: expectedVersion },
        data: {
          expoReleasedAt: null,
          expoReleasedByUserId: null,
          fulfillmentStatus: previousStatus,
          readyForServiceAt: null,
          version: { increment: 1 },
        },
      });

      if (updated.count !== 1) {
        throw new ConflictException('Version conflict');
      }

      const latestOrder = await tx.order.findUnique({ where: { id: orderId } });

      await tx.orderStatusHistory.create({
        data: {
          tenantId,
          branchId,
          orderId,
          fromStatus: FulfillmentStatus.READY_FOR_SERVICE,
          toStatus: previousStatus,
          actorUserId,
          reason,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          tenantId,
          branchId,
          action: 'EXPO_RECALL',
          entityType: 'Order',
          entityId: orderId,
          beforeJson: { fulfillmentStatus: FulfillmentStatus.READY_FOR_SERVICE, expoReleasedAt: order.expoReleasedAt },
          afterJson: { fulfillmentStatus: previousStatus, reason },
        },
      });

      await tx.outboxEvent.create({
        data: {
          tenantId,
          branchId,
          aggregateType: 'Order',
          aggregateId: orderId,
          eventType: 'order.expo.recalled',
          payload: {
            orderId,
            fromStatus: FulfillmentStatus.READY_FOR_SERVICE,
            toStatus: previousStatus,
            reason,
          },
        },
      });

      // Cancel EXPO_RELEASED notification
      await tx.serviceNotification.updateMany({
        where: {
          orderId,
          type: ServiceNotificationType.EXPO_RELEASED,
          status: { in: ['UNREAD', 'ACKNOWLEDGED'] },
        },
        data: { status: 'CANCELLED' },
      });

      return latestOrder;
    });

    // Broadcast
    this.broadcastExpoUpdated(branchId, {
      orderId,
      fulfillmentStatus: result!.fulfillmentStatus,
      version: result!.version,
      recalled: true,
    });

    return {
      id: result!.id,
      fulfillmentStatus: result!.fulfillmentStatus,
      expoReleasedAt: result!.expoReleasedAt,
      version: result!.version,
    };
  }

  /**
   * Collect an order at expo (expo user physically picks it up for waiter handoff).
   */
  async collectOrder(params: {
    tenantId: string;
    branchId: string;
    orderId: string;
    actorUserId: string;
    expectedVersion: number;
  }) {
    const { tenantId, branchId, orderId, actorUserId, expectedVersion } = params;

    await this.featureResolver.assertEffective(tenantId, FeatureKey.KDS, branchId);

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId, branchId },
    });
    if (!order) throw new NotFoundException('Order not found');

    if (order.version !== expectedVersion) {
      throw new ConflictException({
        code: KITCHEN_FULFILLMENT_ERRORS.ORDER_VERSION_CONFLICT,
        message: 'Order has been modified. Please refresh.',
        currentVersion: order.version,
      });
    }

    // Must be ready for service or already released
    if (order.fulfillmentStatus !== FulfillmentStatus.READY_FOR_SERVICE &&
        order.fulfillmentStatus !== FulfillmentStatus.PARTIALLY_SERVED) {
      throw new ConflictException({
        code: KITCHEN_FULFILLMENT_ERRORS.ORDER_NOT_READY_FOR_COLLECTION,
        message: `Cannot collect order in status ${order.fulfillmentStatus}.`,
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Guard inside the transaction: two collectors cannot both consume the same version.
      const guarded = await tx.order.updateMany({
        where: { id: orderId, tenantId, branchId, version: expectedVersion },
        data: { version: { increment: 1 } },
      });
      if (guarded.count !== 1) {
        throw new ConflictException({
          code: KITCHEN_FULFILLMENT_ERRORS.ORDER_VERSION_CONFLICT,
          message: 'Order has been modified. Please refresh.',
        });
      }
      const tickets = await tx.kitchenTicket.findMany({
        where: { orderId, tenantId, branchId, status: { in: ['READY', 'COMPLETED'] } },
        include: { lines: { where: { status: 'READY' } } },
      });
      const now = new Date();
      for (const ticket of tickets) {
        const guardedTicket = await tx.kitchenTicket.updateMany({
          where: { id: ticket.id, tenantId, branchId, version: ticket.version, status: ticket.status },
          data: { collectedAt: now, collectedByUserId: actorUserId, version: { increment: 1 } },
        });
        if (guardedTicket.count !== 1) throw new ConflictException('Ticket changed during collection');
        for (const line of ticket.lines) {
          const guardedLine = await tx.kitchenTicketLine.updateMany({
            where: { id: line.id, tenantId, branchId, ticketId: ticket.id, version: line.version, status: 'READY' },
            data: { quantityCollected: line.quantityReady, collectedAt: now, version: { increment: 1 } },
          });
          if (guardedLine.count !== 1) throw new ConflictException('Ticket line changed during collection');
        }
      }

      // Audit
      await tx.auditLog.create({
        data: {
          actorUserId,
          tenantId,
          branchId,
          action: 'EXPO_COLLECT',
          entityType: 'Order',
          entityId: orderId,
          afterJson: { collectedByUserId: actorUserId },
        },
      });

      await tx.outboxEvent.create({
        data: {
          tenantId, branchId, aggregateType: 'Order', aggregateId: orderId,
          eventType: 'order.collected',
          payload: { orderId, collectedByUserId: actorUserId, version: expectedVersion + 1 },
        },
      });
      return await tx.order.findFirst({ where: { id: orderId, tenantId, branchId } });
    });

    return {
      id: result!.id,
      fulfillmentStatus: result!.fulfillmentStatus,
      version: result!.version,
    };
  }

  // ─── Helpers ──────────────────────────────

  private serializeExpoOrder(order: any) {
    return {
      id: order.id,
      orderNumber: order.orderNumber?.toString(),
      tableId: order.tableId,
      orderType: order.orderType,
      fulfillmentStatus: order.fulfillmentStatus,
      expoReleasedAt: order.expoReleasedAt,
      readyForServiceAt: order.readyForServiceAt,
      servedAt: order.servedAt,
      assignedWaiterUserId: order.assignedWaiterUserId,
      version: order.version,
      createdAt: order.createdAt,
      tickets: order.kitchenTickets?.map((t: any) => ({
        id: t.id,
        stationId: t.stationId,
        stationName: t.station?.name,
        kitchenName: t.kitchen?.name,
        ticketType: t.ticketType,
        status: t.status,
        readyAt: t.readyAt,
        collectedAt: t.collectedAt,
        collectionLabel: t.collectionLabelSnapshot,
      })),
    };
  }

  private broadcastExpoReleased(branchId: string, data: Record<string, unknown>) {
    try {
      this.kdsGateway.broadcastToExpo(branchId, 'expo:released', data);
    } catch { /* gateway may not be connected */ }
  }

  private broadcastExpoUpdated(branchId: string, data: Record<string, unknown>) {
    try {
      this.kdsGateway.broadcastToExpo(branchId, 'expo:updated', data);
    } catch { /* gateway may not be connected */ }
  }
}
