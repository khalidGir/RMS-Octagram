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
   * - PREPARING: at least one PREPARATION ticket is IN_PROGRESS, none are READY
   * - PARTIALLY_READY: at least one PREPARATION ticket is READY, others still active
   * - READY_FOR_EXPO: all active PREPARATION tickets are READY/COMPLETED, EXPO tickets not yet ready
   * - READY_FOR_SERVICE: all active tickets (PREPARATION + EXPO) are READY/COMPLETED
   * - PARTIALLY_SERVED: some lines served, others still ready
   * - SERVED: all lines served
   * - CANCELLED: all tickets cancelled
   *
   * PREPARATION tickets (normal stations) drive preparation readiness.
   * EXPO tickets (expo stations) are assembly/collection and don't count
   * as duplicated preparation quantities.
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
      select: { status: true, readyAt: true, ticketType: true },
    });

    if (tickets.length === 0) {
      return { fulfillmentStatus: FulfillmentStatus.NOT_ROUTED, readyAt: null, servedAt: null };
    }

    // Separate PREPARATION and EXPO tickets
    const prepTickets = tickets.filter((t) => t.ticketType === 'PREPARATION');
    const expoTickets = tickets.filter((t) => t.ticketType === 'EXPO');

    // All tickets cancelled
    const allStatuses = tickets.map((t) => t.status);
    const activeStatuses = allStatuses.filter((s) => s !== 'CANCELLED');
    if (activeStatuses.length === 0) {
      return { fulfillmentStatus: FulfillmentStatus.CANCELLED, readyAt: null, servedAt: null };
    }

    // Check PREPARATION ticket statuses
    const prepActive = prepTickets.filter((t) => t.status !== 'CANCELLED');
    const prepHasReady = prepActive.some((t) => t.status === 'READY');
    const prepHasInProgress = prepActive.some((t) => t.status === 'IN_PROGRESS');
    const prepHasQueued = prepActive.some((t) => t.status === 'QUEUED');
    const prepAllDone = prepActive.every((t) => t.status === 'READY' || t.status === 'COMPLETED');

    // Check EXPO ticket statuses
    const expoActive = expoTickets.filter((t) => t.status !== 'CANCELLED');
    const expoAllDone = expoActive.length === 0 || expoActive.every((t) => t.status === 'READY' || t.status === 'COMPLETED');

    // READY_FOR_SERVICE: ALL active tickets (prep + expo) are READY or COMPLETED
    if (prepAllDone && expoAllDone) {
      return {
        fulfillmentStatus: FulfillmentStatus.READY_FOR_SERVICE,
        readyAt: this.latestReadyAt(tickets),
        servedAt: null,
      };
    }

    // READY_FOR_EXPO: all prep tickets READY/COMPLETED, but expo still pending
    if (prepAllDone && expoActive.length > 0 && !expoAllDone) {
      return {
        fulfillmentStatus: FulfillmentStatus.READY_FOR_EXPO,
        readyAt: this.latestReadyAt(prepTickets),
        servedAt: null,
      };
    }

    // PARTIALLY_READY: at least one prep READY, others still active
    if (prepHasReady && (prepHasInProgress || prepHasQueued)) {
      return {
        fulfillmentStatus: FulfillmentStatus.PARTIALLY_READY,
        readyAt: null,
        servedAt: null,
      };
    }

    // PREPARING: at least one prep IN_PROGRESS, none READY yet
    if (prepHasInProgress && !prepHasReady) {
      return {
        fulfillmentStatus: FulfillmentStatus.PREPARING,
        readyAt: null,
        servedAt: null,
      };
    }

    // QUEUED: all active are queued
    if (prepHasQueued && !prepHasReady && !prepHasInProgress) {
      return {
        fulfillmentStatus: FulfillmentStatus.QUEUED,
        readyAt: null,
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
}
