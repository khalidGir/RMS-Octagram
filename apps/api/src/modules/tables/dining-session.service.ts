import { Injectable, Inject, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DiningSessionStatus } from '@rms/contracts';
import type { PrismaClient } from '@prisma/client';

export type PrismaTransactionClient = PrismaClient | Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

export interface SessionSummary {
  id: string;
  tenantId: string;
  branchId: string;
  tableId: string;
  status: string;
  version: number;
  guestCount: number | null;
  openedAt: Date;
  closedAt: Date | null;
  openedByUserId: string | null;
  clearedByUserId: string | null;
  clearReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  orderCount: number;
}

export interface TableOccupancy {
  tableId: string;
  label: string;
  capacity: number;
  isActive: boolean;
  sessionId: string | null;
  sessionStatus: string | null;
  openOrderCount: number;
}

@Injectable()
export class DiningSessionService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Atomically open a new session or join an existing one for a table.
   * Called during order confirmation for DINE_IN orders.
   *
   * Uses SELECT FOR UPDATE to prevent concurrent session creation on the same table.
   * Accepts an optional transaction client for atomic integration with order confirmation.
   * Returns the session (new or existing) with the order associated.
   */
  async openOrJoinSession(params: {
    tenantId: string;
    branchId: string;
    tableId: string;
    orderId: string;
    actorUserId?: string;
    guestCount?: number;
    tx?: PrismaTransactionClient;
  }): Promise<SessionSummary> {
    const { tenantId, branchId, tableId, orderId, actorUserId, guestCount, tx: providedTx } = params;

    const run = async (tx: PrismaTransactionClient) => {
      // Verify table exists and belongs to this branch
      const table = await tx.restaurantTable.findFirst({
        where: { id: tableId, tenantId, branchId, isActive: true },
      });
      if (!table) {
        throw new NotFoundException(`Table ${tableId} not found or inactive`);
      }

      // Lock any existing OPEN session for this table to prevent concurrent creation
      const existingSessions = await tx.$queryRaw<
        Array<{ id: string; version: number }>
      >`
        SELECT id, version
        FROM "DiningSession"
        WHERE "tableId" = ${tableId}
          AND "status" = 'OPEN'
        FOR UPDATE
      `;

      if (existingSessions.length > 0) {
        // Join existing session
        const existing = existingSessions[0];

        // Associate order with existing session
        await tx.order.update({
          where: { id: orderId },
          data: { diningSessionId: existing.id },
        });

        // Update guest count if provided
        if (guestCount != null) {
          await tx.diningSession.update({
            where: { id: existing.id },
            data: { guestCount },
          });
        }

        return tx.diningSession.findUnique({ where: { id: existing.id } });
      }

      // Create new session
      const newSession = await tx.diningSession.create({
        data: {
          tenantId,
          branchId,
          tableId,
          status: DiningSessionStatus.OPEN,
          guestCount: guestCount ?? null,
          openedByUserId: actorUserId ?? null,
        },
      });

      // Associate order with new session
      await tx.order.update({
        where: { id: orderId },
        data: { diningSessionId: newSession.id },
      });

      return newSession;
    };

    // Use provided transaction or wrap in one
    const session = providedTx
      ? await run(providedTx)
      : await this.prisma.$transaction(run);

    if (!session) {
      throw new ConflictException('Failed to create or join dining session');
    }

    return this.serializeSession(session);
  }

  /**
   * Clear a dining session. Only allowed when ALL linked orders are terminal
   * (COMPLETED, CANCELLED, or VOIDED).
   *
   * Uses optimistic locking via version field.
   */
  async clearSession(params: {
    tenantId: string;
    branchId: string;
    sessionId: string;
    actorUserId: string;
    clearReason?: string;
    expectedVersion: number;
  }): Promise<SessionSummary> {
    const { tenantId, branchId, sessionId, actorUserId, clearReason, expectedVersion } = params;

    const result = await this.prisma.$transaction(async (tx) => {
      // Lock the session
      const sessions = await tx.$queryRaw<
        Array<{ id: string; version: number; status: string }>
      >`
        SELECT id, version, status
        FROM "DiningSession"
        WHERE id = ${sessionId}
          AND "tenantId" = ${tenantId}
          AND "branchId" = ${branchId}
        FOR UPDATE
      `;

      if (sessions.length === 0) {
        throw new NotFoundException(`Session ${sessionId} not found`);
      }

      const session = sessions[0];

      if (session.status === DiningSessionStatus.CLEARED) {
        // Idempotent: already cleared
        return tx.diningSession.findUnique({ where: { id: sessionId } });
      }

      if (session.status !== DiningSessionStatus.OPEN) {
        throw new ConflictException(`Session is ${session.status}, expected OPEN`);
      }

      if (session.version !== expectedVersion) {
        throw new ConflictException(
          `Version conflict: expected ${expectedVersion}, got ${session.version}. Refresh and retry.`,
        );
      }

      // Check all linked orders are terminal
      const nonTerminalOrders = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status
        FROM "Order"
        WHERE "diningSessionId" = ${sessionId}
          AND status NOT IN ('COMPLETED', 'CANCELLED', 'VOIDED')
      `;

      if (nonTerminalOrders.length > 0) {
        throw new ConflictException(
          `TABLE_SESSION_NOT_CLEARABLE: ${nonTerminalOrders.length} non-terminal order(s) remain`,
        );
      }

      // Clear the session
      const now = new Date();
      await tx.diningSession.update({
        where: { id: sessionId },
        data: {
          status: DiningSessionStatus.CLEARED,
          closedAt: now,
          clearedByUserId: actorUserId,
          clearReason: clearReason ?? null,
          version: { increment: 1 },
        },
      });

      return tx.diningSession.findUnique({ where: { id: sessionId } });
    });

    return this.serializeSession(result!);
  }

  /**
   * Get a single session with details.
   */
  async getSession(params: {
    tenantId: string;
    branchId: string;
    sessionId: string;
  }): Promise<SessionSummary & { orders: Array<{ id: string; status: string; orderType: string }> }> {
    const { tenantId, branchId, sessionId } = params;

    const session = await this.prisma.diningSession.findFirst({
      where: { id: sessionId, tenantId, branchId },
      include: {
        orders: { select: { id: true, status: true, orderType: true } },
      },
    });

    if (!session) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }

    return {
      ...this.serializeSession(session),
      orders: session.orders,
    };
  }

  /**
   * List open sessions for a branch.
   */
  async listOpenSessions(params: {
    tenantId: string;
    branchId: string;
  }): Promise<SessionSummary[]> {
    const { tenantId, branchId } = params;

    const sessions = await this.prisma.diningSession.findMany({
      where: {
        tenantId,
        branchId,
        status: DiningSessionStatus.OPEN,
      },
      orderBy: { openedAt: 'desc' },
    });

    return sessions.map((s) => this.serializeSession(s));
  }

  /**
   * Get table occupancy projection for all tables in a branch.
   * Shows which tables are occupied and how many open orders they have.
   */
  async getTableOccupancy(params: {
    tenantId: string;
    branchId: string;
  }): Promise<TableOccupancy[]> {
    const { tenantId, branchId } = params;

    const tables = await this.prisma.restaurantTable.findMany({
      where: { tenantId, branchId },
      orderBy: { label: 'asc' },
    });

    const openSessions = await this.prisma.diningSession.findMany({
      where: {
        tenantId,
        branchId,
        status: DiningSessionStatus.OPEN,
      },
      include: {
        orders: {
          where: {
            status: { notIn: ['COMPLETED', 'CANCELLED', 'VOIDED'] },
          },
          select: { id: true },
        },
      },
    });

    const sessionByTable = new Map(
      openSessions.map((s) => [
        s.tableId,
        { sessionId: s.id, sessionStatus: s.status, openOrderCount: s.orders.length },
      ]),
    );

    return tables.map((t) => {
      const occupancy = sessionByTable.get(t.id);
      return {
        tableId: t.id,
        label: t.label,
        capacity: t.capacity,
        isActive: t.isActive,
        sessionId: occupancy?.sessionId ?? null,
        sessionStatus: occupancy?.sessionStatus ?? null,
        openOrderCount: occupancy?.openOrderCount ?? 0,
      };
    });
  }

  private serializeSession(session: {
    id: string;
    tenantId: string;
    branchId: string;
    tableId: string;
    status: string;
    version: number;
    guestCount: number | null;
    openedAt: Date;
    closedAt: Date | null;
    openedByUserId: string | null;
    clearedByUserId: string | null;
    clearReason: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): SessionSummary {
    return {
      id: session.id,
      tenantId: session.tenantId,
      branchId: session.branchId,
      tableId: session.tableId,
      status: session.status,
      version: session.version,
      guestCount: session.guestCount,
      openedAt: session.openedAt,
      closedAt: session.closedAt,
      openedByUserId: session.openedByUserId,
      clearedByUserId: session.clearedByUserId,
      clearReason: session.clearReason,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      orderCount: 0,
    };
  }
}
