import { describe, it, expect, vi } from 'vitest';
import { FulfillmentStatusService } from './fulfillment-status.service';
import { FulfillmentStatus } from '@rms/contracts';

function mockPrisma(overrides: Record<string, any> = {}) {
  const mock = {
    kitchenTicket: {
      findMany: vi.fn().mockResolvedValue(overrides.tickets ?? []),
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
          { status: 'READY', readyAt: new Date(), ticketType: 'PREPARATION' },
          { status: 'IN_PROGRESS', readyAt: null, ticketType: 'PREPARATION' },
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
          { status: 'READY', readyAt: new Date(), ticketType: 'PREPARATION' },
          { status: 'QUEUED', readyAt: null, ticketType: 'EXPO' },
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
          { status: 'COMPLETED', readyAt: new Date(), ticketType: 'PREPARATION' },
          { status: 'IN_PROGRESS', readyAt: null, ticketType: 'EXPO' },
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
          { status: 'READY', readyAt: new Date(), ticketType: 'PREPARATION' },
          { status: 'READY', readyAt: new Date(), ticketType: 'EXPO' },
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
          { status: 'READY', readyAt: new Date(), ticketType: 'PREPARATION' },
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
          { status: 'IN_PROGRESS', readyAt: null, ticketType: 'PREPARATION' },
          { status: 'QUEUED', readyAt: null, ticketType: 'EXPO' },
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
          { status: 'READY', readyAt: earlier, ticketType: 'PREPARATION' },
          { status: 'READY', readyAt: now, ticketType: 'PREPARATION' },
          { status: 'QUEUED', readyAt: null, ticketType: 'EXPO' },
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
  });

  describe('applyFulfillmentStatus', () => {
    it('applies new status and writes history when changed', async () => {
      const prisma = mockPrisma({
        order: { id: 'order-1', fulfillmentStatus: FulfillmentStatus.QUEUED },
        tickets: [
          { status: 'READY', readyAt: new Date(), ticketType: 'PREPARATION' },
          { status: 'READY', readyAt: new Date(), ticketType: 'EXPO' },
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
          { status: 'READY', readyAt: new Date(), ticketType: 'PREPARATION' },
          { status: 'READY', readyAt: new Date(), ticketType: 'EXPO' },
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
