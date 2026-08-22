import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KitchenTicketsService } from './kitchen-tickets.service';

function createMockPrisma() {
  return {
    kitchenTicket: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    kitchenTicketLine: {
      create: vi.fn(),
    },
    kitchenTicketHistory: {
      create: vi.fn(),
    },
    stationTicketCounter: {
      upsert: vi.fn(),
    },
    orderLine: {
      findMany: vi.fn(),
    },
    menuItemStation: {
      findMany: vi.fn(),
    },
    order: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    orderStatusHistory: {
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    outboxEvent: {
      create: vi.fn(),
    },
    $transaction: vi.fn(async (fn: any) => fn(createMockPrisma())),
  };
}

describe('KitchenTicketsService', () => {
  let service: KitchenTicketsService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new KitchenTicketsService(prisma as any);
  });

  describe('createTicketsForOrder', () => {
    it('should return existing tickets if already created (idempotent)', async () => {
      const existing = [{ id: 't1', ticketNumber: 1n, status: 'QUEUED' }];
      prisma.kitchenTicket.findMany.mockResolvedValue(existing);

      const result = await service.createTicketsForOrder({
        tenantId: 't1', branchId: 'b1', orderId: 'o1',
      });

      expect(result.idempotent).toBe(true);
      expect(result.tickets).toHaveLength(1);
    });

    it('should return empty if no stations assigned', async () => {
      prisma.kitchenTicket.findMany.mockResolvedValue([]);
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', branchId: 'b1', lines: [{ id: 'l1', menuItemId: 'mi1', quantity: 2 }],
      });
      prisma.menuItemStation.findMany.mockResolvedValue([]);

      const result = await service.createTicketsForOrder({
        tenantId: 't1', branchId: 'b1', orderId: 'o1',
      });

      expect(result.tickets).toHaveLength(0);
      expect(result.reason).toBe('NO_STATIONS_ASSIGNED');
    });

    it('should create tickets grouped by station', async () => {
      prisma.kitchenTicket.findMany.mockResolvedValue([]);
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', branchId: 'b1',
        lines: [
          { id: 'l1', menuItemId: 'mi1', quantity: 2 },
          { id: 'l2', menuItemId: 'mi2', quantity: 1 },
        ],
      });
      // mi1 → station s1, mi2 → station s1 (same station)
      prisma.menuItemStation.findMany
        .mockResolvedValueOnce([{ stationId: 's1' }])
        .mockResolvedValueOnce([{ stationId: 's1' }]);

      const tx = createMockPrisma();
      tx.stationTicketCounter.upsert.mockResolvedValue({ lastNumber: 1n });
      tx.kitchenTicket.create.mockResolvedValue({ id: 'kt1', ticketNumber: 1n });
      prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));

      const result = await service.createTicketsForOrder({
        tenantId: 't1', branchId: 'b1', orderId: 'o1', actorUserId: 'u1',
      });

      expect(result.idempotent).toBe(false);
      expect(result.tickets).toHaveLength(1);
      expect(tx.kitchenTicketLine.create).toHaveBeenCalledTimes(2);
      expect(tx.auditLog.create).toHaveBeenCalled();
    });
  });

  describe('bumpTicket', () => {
    it('should bump QUEUED → IN_PROGRESS', async () => {
      prisma.kitchenTicket.findFirst.mockResolvedValue({
        id: 't1', status: 'QUEUED', version: 1, orderId: 'o1', stationId: 's1',
      });
      const tx = createMockPrisma();
      tx.kitchenTicket.updateMany.mockResolvedValue({ count: 1 });
      tx.kitchenTicket.findUnique.mockResolvedValue({
        id: 't1', status: 'IN_PROGRESS', version: 2,
      });
      prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));

      const result = await service.bumpTicket({
        tenantId: 't1', branchId: 'b1', ticketId: 't1', actorUserId: 'u1', expectedVersion: 1,
      });

      expect(result.status).toBe('IN_PROGRESS');
    });

    it('should throw on version conflict', async () => {
      prisma.kitchenTicket.findFirst.mockResolvedValue({
        id: 't1', status: 'QUEUED', version: 2,
      });

      await expect(
        service.bumpTicket({
          tenantId: 't1', branchId: 'b1', ticketId: 't1', actorUserId: 'u1', expectedVersion: 1,
        }),
      ).rejects.toThrow();
    });

    it('should throw on invalid transition', async () => {
      prisma.kitchenTicket.findFirst.mockResolvedValue({
        id: 't1', status: 'COMPLETED', version: 1,
      });

      await expect(
        service.bumpTicket({
          tenantId: 't1', branchId: 'b1', ticketId: 't1', actorUserId: 'u1', expectedVersion: 1,
        }),
      ).rejects.toThrow('Cannot bump');
    });
  });

  describe('recallTicket', () => {
    it('should recall READY → IN_PROGRESS', async () => {
      prisma.kitchenTicket.findFirst.mockResolvedValue({
        id: 't1', status: 'READY', version: 3, orderId: 'o1', stationId: 's1',
      });
      const tx = createMockPrisma();
      tx.kitchenTicket.updateMany.mockResolvedValue({ count: 1 });
      tx.kitchenTicket.findUnique.mockResolvedValue({
        id: 't1', status: 'IN_PROGRESS', version: 4,
      });
      prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));

      const result = await service.recallTicket({
        tenantId: 't1', branchId: 'b1', ticketId: 't1', actorUserId: 'u1',
        reason: 'wrong order', expectedVersion: 3,
      });

      expect(result.status).toBe('IN_PROGRESS');
    });

    it('should throw if not READY', async () => {
      prisma.kitchenTicket.findFirst.mockResolvedValue({
        id: 't1', status: 'QUEUED', version: 1,
      });

      await expect(
        service.recallTicket({
          tenantId: 't1', branchId: 'b1', ticketId: 't1', actorUserId: 'u1',
          reason: 'oops', expectedVersion: 1,
        }),
      ).rejects.toThrow('Can only recall READY tickets');
    });
  });

  describe('completeTicket', () => {
    it('should complete READY → COMPLETED', async () => {
      prisma.kitchenTicket.findFirst.mockResolvedValue({
        id: 't1', status: 'READY', version: 2, orderId: 'o1', stationId: 's1',
      });
      const tx = createMockPrisma();
      tx.kitchenTicket.updateMany.mockResolvedValue({ count: 1 });
      tx.kitchenTicket.findUnique.mockResolvedValue({
        id: 't1', status: 'COMPLETED', version: 3,
      });
      tx.kitchenTicket.count.mockResolvedValue(0); // All tickets done
      prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));

      const result = await service.completeTicket({
        tenantId: 't1', branchId: 'b1', ticketId: 't1', actorUserId: 'u1', expectedVersion: 2,
      });

      expect(result.status).toBe('COMPLETED');
      // Should also mark order as READY
      expect(tx.order.updateMany).toHaveBeenCalled();
    });

    it('should not mark order READY if other tickets pending', async () => {
      prisma.kitchenTicket.findFirst.mockResolvedValue({
        id: 't1', status: 'READY', version: 2, orderId: 'o1', stationId: 's1',
      });
      const tx = createMockPrisma();
      tx.kitchenTicket.updateMany.mockResolvedValue({ count: 1 });
      tx.kitchenTicket.findUnique.mockResolvedValue({
        id: 't1', status: 'COMPLETED', version: 3,
      });
      tx.kitchenTicket.count.mockResolvedValue(1); // Another ticket still pending
      prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));

      await service.completeTicket({
        tenantId: 't1', branchId: 'b1', ticketId: 't1', actorUserId: 'u1', expectedVersion: 2,
      });

      expect(tx.order.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('cancelTicket', () => {
    it('should cancel a QUEUED ticket', async () => {
      prisma.kitchenTicket.findFirst.mockResolvedValue({
        id: 't1', status: 'QUEUED', version: 1, orderId: 'o1', stationId: 's1',
      });
      const tx = createMockPrisma();
      tx.kitchenTicket.updateMany.mockResolvedValue({ count: 1 });
      tx.kitchenTicket.findUnique.mockResolvedValue({
        id: 't1', status: 'CANCELLED', version: 2,
      });
      prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));

      const result = await service.cancelTicket({
        tenantId: 't1', branchId: 'b1', ticketId: 't1', actorUserId: 'u1',
        reason: 'customer left', expectedVersion: 1,
      });

      expect(result.status).toBe('CANCELLED');
    });

    it('should throw on invalid cancel transition', async () => {
      prisma.kitchenTicket.findFirst.mockResolvedValue({
        id: 't1', status: 'COMPLETED', version: 1,
      });

      await expect(
        service.cancelTicket({
          tenantId: 't1', branchId: 'b1', ticketId: 't1', actorUserId: 'u1', expectedVersion: 1,
        }),
      ).rejects.toThrow('Cannot cancel');
    });
  });
});
