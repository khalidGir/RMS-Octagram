import { describe, it, expect, vi } from 'vitest';
import { FulfillmentStatusService } from './fulfillment-status.service';
import { FulfillmentStatus } from '@rms/contracts';

function mockPrisma(overrides: Record<string, any> = {}) {
  const mock = {
    kitchenTicket: {
      findMany: vi.fn().mockResolvedValue(overrides.tickets ?? []),
    },
    kitchenTicketLine: {
      findMany: vi.fn().mockResolvedValue(
        overrides.ticketLines ??
        // Default: all lines are required
        (overrides.tickets ?? []).flatMap((t: any) => [
          { ticketId: t.id, isRequired: true, status: t.status },
        ]),
      ),
    },
    order: {
      findFirst: vi.fn().mockResolvedValue(overrides.order ?? null),
      update: vi.fn().mockResolvedValue({}),
    },
    orderStatusHistory: {
      create: vi.fn().mockResolvedValue({}),
    },
    outboxEvent: {
      create: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn().mockImplementation(async (fn: any) => fn(mock)),
  } as any;
  return mock;
}

describe('FulfillmentStatusService', () => {
  describe('computeFromStatuses (static)', () => {
    it('NOT_ROUTED when no tickets', () => {
      expect(FulfillmentStatusService.computeFromStatuses([])).toBe(FulfillmentStatus.NOT_ROUTED);
    });

    it('CANCELLED when all tickets cancelled', () => {
      expect(FulfillmentStatusService.computeFromStatuses(['CANCELLED', 'CANCELLED'])).toBe(FulfillmentStatus.CANCELLED);
    });

    it('QUEUED when all tickets are QUEUED', () => {
      expect(FulfillmentStatusService.computeFromStatuses(['QUEUED', 'QUEUED'])).toBe(FulfillmentStatus.QUEUED);
    });

    it('PREPARING when at least one IN_PROGRESS, none READY', () => {
      expect(FulfillmentStatusService.computeFromStatuses(['QUEUED', 'IN_PROGRESS'])).toBe(FulfillmentStatus.PREPARING);
    });

    it('PARTIALLY_READY when at least one READY and others still active', () => {
      expect(FulfillmentStatusService.computeFromStatuses(['READY', 'IN_PROGRESS'])).toBe(FulfillmentStatus.PARTIALLY_READY);
    });

    it('PARTIALLY_READY when READY and QUEUED coexist', () => {
      expect(FulfillmentStatusService.computeFromStatuses(['READY', 'QUEUED'])).toBe(FulfillmentStatus.PARTIALLY_READY);
    });

    it('READY_FOR_SERVICE when all active tickets are READY', () => {
      expect(FulfillmentStatusService.computeFromStatuses(['READY', 'READY'])).toBe(FulfillmentStatus.READY_FOR_SERVICE);
    });

    it('READY_FOR_SERVICE when all active tickets are COMPLETED', () => {
      expect(FulfillmentStatusService.computeFromStatuses(['COMPLETED', 'COMPLETED'])).toBe(FulfillmentStatus.READY_FOR_SERVICE);
    });

    it('READY_FOR_SERVICE when mix of READY and COMPLETED', () => {
      expect(FulfillmentStatusService.computeFromStatuses(['READY', 'COMPLETED'])).toBe(FulfillmentStatus.READY_FOR_SERVICE);
    });

    it('READY_FOR_SERVICE when active tickets are READY with some CANCELLED', () => {
      expect(FulfillmentStatusService.computeFromStatuses(['READY', 'CANCELLED'])).toBe(FulfillmentStatus.READY_FOR_SERVICE);
    });

    it('PREPARING when IN_PROGRESS with CANCELLED', () => {
      expect(FulfillmentStatusService.computeFromStatuses(['IN_PROGRESS', 'CANCELLED'])).toBe(FulfillmentStatus.PREPARING);
    });
  });

  describe('deriveFulfillmentStatus (instance) — PREPARE/ASSEMBLE separation', () => {
    it('returns NOT_ROUTED when no tickets', async () => {
      const prisma = mockPrisma({ tickets: [] });
      const service = new FulfillmentStatusService(prisma);

      const result = await service.deriveFulfillmentStatus({
        tenantId: 't1',
        branchId: 'b1',
        orderId: 'order-1',
      });

      expect(result.fulfillmentStatus).toBe(FulfillmentStatus.NOT_ROUTED);
    });

    it('PARTIALLY_READY when one PREPARATION ticket READY, other PREPARATION still IN_PROGRESS', async () => {
      const prisma = mockPrisma({
        tickets: [
          { id: 't1', status: 'READY', readyAt: new Date(), ticketType: 'PREPARATION' },
          { id: 't2', status: 'IN_PROGRESS', readyAt: null, ticketType: 'PREPARATION' },
        ],
      });
      const service = new FulfillmentStatusService(prisma);

      const result = await service.deriveFulfillmentStatus({
        tenantId: 't1',
        branchId: 'b1',
        orderId: 'order-1',
      });

      expect(result.fulfillmentStatus).toBe(FulfillmentStatus.PARTIALLY_READY);
    });

    it('READY_FOR_EXPO when all PREPARATION tickets READY but EXPO ticket still QUEUED', async () => {
      const prisma = mockPrisma({
        tickets: [
          { id: 't1', status: 'READY', readyAt: new Date(), ticketType: 'PREPARATION' },
          { id: 't2', status: 'QUEUED', readyAt: null, ticketType: 'EXPO' },
        ],
      });
      const service = new FulfillmentStatusService(prisma);

      const result = await service.deriveFulfillmentStatus({
        tenantId: 't1',
        branchId: 'b1',
        orderId: 'order-1',
      });

      expect(result.fulfillmentStatus).toBe(FulfillmentStatus.READY_FOR_EXPO);
      expect(result.readyAt).toBeInstanceOf(Date);
    });

    it('READY_FOR_EXPO when all PREPARATION tickets COMPLETED but EXPO ticket IN_PROGRESS', async () => {
      const prisma = mockPrisma({
        tickets: [
          { id: 't1', status: 'COMPLETED', readyAt: new Date(), ticketType: 'PREPARATION' },
          { id: 't2', status: 'IN_PROGRESS', readyAt: null, ticketType: 'EXPO' },
        ],
      });
      const service = new FulfillmentStatusService(prisma);

      const result = await service.deriveFulfillmentStatus({
        tenantId: 't1',
        branchId: 'b1',
        orderId: 'order-1',
      });

      expect(result.fulfillmentStatus).toBe(FulfillmentStatus.READY_FOR_EXPO);
    });

    it('READY_FOR_SERVICE when all PREPARATION and EXPO tickets READY', async () => {
      const prisma = mockPrisma({
        tickets: [
          { id: 't1', status: 'READY', readyAt: new Date(), ticketType: 'PREPARATION' },
          { id: 't2', status: 'READY', readyAt: new Date(), ticketType: 'EXPO' },
        ],
      });
      const service = new FulfillmentStatusService(prisma);

      const result = await service.deriveFulfillmentStatus({
        tenantId: 't1',
        branchId: 'b1',
        orderId: 'order-1',
      });

      expect(result.fulfillmentStatus).toBe(FulfillmentStatus.READY_FOR_SERVICE);
    });

    it('READY_FOR_SERVICE when PREPARATION READY and no EXPO tickets exist', async () => {
      const prisma = mockPrisma({
        tickets: [
          { id: 't1', status: 'READY', readyAt: new Date(), ticketType: 'PREPARATION' },
        ],
      });
      const service = new FulfillmentStatusService(prisma);

      const result = await service.deriveFulfillmentStatus({
        tenantId: 't1',
        branchId: 'b1',
        orderId: 'order-1',
      });

      expect(result.fulfillmentStatus).toBe(FulfillmentStatus.READY_FOR_SERVICE);
    });

    it('PREPARING when PREPARATION ticket IN_PROGRESS and EXPO ticket QUEUED', async () => {
      const prisma = mockPrisma({
        tickets: [
          { id: 't1', status: 'IN_PROGRESS', readyAt: null, ticketType: 'PREPARATION' },
          { id: 't2', status: 'QUEUED', readyAt: null, ticketType: 'EXPO' },
        ],
      });
      const service = new FulfillmentStatusService(prisma);

      const result = await service.deriveFulfillmentStatus({
        tenantId: 't1',
        branchId: 'b1',
        orderId: 'order-1',
      });

      expect(result.fulfillmentStatus).toBe(FulfillmentStatus.PREPARING);
    });

    it('captures latest readyAt from PREPARATION tickets', async () => {
      const now = new Date();
      const earlier = new Date(now.getTime() - 1000);
      const prisma = mockPrisma({
        tickets: [
          { id: 't1', status: 'READY', readyAt: earlier, ticketType: 'PREPARATION' },
          { id: 't2', status: 'READY', readyAt: now, ticketType: 'PREPARATION' },
          { id: 't3', status: 'QUEUED', readyAt: null, ticketType: 'EXPO' },
        ],
      });
      const service = new FulfillmentStatusService(prisma);

      const result = await service.deriveFulfillmentStatus({
        tenantId: 't1',
        branchId: 'b1',
        orderId: 'order-1',
      });

      expect(result.fulfillmentStatus).toBe(FulfillmentStatus.READY_FOR_EXPO);
      expect(result.readyAt).toEqual(now);
    });

    it('CANCELLED when all tickets cancelled (including expo)', async () => {
      const prisma = mockPrisma({
        tickets: [
          { id: 't1', status: 'CANCELLED', readyAt: null, ticketType: 'PREPARATION' },
          { id: 't2', status: 'CANCELLED', readyAt: null, ticketType: 'EXPO' },
        ],
      });
      const service = new FulfillmentStatusService(prisma);

      const result = await service.deriveFulfillmentStatus({
        tenantId: 't1',
        branchId: 'b1',
        orderId: 'order-1',
      });

      expect(result.fulfillmentStatus).toBe(FulfillmentStatus.CANCELLED);
    });

    it('P0 FIX: cancelled prep tickets do NOT produce READY_FOR_EXPO', async () => {
      const prisma = mockPrisma({
        tickets: [
          { id: 't1', status: 'CANCELLED', readyAt: null, ticketType: 'PREPARATION' },
          { id: 't2', status: 'QUEUED', readyAt: null, ticketType: 'EXPO' },
        ],
      });
      const service = new FulfillmentStatusService(prisma);

      const result = await service.deriveFulfillmentStatus({
        tenantId: 't1',
        branchId: 'b1',
        orderId: 'order-1',
      });

      // Should NOT be READY_FOR_EXPO — all prep tickets are cancelled, not ready
      expect(result.fulfillmentStatus).not.toBe(FulfillmentStatus.READY_FOR_EXPO);
      expect(result.fulfillmentStatus).not.toBe(FulfillmentStatus.READY_FOR_SERVICE);
    });

    it('optional prep tickets do not block readiness', async () => {
      const prisma = mockPrisma({
        tickets: [
          { id: 't1', status: 'READY', readyAt: new Date(), ticketType: 'PREPARATION' },
          { id: 't2', status: 'QUEUED', readyAt: null, ticketType: 'PREPARATION' },
        ],
        ticketLines: [
          { ticketId: 't1', isRequired: true, status: 'READY' },
          { ticketId: 't2', isRequired: false, status: 'QUEUED' },
        ],
      });
      const service = new FulfillmentStatusService(prisma);

      const result = await service.deriveFulfillmentStatus({
        tenantId: 't1',
        branchId: 'b1',
        orderId: 'order-1',
      });

      // Only t1 is required and it's READY → prep is done → READY_FOR_SERVICE (no expo)
      expect(result.fulfillmentStatus).toBe(FulfillmentStatus.READY_FOR_SERVICE);
    });

    it('optional expo ticket does not block readiness', async () => {
      const prisma = mockPrisma({
        tickets: [
          { id: 't1', status: 'READY', readyAt: new Date(), ticketType: 'PREPARATION' },
          { id: 't2', status: 'QUEUED', readyAt: null, ticketType: 'EXPO' },
        ],
        ticketLines: [
          { ticketId: 't1', isRequired: true, status: 'READY' },
          { ticketId: 't2', isRequired: false, status: 'QUEUED' },
        ],
      });
      const service = new FulfillmentStatusService(prisma);

      const result = await service.deriveFulfillmentStatus({
        tenantId: 't1',
        branchId: 'b1',
        orderId: 'order-1',
      });

      // t1 required and READY, t2 optional → expo not blocking → READY_FOR_SERVICE
      expect(result.fulfillmentStatus).toBe(FulfillmentStatus.READY_FOR_SERVICE);
    });
  });

  describe('applyFulfillmentStatus', () => {
    it('applies new status and writes history when changed', async () => {
      const prisma = mockPrisma({
        order: { id: 'order-1', fulfillmentStatus: FulfillmentStatus.QUEUED },
        tickets: [
          { id: 't1', status: 'READY', readyAt: new Date(), ticketType: 'PREPARATION' },
          { id: 't2', status: 'READY', readyAt: new Date(), ticketType: 'EXPO' },
        ],
      });
      const service = new FulfillmentStatusService(prisma);

      const result = await service.applyFulfillmentStatus({
        tenantId: 't1',
        branchId: 'b1',
        orderId: 'order-1',
      });

      expect(result.updated).toBe(true);
      expect(result.status).toBe(FulfillmentStatus.READY_FOR_SERVICE);
    });

    it('returns updated=false when status unchanged', async () => {
      const prisma = mockPrisma({
        order: { id: 'order-1', fulfillmentStatus: FulfillmentStatus.READY_FOR_SERVICE },
        tickets: [
          { id: 't1', status: 'READY', readyAt: new Date(), ticketType: 'PREPARATION' },
          { id: 't2', status: 'READY', readyAt: new Date(), ticketType: 'EXPO' },
        ],
      });
      const service = new FulfillmentStatusService(prisma);

      const result = await service.applyFulfillmentStatus({
        tenantId: 't1',
        branchId: 'b1',
        orderId: 'order-1',
      });

      expect(result.updated).toBe(false);
      expect(result.status).toBe(FulfillmentStatus.READY_FOR_SERVICE);
    });
  });
});
