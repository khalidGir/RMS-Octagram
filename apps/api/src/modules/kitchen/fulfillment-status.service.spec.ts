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

  describe('deriveFulfillmentStatus (instance)', () => {
    it('delegates to static computation', async () => {
      const prisma = mockPrisma({
        tickets: [{ status: 'READY' }, { status: 'IN_PROGRESS' }],
      });
      const service = new FulfillmentStatusService(prisma);

      const result = await service.deriveFulfillmentStatus({
        tenantId: 't1',
        branchId: 'b1',
        orderId: 'order-1',
      });

      expect(result.fulfillmentStatus).toBe(FulfillmentStatus.PARTIALLY_READY);
      expect(result.readyAt).toBeNull();
    });

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

    it('captures latest readyAt from tickets', async () => {
      const now = new Date();
      const earlier = new Date(now.getTime() - 1000);
      const prisma = mockPrisma({
        tickets: [
          { status: 'READY', readyAt: earlier },
          { status: 'READY', readyAt: now },
        ],
      });
      const service = new FulfillmentStatusService(prisma);

      const result = await service.deriveFulfillmentStatus({
        tenantId: 't1',
        branchId: 'b1',
        orderId: 'order-1',
      });

      expect(result.fulfillmentStatus).toBe(FulfillmentStatus.READY_FOR_SERVICE);
      expect(result.readyAt).toEqual(now);
    });
  });

  describe('applyFulfillmentStatus', () => {
    it('applies new status and writes history when changed', async () => {
      const prisma = mockPrisma({
        order: { id: 'order-1', fulfillmentStatus: FulfillmentStatus.QUEUED },
        tickets: [{ status: 'READY' }, { status: 'READY' }],
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
        tickets: [{ status: 'READY' }, { status: 'READY' }],
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
