import { Injectable, Inject, NotFoundException, ConflictException } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PrismaService } from '../prisma/prisma.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { FeatureResolver } from '../features/feature-resolver.service';
import { FeatureKey, FulfillmentStatus } from '@rms/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { KitchenRoutingService } from './kitchen-routing.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { FulfillmentStatusService } from './fulfillment-status.service';

// ─── Ticket State Machine ──────────────────

const TICKET_TRANSITIONS: Record<string, string[]> = {
  QUEUED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['READY', 'CANCELLED'],
  READY: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

function canTicketTransition(from: string, to: string): boolean {
  return TICKET_TRANSITIONS[from]?.includes(to) ?? false;
}

@Injectable()
export class KitchenTicketsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FeatureResolver) private readonly featureResolver: FeatureResolver,
    @Inject(KitchenRoutingService) private readonly routingService: KitchenRoutingService,
    @Inject(FulfillmentStatusService) private readonly fulfillmentStatusService: FulfillmentStatusService,
  ) {}

  // ─── Create Tickets for a Confirmed Order ──

  /**
   * Create kitchen tickets for a confirmed order.
   * Groups order lines by their assigned kitchen station.
   * Called by PaymentService after order confirmation.
   * Idempotent: if tickets already exist for this order, returns them.
   */
  async createTicketsForOrder(params: {
    tenantId: string;
    branchId: string;
    orderId: string;
    actorUserId?: string;
  }) {
    const { tenantId, branchId, orderId, actorUserId } = params;

    // Check if tickets already exist (idempotent)
    const existingTickets = await this.prisma.kitchenTicket.findMany({
      where: { tenantId, branchId, orderId },
    });

    if (existingTickets.length > 0) {
      return { tickets: existingTickets.map((t) => this.serializeTicket(t)), idempotent: true };
    }

    // Resolve order lines to station routes via routing service
    const stationGroups = await this.routingService.resolveOrderRoutes({
      tenantId,
      branchId,
      orderId,
    });
    if (stationGroups.length === 0) {
      return { tickets: [], idempotent: false, reason: 'NO_STATIONS_ASSIGNED' };
    }

    const tickets = await this.prisma.$transaction(async (tx) => {
      const created = [];

      for (const group of stationGroups) {
        // Increment ticket counter for this station
        const counter = await tx.stationTicketCounter.upsert({
          where: { branchId_stationId: { branchId, stationId: group.stationId } },
          create: { branchId, stationId: group.stationId, lastNumber: 1 },
          update: { lastNumber: { increment: 1 } },
        });

        const ticket = await tx.kitchenTicket.create({
          data: {
            tenantId,
            branchId,
            orderId,
            stationId: group.stationId,
            kitchenId: group.kitchenId,
            ticketNumber: counter.lastNumber,
            ticketType: group.ticketType,
            status: 'QUEUED',
            priority: 0,
            collectionLabelSnapshot: group.collectionLabelSnapshot,
          },
        });

        // Create ticket lines with route snapshots
        for (const tl of group.ticketLines) {
          await tx.kitchenTicketLine.create({
            data: {
              tenantId,
              branchId,
              ticketId: ticket.id,
              orderLineId: tl.orderLineId,
              routeType: tl.routeType,
              isRequired: true,
              quantity: tl.quantity,
              itemNameSnapshot: tl.itemNameSnapshot,
              variantNameSnapshot: tl.variantNameSnapshot,
              notesSnapshot: tl.notesSnapshot,
            },
          });
        }

        // Write route snapshots as ticket history for audit trail
        await tx.kitchenTicketHistory.create({
          data: {
            tenantId,
            branchId,
            ticketId: ticket.id,
            fromStatus: null,
            toStatus: 'QUEUED',
            actorUserId: actorUserId ?? null,
            metadata: {
              ticketType: group.ticketType,
              kitchenId: group.kitchenId,
              collectionLabel: group.collectionLabelSnapshot,
              routes: group.routes.map((r) => ({
                stationId: r.stationId,
                stationName: r.stationName,
                routeType: r.routeType,
                kitchenName: r.kitchenName,
              })),
            },
          },
        });

        // Audit
        await tx.auditLog.create({
          data: {
            actorUserId: actorUserId ?? null,
            tenantId,
            branchId,
            action: 'KITCHEN_TICKET_CREATE',
            entityType: 'KitchenTicket',
            entityId: ticket.id,
            afterJson: {
              orderId,
              stationId: group.stationId,
              kitchenId: group.kitchenId,
              ticketNumber: counter.lastNumber.toString(),
              ticketType: group.ticketType,
              lineCount: group.ticketLines.length,
              routeCount: group.routes.length,
            },
          },
        });

        created.push(ticket);
      }

      return created;
    });

    return { tickets: tickets.map((t) => this.serializeTicket(t)), idempotent: false };
  }

  // ─── List Tickets (Staff) ─────────────────

  async listTickets(params: {
    tenantId: string;
    branchId: string;
    stationId?: string;
    status?: string;
    limit?: number;
    after?: string;
  }) {
    const { tenantId, branchId, stationId, status, limit = 50, after } = params;

    const tickets = await this.prisma.kitchenTicket.findMany({
      where: {
        tenantId,
        branchId,
        ...(stationId && { stationId }),
        ...(status && { status }),
      },
      include: {
        station: { select: { name: true } },
        order: { select: { orderNumber: true, tableId: true, customerName: true } },
        lines: true,
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      take: limit,
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
    });

    // Collect all orderLineIds and fetch them in bulk
    const orderLineIds = tickets.flatMap((t) => t.lines.map((l) => l.orderLineId));
    const orderLines = orderLineIds.length > 0
      ? await this.prisma.orderLine.findMany({
          where: { id: { in: orderLineIds } },
          select: { id: true, itemNameSnapshot: true, variantNameSnapshot: true, notes: true },
        })
      : [];
    const orderLineMap = new Map(orderLines.map((ol) => [ol.id, ol]));

    return tickets.map((t) => ({
      ...this.serializeTicket(t),
      stationName: t.station?.name,
      orderNumber: t.order?.orderNumber?.toString(),
      tableId: t.order?.tableId,
      customerName: t.order?.customerName,
      lines: t.lines.map((l) => {
        const ol = orderLineMap.get(l.orderLineId);
        return {
          id: l.id,
          orderLineId: l.orderLineId,
          quantity: l.quantity,
          status: l.status,
          itemName: ol?.itemNameSnapshot,
          variantName: ol?.variantNameSnapshot,
          notes: ol?.notes,
        };
      }),
    }));
  }

  // ─── Get Single Ticket ────────────────────

  async getTicket(params: {
    tenantId: string;
    branchId: string;
    ticketId: string;
  }) {
    const ticket = await this.prisma.kitchenTicket.findFirst({
      where: { id: params.ticketId, tenantId: params.tenantId, branchId: params.branchId },
      include: {
        station: { select: { name: true } },
        order: { select: { orderNumber: true, tableId: true, customerName: true } },
        lines: true,
        history: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!ticket) throw new NotFoundException('Ticket not found');

    // Fetch order line details
    const orderLineIds = ticket.lines.map((l) => l.orderLineId);
    const orderLines = orderLineIds.length > 0
      ? await this.prisma.orderLine.findMany({
          where: { id: { in: orderLineIds } },
          select: { id: true, itemNameSnapshot: true, variantNameSnapshot: true, notes: true },
        })
      : [];
    const orderLineMap = new Map(orderLines.map((ol) => [ol.id, ol]));

    return {
      ...this.serializeTicket(ticket),
      stationName: ticket.station?.name,
      orderNumber: ticket.order?.orderNumber?.toString(),
      tableId: ticket.order?.tableId,
      customerName: ticket.order?.customerName,
      lines: ticket.lines.map((l) => {
        const ol = orderLineMap.get(l.orderLineId);
        return {
          id: l.id,
          orderLineId: l.orderLineId,
          quantity: l.quantity,
          status: l.status,
          itemName: ol?.itemNameSnapshot,
          variantName: ol?.variantNameSnapshot,
          notes: ol?.notes,
        };
      }),
      history: ticket.history.map((h) => ({
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        actorUserId: h.actorUserId,
        reason: h.reason,
        createdAt: h.createdAt,
      })),
    };
  }

  // ─── Bump Ticket (QUEUED → IN_PROGRESS → READY) ──

  async bumpTicket(params: {
    tenantId: string;
    branchId: string;
    ticketId: string;
    actorUserId: string;
    reason?: string;
    expectedVersion: number;
  }) {
    const { tenantId, branchId, ticketId, actorUserId, reason, expectedVersion } = params;

    // Service-level feature assertion
    await this.featureResolver.assertEffective(tenantId, FeatureKey.KDS, branchId);

    const ticket = await this.prisma.kitchenTicket.findFirst({
      where: { id: ticketId, tenantId, branchId },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    const nextStatus = ticket.status === 'QUEUED' ? 'IN_PROGRESS' : ticket.status === 'IN_PROGRESS' ? 'READY' : null;
    if (!nextStatus) {
      throw new ConflictException(`Cannot bump ticket in status ${ticket.status}`);
    }

    if (!canTicketTransition(ticket.status, nextStatus)) {
      throw new ConflictException(`Cannot transition from ${ticket.status} to ${nextStatus}`);
    }

    if (ticket.version !== expectedVersion) {
      throw new ConflictException({
        code: 'VERSION_CONFLICT',
        message: 'Ticket has been modified. Please refresh.',
        currentVersion: ticket.version,
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.kitchenTicket.updateMany({
        where: { id: ticketId, version: expectedVersion },
        data: {
          status: nextStatus,
          ...(nextStatus === 'IN_PROGRESS' && { startedAt: new Date() }),
          ...(nextStatus === 'READY' && { readyAt: new Date() }),
          version: { increment: 1 },
        },
      });

      if (updated.count !== 1) {
        throw new ConflictException('Version conflict');
      }

      const latestTicket = await tx.kitchenTicket.findUnique({ where: { id: ticketId } });

      await tx.kitchenTicketHistory.create({
        data: {
          tenantId,
          branchId,
          ticketId,
          fromStatus: ticket.status,
          toStatus: nextStatus,
          actorUserId,
          reason,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          tenantId,
          branchId,
          action: 'KITCHEN_TICKET_BUMP',
          entityType: 'KitchenTicket',
          entityId: ticketId,
          beforeJson: { status: ticket.status },
          afterJson: { status: nextStatus },
        },
      });

      await tx.outboxEvent.create({
        data: {
          tenantId,
          branchId,
          aggregateType: 'KitchenTicket',
          aggregateId: ticketId,
          eventType: `ticket.${nextStatus.toLowerCase()}`,
          payload: {
            ticketId,
            orderId: ticket.orderId,
            stationId: ticket.stationId,
            fromStatus: ticket.status,
            toStatus: nextStatus,
          },
        },
      });

      return latestTicket;
    });

    return this.serializeTicket(result!);
  }

  // ─── Recall Ticket (READY → IN_PROGRESS) ──

  async recallTicket(params: {
    tenantId: string;
    branchId: string;
    ticketId: string;
    actorUserId: string;
    reason: string;
    expectedVersion: number;
  }) {
    const { tenantId, branchId, ticketId, actorUserId, reason, expectedVersion } = params;

    // Service-level feature assertion
    await this.featureResolver.assertEffective(tenantId, FeatureKey.KDS, branchId);

    const ticket = await this.prisma.kitchenTicket.findFirst({
      where: { id: ticketId, tenantId, branchId },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    if (ticket.status !== 'READY') {
      throw new ConflictException(`Can only recall READY tickets, got ${ticket.status}`);
    }

    if (ticket.version !== expectedVersion) {
      throw new ConflictException({
        code: 'VERSION_CONFLICT',
        message: 'Ticket has been modified. Please refresh.',
        currentVersion: ticket.version,
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.kitchenTicket.updateMany({
        where: { id: ticketId, version: expectedVersion },
        data: {
          status: 'IN_PROGRESS',
          readyAt: null,
          version: { increment: 1 },
        },
      });

      if (updated.count !== 1) {
        throw new ConflictException('Version conflict');
      }

      const latestTicket = await tx.kitchenTicket.findUnique({ where: { id: ticketId } });

      await tx.kitchenTicketHistory.create({
        data: {
          tenantId,
          branchId,
          ticketId,
          fromStatus: 'READY',
          toStatus: 'IN_PROGRESS',
          actorUserId,
          reason,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          tenantId,
          branchId,
          action: 'KITCHEN_TICKET_RECALL',
          entityType: 'KitchenTicket',
          entityId: ticketId,
          beforeJson: { status: 'READY' },
          afterJson: { status: 'IN_PROGRESS', reason },
        },
      });

      await tx.outboxEvent.create({
        data: {
          tenantId,
          branchId,
          aggregateType: 'KitchenTicket',
          aggregateId: ticketId,
          eventType: 'ticket.recalled',
          payload: {
            ticketId,
            orderId: ticket.orderId,
            stationId: ticket.stationId,
            reason,
          },
        },
      });

      return latestTicket;
    });

    return this.serializeTicket(result!);
  }

  // ─── Complete Ticket (READY → COMPLETED) ──

  async completeTicket(params: {
    tenantId: string;
    branchId: string;
    ticketId: string;
    actorUserId: string;
    expectedVersion: number;
  }) {
    const { tenantId, branchId, ticketId, actorUserId, expectedVersion } = params;

    // Service-level feature assertion
    await this.featureResolver.assertEffective(tenantId, FeatureKey.KDS, branchId);

    const ticket = await this.prisma.kitchenTicket.findFirst({
      where: { id: ticketId, tenantId, branchId },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    if (ticket.status !== 'READY') {
      throw new ConflictException(`Can only complete READY tickets, got ${ticket.status}`);
    }

    if (ticket.version !== expectedVersion) {
      throw new ConflictException({
        code: 'VERSION_CONFLICT',
        message: 'Ticket has been modified. Please refresh.',
        currentVersion: ticket.version,
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.kitchenTicket.updateMany({
        where: { id: ticketId, version: expectedVersion },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          version: { increment: 1 },
        },
      });

      if (updated.count !== 1) {
        throw new ConflictException('Version conflict');
      }

      const latestTicket = await tx.kitchenTicket.findUnique({ where: { id: ticketId } });

      await tx.kitchenTicketHistory.create({
        data: {
          tenantId,
          branchId,
          ticketId,
          fromStatus: 'READY',
          toStatus: 'COMPLETED',
          actorUserId,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          tenantId,
          branchId,
          action: 'KITCHEN_TICKET_COMPLETE',
          entityType: 'KitchenTicket',
          entityId: ticketId,
          beforeJson: { status: 'READY' },
          afterJson: { status: 'COMPLETED' },
        },
      });

      await tx.outboxEvent.create({
        data: {
          tenantId,
          branchId,
          aggregateType: 'KitchenTicket',
          aggregateId: ticketId,
          eventType: 'ticket.completed',
          payload: {
            ticketId,
            orderId: ticket.orderId,
            stationId: ticket.stationId,
          },
        },
      });

      // Check if all tickets for this order are completed
      const pendingCount = await tx.kitchenTicket.count({
        where: {
          orderId: ticket.orderId,
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
        },
      });

      if (pendingCount === 0) {
        // All tickets done → derive and apply fulfillment status
        const fulfillment = await this.fulfillmentStatusService.deriveFulfillmentStatus({
          tenantId,
          branchId,
          orderId: ticket.orderId,
        });

        await tx.order.updateMany({
          where: { id: ticket.orderId },
          data: { fulfillmentStatus: fulfillment.fulfillmentStatus },
        });

        if (fulfillment.fulfillmentStatus === FulfillmentStatus.READY_FOR_SERVICE && fulfillment.readyAt) {
          await tx.order.updateMany({
            where: { id: ticket.orderId },
            data: { readyForServiceAt: fulfillment.readyAt },
          });
        }

        await tx.orderStatusHistory.create({
          data: {
            tenantId,
            branchId,
            orderId: ticket.orderId,
            fromStatus: 'IN_PROGRESS',
            toStatus: fulfillment.fulfillmentStatus,
            actorUserId,
          },
        });

        await tx.outboxEvent.create({
          data: {
            tenantId,
            branchId,
            aggregateType: 'Order',
            aggregateId: ticket.orderId,
            eventType: 'order.fulfillment.status_changed',
            payload: {
              orderId: ticket.orderId,
              toStatus: fulfillment.fulfillmentStatus,
            },
          },
        });
      }

      return latestTicket;
    });

    return this.serializeTicket(result!);
  }

  // ─── Cancel Ticket ────────────────────────

  async cancelTicket(params: {
    tenantId: string;
    branchId: string;
    ticketId: string;
    actorUserId: string;
    reason?: string;
    expectedVersion: number;
  }) {
    const { tenantId, branchId, ticketId, actorUserId, reason, expectedVersion } = params;

    // Service-level feature assertion
    await this.featureResolver.assertEffective(tenantId, FeatureKey.KDS, branchId);

    const ticket = await this.prisma.kitchenTicket.findFirst({
      where: { id: ticketId, tenantId, branchId },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    if (!canTicketTransition(ticket.status, 'CANCELLED')) {
      throw new ConflictException(`Cannot cancel ticket in status ${ticket.status}`);
    }

    if (ticket.version !== expectedVersion) {
      throw new ConflictException({
        code: 'VERSION_CONFLICT',
        message: 'Ticket has been modified. Please refresh.',
        currentVersion: ticket.version,
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.kitchenTicket.updateMany({
        where: { id: ticketId, version: expectedVersion },
        data: {
          status: 'CANCELLED',
          version: { increment: 1 },
        },
      });

      if (updated.count !== 1) {
        throw new ConflictException('Version conflict');
      }

      const latestTicket = await tx.kitchenTicket.findUnique({ where: { id: ticketId } });

      await tx.kitchenTicketHistory.create({
        data: {
          tenantId,
          branchId,
          ticketId,
          fromStatus: ticket.status,
          toStatus: 'CANCELLED',
          actorUserId,
          reason,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          tenantId,
          branchId,
          action: 'KITCHEN_TICKET_CANCEL',
          entityType: 'KitchenTicket',
          entityId: ticketId,
          beforeJson: { status: ticket.status },
          afterJson: { status: 'CANCELLED', reason },
        },
      });

      return latestTicket;
    });

    return this.serializeTicket(result!);
  }

  // ─── Helpers ──────────────────────────────

  private serializeTicket(ticket: any) {
    return {
      id: ticket.id,
      orderId: ticket.orderId,
      stationId: ticket.stationId,
      ticketNumber: ticket.ticketNumber?.toString?.() ?? ticket.ticketNumber,
      status: ticket.status,
      priority: ticket.priority,
      estimatedReadyAt: ticket.estimatedReadyAt,
      startedAt: ticket.startedAt,
      readyAt: ticket.readyAt,
      completedAt: ticket.completedAt,
      version: ticket.version,
      createdAt: ticket.createdAt,
    };
  }
}
