import { Injectable } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PrismaService } from '../prisma/prisma.service';
import { FulfillmentStatus } from '@rms/contracts';
import type { Prisma } from '@rms/database';

export interface FulfillmentStatusResult {
  fulfillmentStatus: FulfillmentStatus;
  readyAt: Date | null;
  servedAt: Date | null;
}

@Injectable()
export class FulfillmentStatusService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Derive the fulfillment status for an order based on its kitchen tickets.
   *
   * Status derivation rules (with PREPARE/ASSEMBLE separation):
   * - NOT_ROUTED: no tickets exist for this order
   * - QUEUED: tickets exist but none are in progress or ready
   * - PREPARING: at least one required PREPARATION ticket is IN_PROGRESS, none are READY
   * - PARTIALLY_READY: at least one required PREPARATION ticket is READY, others still active
   * - READY_FOR_EXPO: all active required PREPARATION tickets are READY/COMPLETED, EXPO not yet ready
   * - READY_FOR_SERVICE: all active required tickets (prep + expo) are READY/COMPLETED
   * - PARTIALLY_SERVED: some lines served, others still ready
   * - SERVED: all lines served
   * - CANCELLED: all tickets cancelled
   *
   * PREPARATION tickets (normal stations) drive preparation readiness.
   * EXPO tickets (expo stations) are assembly/collection and don't count
   * as duplicated preparation quantities.
   *
   * Only REQUIRED allocations block readiness — optional routes are ignored
   * for fulfillment derivation.
   */
  async deriveFulfillmentStatus(params: {
    tenantId: string;
    branchId: string;
    orderId: string;
    tx?: Prisma.TransactionClient;
  }): Promise<FulfillmentStatusResult> {
    const { tenantId, branchId, orderId, tx } = params;
    const client = tx ?? this.prisma;

    const tickets = await client.kitchenTicket.findMany({
      where: { orderId, tenantId, branchId },
      select: { id: true, status: true, readyAt: true, ticketType: true },
    });

    if (tickets.length === 0) {
      return { fulfillmentStatus: FulfillmentStatus.NOT_ROUTED, readyAt: null, servedAt: null };
    }

    // All tickets cancelled check (before per-type filtering)
    const activeStatuses = tickets.filter((t) => t.status !== 'CANCELLED');
    if (activeStatuses.length === 0) {
      return { fulfillmentStatus: FulfillmentStatus.CANCELLED, readyAt: null, servedAt: null };
    }

    // Fetch ticket lines to determine which tickets have required lines
    const ticketIds = tickets.map((t) => t.id);
    const allLines = await client.kitchenTicketLine.findMany({
      where: { ticketId: { in: ticketIds } },
      select: { ticketId: true, isRequired: true, status: true, quantity: true, quantityServed: true, routeType: true },
    });

    // Build a set of ticketIds that have at least one required, non-cancelled line
    const requiredTicketIds = new Set<string>();
    for (const line of allLines) {
      if (line.isRequired && line.status !== 'CANCELLED') {
        requiredTicketIds.add(line.ticketId);
      }
    }

    // Separate PREPARATION and EXPO tickets, considering only required ones
    const prepRequired = tickets.filter(
      (t) => t.ticketType === 'PREPARATION' && requiredTicketIds.has(t.id),
    );
    const expoRequired = tickets.filter(
      (t) => t.ticketType === 'EXPO' && requiredTicketIds.has(t.id),
    );

    // Check PREPARATION ticket statuses (required only)
    const prepActive = prepRequired.filter((t) => t.status !== 'CANCELLED');
    const prepHasReady = prepActive.some((t) => t.status === 'READY');
    const prepHasInProgress = prepActive.some((t) => t.status === 'IN_PROGRESS');
    const prepHasQueued = prepActive.some((t) => t.status === 'QUEUED');
    // P0 FIX: prepActive.length > 0 prevents true-on-empty-array bug
    const prepAllDone = prepActive.length > 0 && prepActive.every((t) => t.status === 'READY' || t.status === 'COMPLETED');

    // Check EXPO ticket statuses (required only)
    const expoActive = expoRequired.filter((t) => t.status !== 'CANCELLED');
    const expoAllDone = expoActive.length === 0 || expoActive.every((t) => t.status === 'READY' || t.status === 'COMPLETED');

    // No required prep tickets at all → only expo (or all optional) — treat prep as done
    const hasRequiredPrep = prepRequired.length > 0;

    // Check if any required lines have been served (for SERVED/PARTIALLY_SERVED derivation)
    const requiredLines = allLines.filter(
      (l) => l.isRequired && l.status !== 'CANCELLED' && l.routeType === 'PREPARE',
    );
    const totalRequiredQuantity = requiredLines.reduce((sum, l) => sum + l.quantity, 0);
    const totalServedQuantity = requiredLines.reduce((sum, l) => sum + l.quantityServed, 0);
    const allServed = totalRequiredQuantity > 0 && totalServedQuantity >= totalRequiredQuantity;
    const someServed = totalServedQuantity > 0 && !allServed;

    // SERVED: all required lines served
    if (allServed && (!hasRequiredPrep || prepAllDone) && expoAllDone) {
      const servedAt = this.latestServedAt(allLines);
      return {
        fulfillmentStatus: FulfillmentStatus.SERVED,
        readyAt: this.latestReadyAt(tickets),
        servedAt,
      };
    }

    // PARTIALLY_SERVED: some lines served but not all
    if (someServed && (!hasRequiredPrep || prepAllDone) && expoAllDone) {
      return {
        fulfillmentStatus: FulfillmentStatus.PARTIALLY_SERVED,
        readyAt: this.latestReadyAt(tickets),
        servedAt: null,
      };
    }

    // READY_FOR_SERVICE: ALL active required tickets (prep + expo) are READY or COMPLETED
    if ((!hasRequiredPrep || prepAllDone) && expoAllDone) {
      return {
        fulfillmentStatus: FulfillmentStatus.READY_FOR_SERVICE,
        readyAt: this.latestReadyAt(tickets),
        servedAt: null,
      };
    }

    // READY_FOR_EXPO: all required prep tickets READY/COMPLETED, but expo still pending
    if (hasRequiredPrep && prepAllDone && expoActive.length > 0 && !expoAllDone) {
      return {
        fulfillmentStatus: FulfillmentStatus.READY_FOR_EXPO,
        readyAt: this.latestReadyAt(prepRequired),
        servedAt: null,
      };
    }

    // PARTIALLY_READY: at least one required prep READY, others still active
    if (hasRequiredPrep && prepHasReady && (prepHasInProgress || prepHasQueued)) {
      return {
        fulfillmentStatus: FulfillmentStatus.PARTIALLY_READY,
        readyAt: null,
        servedAt: null,
      };
    }

    // PREPARING: at least one required prep IN_PROGRESS, none READY yet
    if (hasRequiredPrep && prepHasInProgress && !prepHasReady) {
      return {
        fulfillmentStatus: FulfillmentStatus.PREPARING,
        readyAt: null,
        servedAt: null,
      };
    }

    // QUEUED: all active required are queued
    if (hasRequiredPrep && prepHasQueued && !prepHasReady && !prepHasInProgress) {
      return {
        fulfillmentStatus: FulfillmentStatus.QUEUED,
        readyAt: null,
        servedAt: null,
      };
    }

    // No required prep, no active expo → READY_FOR_SERVICE
    if (!hasRequiredPrep && expoActive.length === 0) {
      return {
        fulfillmentStatus: FulfillmentStatus.READY_FOR_SERVICE,
        readyAt: this.latestReadyAt(tickets),
        servedAt: null,
      };
    }

    return {
      fulfillmentStatus: FulfillmentStatus.QUEUED,
      readyAt: null,
      servedAt: null,
    };
  }

  /**
   * Compute fulfillment status from a set of ticket status strings.
   * Useful for testing and when ticket data is already available.
   * This overload doesn't distinguish PREPARE/ASSEMBLE — use the instance method for that.
   */
  static computeFromStatuses(ticketStatuses: string[]): FulfillmentStatus {
    if (ticketStatuses.length === 0) return FulfillmentStatus.NOT_ROUTED;

    const active = ticketStatuses.filter((s) => s !== 'CANCELLED');
    if (active.length === 0) return FulfillmentStatus.CANCELLED;

    const hasReady = active.includes('READY');
    const hasCompleted = active.includes('COMPLETED');
    const hasInProgress = active.includes('IN_PROGRESS');
    const hasQueued = active.includes('QUEUED');

    if (!hasInProgress && !hasQueued && (hasReady || hasCompleted)) {
      return FulfillmentStatus.READY_FOR_SERVICE;
    }
    if (hasReady && (hasInProgress || hasQueued)) {
      return FulfillmentStatus.PARTIALLY_READY;
    }
    if (hasInProgress && !hasReady) {
      return FulfillmentStatus.PREPARING;
    }
    return FulfillmentStatus.QUEUED;
  }

  /**
   * Apply fulfillment status to an order and write history if changed.
   * Returns true if status was updated, false if unchanged.
   */
  async applyFulfillmentStatus(params: {
    tenantId: string;
    branchId: string;
    orderId: string;
    actorUserId?: string;
  }): Promise<{ updated: boolean; status: FulfillmentStatus }> {
    const { tenantId, branchId, orderId, actorUserId } = params;

    const current = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId, branchId },
      select: { id: true, fulfillmentStatus: true },
    });
    if (!current) return { updated: false, status: FulfillmentStatus.NOT_ROUTED };

    const derived = await this.deriveFulfillmentStatus({ tenantId, branchId, orderId });

    if (current.fulfillmentStatus === derived.fulfillmentStatus) {
      return { updated: false, status: derived.fulfillmentStatus };
    }

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.order.update({
        where: { id: orderId },
        data: { fulfillmentStatus: derived.fulfillmentStatus },
      });

      if (derived.fulfillmentStatus === FulfillmentStatus.READY_FOR_SERVICE) {
        await tx.order.update({
          where: { id: orderId },
          data: { readyForServiceAt: new Date() },
        });
      }

      await tx.orderStatusHistory.create({
        data: {
          tenantId,
          branchId,
          orderId,
          fromStatus: current.fulfillmentStatus,
          toStatus: derived.fulfillmentStatus,
          actorUserId: actorUserId ?? null,
        },
      });

      await tx.outboxEvent.create({
        data: {
          tenantId,
          branchId,
          aggregateType: 'Order',
          aggregateId: orderId,
          eventType: 'order.fulfillment.status_changed',
          payload: {
            orderId,
            fromStatus: current.fulfillmentStatus,
            toStatus: derived.fulfillmentStatus,
          },
        },
      });
    });

    return { updated: true, status: derived.fulfillmentStatus };
  }

  private latestReadyAt(tickets: { readyAt: Date | null }[]): Date | null {
    let latest: Date | null = null;
    for (const t of tickets) {
      if (t.readyAt && (!latest || t.readyAt > latest)) {
        latest = t.readyAt;
      }
    }
    return latest;
  }

  private latestServedAt(lines: { status: string }[]): Date | null {
    // Since we don't have servedAt in the select, derive from status
    // The actual servedAt is set on the line; this is a fallback
    return lines.some((l) => l.status === 'SERVED') ? new Date() : null;
  }
}
