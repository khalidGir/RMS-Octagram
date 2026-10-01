import { Injectable, Inject, NotFoundException, ConflictException, ForbiddenException, BadRequestException } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PrismaService } from '../prisma/prisma.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { FeatureResolver } from '../features/feature-resolver.service';
import { FeatureKey, FulfillmentStatus, ServiceNotificationType } from '@rms/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { FulfillmentStatusService } from './fulfillment-status.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ServiceNotificationService } from './service-notification.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { FulfillmentPolicyService } from './fulfillment-policy.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { KdsGateway } from './kds.gateway';
import { KITCHEN_FULFILLMENT_ERRORS } from '@rms/contracts';

/**
 * Waiter fulfillment service.
 *
 * Handles:
 * - Assigning waiters to orders
 * - Self-claiming unassigned orders
 * - Service board queries
 * - Collecting ready work
 * - Marking orders as served
 */
@Injectable()
export class WaiterService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FeatureResolver) private readonly featureResolver: FeatureResolver,
    @Inject(FulfillmentStatusService) private readonly fulfillmentStatusService: FulfillmentStatusService,
    @Inject(ServiceNotificationService) private readonly notificationService: ServiceNotificationService,
    @Inject(FulfillmentPolicyService) private readonly policyService: FulfillmentPolicyService,
    @Inject(KdsGateway) private readonly kdsGateway: KdsGateway,
  ) {}

  /**
   * Assign a waiter to an order.
   * Owner/Manager can assign any waiter. Waiters can self-claim if policy allows.
   */
  async assignWaiter(params: {
    tenantId: string;
    branchId: string;
    orderId: string;
    waiterUserId: string;
    actorUserId: string;
    tenantRole: string;
  }) {
    const { tenantId, branchId, orderId, waiterUserId, actorUserId, tenantRole } = params;

    await this.featureResolver.assertEffective(tenantId, FeatureKey.KDS, branchId);

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId, branchId },
    });
    if (!order) throw new NotFoundException('Order not found');

    // Self-claim check
    const isSelfClaim = waiterUserId === actorUserId;
    if (isSelfClaim && tenantRole !== 'OWNER' && tenantRole !== 'MANAGER') {
      const policy = await this.policyService.getPolicy(tenantId, branchId);
      if (!policy.allowWaiterSelfClaim) {
        throw new ConflictException({
          code: KITCHEN_FULFILLMENT_ERRORS.WAITER_SELF_CLAIM_DISABLED,
          message: 'Waiter self-claim is not enabled for this branch.',
        });
      }
    }

    // Verify the waiter user exists in this tenant
    const waiterMembership = await this.prisma.tenantMembership.findFirst({
      where: {
        tenantId,
        userId: waiterUserId,
        status: 'ACTIVE',
      },
    });
    if (!waiterMembership) {
      throw new NotFoundException('Waiter user not found in this tenant');
    }

    // Verify waiter is assigned to this branch
    const branchAssignment = await this.prisma.branchAssignment.findUnique({
      where: {
        branchId_membershipId: { branchId, membershipId: waiterMembership.id },
      },
    });
    if (!branchAssignment && tenantRole !== 'OWNER') {
      throw new ForbiddenException('Waiter is not assigned to this branch');
    }

    if (order.assignedWaiterUserId === waiterUserId) {
      return this.serializeOrderAssignment(order);
    }

    const previousWaiterId = order.assignedWaiterUserId;

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id: orderId },
        data: {
          assignedWaiterUserId: waiterUserId,
          version: { increment: 1 },
        },
      });

      // History
      await tx.orderStatusHistory.create({
        data: {
          tenantId,
          branchId,
          orderId,
          fromStatus: order.fulfillmentStatus,
          toStatus: order.fulfillmentStatus,
          actorUserId,
        },
      });

      // Audit
      await tx.auditLog.create({
        data: {
          actorUserId,
          tenantId,
          branchId,
          action: 'WAITER_ASSIGN',
          entityType: 'Order',
          entityId: orderId,
          beforeJson: { assignedWaiterUserId: previousWaiterId },
          afterJson: { assignedWaiterUserId: waiterUserId },
        },
      });

      // Outbox
      await tx.outboxEvent.create({
        data: {
          tenantId,
          branchId,
          aggregateType: 'Order',
          aggregateId: orderId,
          eventType: 'order.waiter.assigned',
          payload: {
            orderId,
            previousWaiterUserId: previousWaiterId,
            assignedWaiterUserId: waiterUserId,
          },
        },
      });

      return updated;
    });

    // Create REASSIGNED notification
    await this.notificationService.createNotification({
      tenantId,
      branchId,
      orderId,
      assignedUserId: waiterUserId,
      type: ServiceNotificationType.REASSIGNED,
      dedupeKey: `order:${orderId}:reassigned:v${result.version}`,
      actorUserId,
    });

    // Broadcast
    this.broadcastAssignmentChanged(branchId, {
      orderId,
      assignedWaiterUserId: waiterUserId,
      version: result.version,
    });

    return this.serializeOrderAssignment(result);
  }

  /**
   * Claim an unassigned order (waiter self-claim).
   */
  async claimOrder(params: {
    tenantId: string;
    branchId: string;
    orderId: string;
    actorUserId: string;
    tenantRole: string;
  }) {
    const { tenantId, branchId, orderId, actorUserId, tenantRole } = params;

    const policy = await this.policyService.getPolicy(tenantId, branchId);
    if (!policy.allowWaiterSelfClaim && tenantRole !== 'OWNER' && tenantRole !== 'MANAGER') {
      throw new ConflictException({
        code: KITCHEN_FULFILLMENT_ERRORS.WAITER_SELF_CLAIM_DISABLED,
        message: 'Waiter self-claim is not enabled for this branch.',
      });
    }

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId, branchId },
    });
    if (!order) throw new NotFoundException('Order not found');

    if (order.assignedWaiterUserId && order.assignedWaiterUserId !== actorUserId) {
      throw new ConflictException({
        code: KITCHEN_FULFILLMENT_ERRORS.ORDER_ALREADY_ASSIGNED,
        message: 'Order is already assigned to another waiter.',
        assignedWaiterUserId: order.assignedWaiterUserId,
      });
    }

    if (order.assignedWaiterUserId === actorUserId) {
      return this.serializeOrderAssignment(order);
    }

    return this.assignWaiter({
      tenantId,
      branchId,
      orderId,
      waiterUserId: actorUserId,
      actorUserId,
      tenantRole,
    });
  }

  /**
   * Get the service board for a branch.
   * Shows orders that are ready or in progress, scoped by waiter.
   */
  async getServiceBoard(params: {
    tenantId: string;
    branchId: string;
    waiterUserId?: string;
    scope: string;
    status?: string;
    updatedAfter?: string;
    limit?: number;
    after?: string;
  }) {
    const { tenantId, branchId, waiterUserId, scope, status, updatedAfter, limit = 50, after } = params;

    await this.featureResolver.assertEffective(tenantId, FeatureKey.KDS, branchId);

    const whereClause: any = {
      tenantId,
      branchId,
      fulfillmentStatus: {
        notIn: [FulfillmentStatus.NOT_ROUTED, FulfillmentStatus.CANCELLED],
      },
    };

    // Scope filtering
    if (scope === 'mine' && waiterUserId) {
      whereClause.assignedWaiterUserId = waiterUserId;
    } else if (scope === 'unassigned') {
      whereClause.assignedWaiterUserId = null;
      const policy = await this.policyService.getPolicy(tenantId, branchId);
      if (!policy.showUnassignedReadyOrdersToWaiters) {
        // Only show ready unassigned orders if policy allows
        whereClause.fulfillmentStatus = {
          in: [FulfillmentStatus.READY_FOR_SERVICE, FulfillmentStatus.READY_FOR_EXPO],
        };
      }
    }
    // scope === 'all' → no waiter filter (manager/owner view)

    if (status) {
      whereClause.fulfillmentStatus = status;
    }

    if (updatedAfter) {
      whereClause.updatedAt = { gte: new Date(updatedAfter) };
    }

    const orders = await this.prisma.order.findMany({
      where: whereClause,
      include: {
        kitchenTickets: {
          select: {
            id: true,
            stationId: true,
            status: true,
            ticketType: true,
            collectionLabelSnapshot: true,
            station: { select: { name: true } },
            kitchen: { select: { name: true } },
            lines: {
              select: {
                status: true,
                isRequired: true,
                routeType: true,
                quantity: true,
                quantityReady: true,
                quantityCollected: true,
                quantityServed: true,
              },
            },
          },
        },
        waiter: { select: { id: true, phoneE164: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
      take: limit,
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
    });

    return orders.map((order) => this.serializeServiceBoardOrder(order));
  }

  /**
   * Collect ready work for an order.
   * Transitions ticket lines from READY to COLLECTED.
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

    // Verify order is ready for collection
    if (order.fulfillmentStatus !== FulfillmentStatus.READY_FOR_SERVICE &&
        order.fulfillmentStatus !== FulfillmentStatus.PARTIALLY_SERVED) {
      throw new ConflictException({
        code: KITCHEN_FULFILLMENT_ERRORS.ORDER_NOT_READY_FOR_COLLECTION,
        message: `Order is not ready for collection (status: ${order.fulfillmentStatus}).`,
      });
    }

    const policy = await this.policyService.getPolicy(tenantId, branchId);

    const result = await this.prisma.$transaction(async (tx) => {
      // Collect all READY ticket lines across all tickets
      const readyTickets = await tx.kitchenTicket.findMany({
        where: { orderId, tenantId, branchId, status: 'READY' },
        include: {
          lines: {
            where: { status: 'READY' },
            select: { id: true, quantityReady: true },
          },
        },
      });

      const now = new Date();
      for (const ticket of readyTickets) {
        await tx.kitchenTicket.updateMany({
          where: { id: ticket.id },
          data: { collectedAt: now, collectedByUserId: actorUserId },
        });

        for (const line of ticket.lines) {
          await tx.kitchenTicketLine.update({
            where: { id: line.id },
            data: { quantityCollected: line.quantityReady, collectedAt: now },
          });
        }
      }

      // Recompute fulfillment
      const fulfillment = await this.fulfillmentStatusService.deriveFulfillmentStatus({
        tenantId, branchId, orderId, tx,
      });

      const prevStatus = order.fulfillmentStatus;
      if (prevStatus !== fulfillment.fulfillmentStatus) {
        await tx.order.updateMany({
          where: { id: orderId },
          data: { fulfillmentStatus: fulfillment.fulfillmentStatus },
        });
      }

      // Audit
      await tx.auditLog.create({
        data: {
          actorUserId,
          tenantId,
          branchId,
          action: 'ORDER_COLLECT',
          entityType: 'Order',
          entityId: orderId,
          beforeJson: { fulfillmentStatus: prevStatus },
          afterJson: { fulfillmentStatus: fulfillment.fulfillmentStatus, collectedByUserId: actorUserId },
        },
      });

      // Outbox
      await tx.outboxEvent.create({
        data: {
          tenantId,
          branchId,
          aggregateType: 'Order',
          aggregateId: orderId,
          eventType: 'order.collected',
          payload: {
            orderId,
            fromStatus: prevStatus,
            toStatus: fulfillment.fulfillmentStatus,
            collectedByUserId: actorUserId,
          },
        },
      });

      return await tx.order.findUnique({ where: { id: orderId } });
    });

    // Resolve collection notifications (find OPEN notifications for this order)
    const openNotifications = await this.prisma.serviceNotification.findMany({
      where: {
        tenantId, branchId, orderId,
        status: { in: ['UNREAD', 'ACKNOWLEDGED'] },
      },
      select: { id: true },
    });
    for (const n of openNotifications) {
      await this.notificationService.resolveNotification({
        tenantId, branchId,
        notificationId: n.id,
        actorUserId,
      }).catch(() => {}); // best-effort: ignore if already resolved/cancelled
    }

    // Auto-complete kitchen tickets if policy says so
    if (policy.autoCompleteKitchenTicketOnCollected) {
      const collectedTickets = await this.prisma.kitchenTicket.findMany({
        where: {
          orderId,
          collectedAt: { not: null },
          status: 'READY',
        },
      });
      // Complete collected tickets (fire-and-forget, errors logged)
      for (const ticket of collectedTickets) {
        try {
          await this.prisma.kitchenTicket.update({
            where: { id: ticket.id },
            data: { status: 'COMPLETED', completedAt: new Date() },
          });
        } catch { /* best effort */ }
      }
    }

    // Broadcast
    this.broadcastFulfillmentChanged(branchId, {
      orderId,
      fulfillmentStatus: result!.fulfillmentStatus,
      version: result!.version,
    });

    return {
      id: result!.id,
      fulfillmentStatus: result!.fulfillmentStatus,
      version: result!.version,
    };
  }

  /**
   * Mark an order as served.
   * All required allocations must be collected/served.
   */
  async serveOrder(params: {
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

    if (order.fulfillmentStatus === FulfillmentStatus.SERVED) {
      throw new ConflictException({
        code: KITCHEN_FULFILLMENT_ERRORS.ORDER_ALREADY_SERVED,
        message: 'Order has already been served.',
      });
    }

    if (order.fulfillmentStatus === FulfillmentStatus.NOT_ROUTED ||
        order.fulfillmentStatus === FulfillmentStatus.CANCELLED) {
      throw new ConflictException({
        code: KITCHEN_FULFILLMENT_ERRORS.ORDER_NOT_SERVED,
        message: `Cannot serve order in status ${order.fulfillmentStatus}.`,
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Mark all non-cancelled ticket lines as served
      const tickets = await tx.kitchenTicket.findMany({
        where: { orderId, tenantId, branchId, status: { not: 'CANCELLED' } },
        include: {
          lines: {
            where: { status: { not: 'CANCELLED' } },
            select: { id: true, quantityCollected: true },
          },
        },
      });

      const now = new Date();
      for (const ticket of tickets) {
        for (const line of ticket.lines) {
          await tx.kitchenTicketLine.update({
            where: { id: line.id },
            data: { quantityServed: line.quantityCollected, servedAt: now, status: 'SERVED' },
          });
        }
      }

      const updated = await tx.order.updateMany({
        where: { id: orderId, version: expectedVersion },
        data: {
          fulfillmentStatus: FulfillmentStatus.SERVED,
          servedAt: now,
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
          toStatus: FulfillmentStatus.SERVED,
          actorUserId,
        },
      });

      // Audit
      await tx.auditLog.create({
        data: {
          actorUserId,
          tenantId,
          branchId,
          action: 'ORDER_SERVE',
          entityType: 'Order',
          entityId: orderId,
          beforeJson: { fulfillmentStatus: order.fulfillmentStatus },
          afterJson: { fulfillmentStatus: FulfillmentStatus.SERVED, servedAt: now },
        },
      });

      // Outbox
      await tx.outboxEvent.create({
        data: {
          tenantId,
          branchId,
          aggregateType: 'Order',
          aggregateId: orderId,
          eventType: 'order.served',
          payload: {
            orderId,
            fromStatus: order.fulfillmentStatus,
            toStatus: FulfillmentStatus.SERVED,
            servedByUserId: actorUserId,
          },
        },
      });

      // Resolve all open notifications for this order
      await tx.serviceNotification.updateMany({
        where: {
          orderId,
          status: { in: ['UNREAD', 'ACKNOWLEDGED'] },
        },
        data: { status: 'RESOLVED', resolvedAt: now },
      });

      return latestOrder;
    });

    // Broadcast
    this.broadcastFulfillmentChanged(branchId, {
      orderId,
      fulfillmentStatus: FulfillmentStatus.SERVED,
      version: result!.version,
    });

    return {
      id: result!.id,
      fulfillmentStatus: result!.fulfillmentStatus,
      servedAt: result!.servedAt,
      version: result!.version,
    };
  }

  /**
   * Serve specific lines of an order (partial service).
   */
  async serveLines(params: {
    tenantId: string;
    branchId: string;
    orderId: string;
    lineIds: string[];
    actorUserId: string;
    expectedVersion: number;
  }) {
    const { tenantId, branchId, orderId, lineIds, actorUserId, expectedVersion } = params;

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

    if (order.fulfillmentStatus === FulfillmentStatus.NOT_ROUTED ||
        order.fulfillmentStatus === FulfillmentStatus.CANCELLED ||
        order.fulfillmentStatus === FulfillmentStatus.SERVED) {
      throw new ConflictException({
        code: KITCHEN_FULFILLMENT_ERRORS.INVALID_SERVE_QUANTITIES,
        message: `Cannot serve lines for order in status ${order.fulfillmentStatus}.`,
      });
    }

    // Validate line IDs belong to this order
    const lines = await this.prisma.kitchenTicketLine.findMany({
      where: { id: { in: lineIds } },
      include: { ticket: { select: { orderId: true, id: true } } },
    });

    const validLines = lines.filter((l) => l.ticket.orderId === orderId);
    if (validLines.length !== lineIds.length) {
      throw new BadRequestException('Some line IDs do not belong to this order');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      for (const line of validLines) {
        await tx.kitchenTicketLine.update({
          where: { id: line.id },
          data: { quantityServed: line.quantity, servedAt: now, status: 'SERVED' },
        });
      }

      // Recompute fulfillment
      const fulfillment = await this.fulfillmentStatusService.deriveFulfillmentStatus({
        tenantId, branchId, orderId, tx,
      });

      const prevStatus = order.fulfillmentStatus;
      if (prevStatus !== fulfillment.fulfillmentStatus) {
        await tx.order.updateMany({
          where: { id: orderId },
          data: { fulfillmentStatus: fulfillment.fulfillmentStatus },
        });
      }

      // Audit
      await tx.auditLog.create({
        data: {
          actorUserId,
          tenantId,
          branchId,
          action: 'ORDER_SERVE_LINES',
          entityType: 'Order',
          entityId: orderId,
          afterJson: { servedLineIds: lineIds, fulfillmentStatus: fulfillment.fulfillmentStatus },
        },
      });

      return await tx.order.findUnique({ where: { id: orderId } });
    });

    // Broadcast
    this.broadcastFulfillmentChanged(branchId, {
      orderId,
      fulfillmentStatus: result!.fulfillmentStatus,
      version: result!.version,
    });

    return {
      id: result!.id,
      fulfillmentStatus: result!.fulfillmentStatus,
      version: result!.version,
    };
  }

  // ─── Helpers ──────────────────────────────

  private serializeOrderAssignment(order: any) {
    return {
      id: order.id,
      assignedWaiterUserId: order.assignedWaiterUserId,
      fulfillmentStatus: order.fulfillmentStatus,
      version: order.version,
    };
  }

  private serializeServiceBoardOrder(order: any) {
    const prepTickets = order.kitchenTickets.filter((t: any) => t.ticketType === 'PREPARATION');
    const totalRequiredLines = prepTickets.flatMap((t: any) => t.lines.filter((l: any) => l.isRequired));
    const readyLines = totalRequiredLines.filter((l: any) => l.status === 'READY' || l.status === 'SERVED');
    const servedLines = totalRequiredLines.filter((l: any) => l.status === 'SERVED');

    // Unique collection points for ready work
    const collectionPoints = prepTickets
      .filter((t: any) => t.status === 'READY')
      .map((t: any) => t.collectionLabelSnapshot ?? t.kitchen?.name ?? t.station?.name)
      .filter(Boolean);
    const uniqueCollectionPoints = [...new Set(collectionPoints)];

    // Outstanding stations
    const outstandingStations = prepTickets
      .filter((t: any) => t.status !== 'READY' && t.status !== 'COMPLETED' && t.status !== 'CANCELLED')
      .map((t: any) => ({
        stationId: t.stationId,
        stationName: t.station?.name,
        status: t.status,
      }));

    const canCollect = order.fulfillmentStatus === FulfillmentStatus.READY_FOR_SERVICE ||
      order.fulfillmentStatus === FulfillmentStatus.PARTIALLY_SERVED;
    const canServe = order.fulfillmentStatus !== FulfillmentStatus.NOT_ROUTED &&
      order.fulfillmentStatus !== FulfillmentStatus.CANCELLED &&
      order.fulfillmentStatus !== FulfillmentStatus.SERVED;
    const canClaim = !order.assignedWaiterUserId;

    return {
      id: order.id,
      orderNumber: order.orderNumber?.toString(),
      orderType: order.orderType,
      tableId: order.tableId,
      fulfillmentStatus: order.fulfillmentStatus,
      version: order.version,
      assignedWaiterUserId: order.assignedWaiterUserId,
      assignedWaiterPhone: order.waiter?.phoneE164,
      readyForServiceAt: order.readyForServiceAt,
      servedAt: order.servedAt,
      createdAt: order.createdAt,
      totalRequiredLines: totalRequiredLines.length,
      readyCount: readyLines.length,
      servedCount: servedLines.length,
      collectionPoints: uniqueCollectionPoints,
      outstandingStations,
      canCollect,
      canServe,
      canClaim,
      age: Date.now() - new Date(order.createdAt).getTime(),
      readyWaitDuration: order.readyForServiceAt
        ? Date.now() - new Date(order.readyForServiceAt).getTime()
        : null,
    };
  }

  private broadcastAssignmentChanged(branchId: string, data: Record<string, unknown>) {
    try {
      this.kdsGateway.broadcastToServiceBoard(branchId, 'order:assignment_changed', data);
    } catch { /* gateway may not be connected */ }
  }

  private broadcastFulfillmentChanged(branchId: string, data: Record<string, unknown>) {
    try {
      this.kdsGateway.broadcastFulfillmentChanged(branchId, data);
    } catch { /* gateway may not be connected */ }
  }
}
