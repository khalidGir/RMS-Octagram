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
   * Status derivation rules:
   * - NOT_ROUTED: no tickets exist for this order
   * - QUEUED: tickets exist but none are in progress or ready
   * - PREPARING: at least one ticket is IN_PROGRESS, none are READY
   * - PARTIALLY_READY: at least one READY, at least one still PREPARING
   * - READY_FOR_SERVICE: all active tickets are READY or COMPLETED
   * - PARTIALLY_SERVED: some lines served, others still ready
   * - SERVED: all lines served
   * - CANCELLED: all tickets cancelled
   *
   * The result is based on a snapshot of current ticket states and should
   * be applied transactionally by the caller.
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
      select: { status: true, readyAt: true },
    });

    if (tickets.length === 0) {
      return { fulfillmentStatus: FulfillmentStatus.NOT_ROUTED, readyAt: null, servedAt: null };
    }

    const statuses = tickets.map((t: { status: string; readyAt: Date | null }) => t.status);
    const activeStatuses = statuses.filter((s: string) => s !== 'CANCELLED');

    // All tickets cancelled
    if (activeStatuses.length === 0) {
      return { fulfillmentStatus: FulfillmentStatus.CANCELLED, readyAt: null, servedAt: null };
    }

    const hasReady = activeStatuses.includes('READY');
    const hasCompleted = activeStatuses.includes('COMPLETED');
    const hasInProgress = activeStatuses.includes('IN_PROGRESS');
    const hasQueued = activeStatuses.includes('QUEUED');

    // All active tickets are READY or COMPLETED
    if (!hasInProgress && !hasQueued && (hasReady || hasCompleted)) {
      return {
        fulfillmentStatus: FulfillmentStatus.READY_FOR_SERVICE,
        readyAt: this.latestReadyAt(tickets),
        servedAt: null,
      };
    }

    // At least one READY but others still in progress
    if (hasReady && (hasInProgress || hasQueued)) {
      return {
        fulfillmentStatus: FulfillmentStatus.PARTIALLY_READY,
        readyAt: null,
        servedAt: null,
      };
    }

    // At least one in progress, none ready yet
    if (hasInProgress && !hasReady) {
      return {
        fulfillmentStatus: FulfillmentStatus.PREPARING,
        readyAt: null,
        servedAt: null,
      };
    }

    // All active are queued
    if (hasQueued && !hasReady && !hasInProgress) {
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
