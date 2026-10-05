import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExpoService } from './expo.service';
import { KITCHEN_FULFILLMENT_ERRORS } from '@rms/contracts';

function createMockPrisma() {
  return {
    order: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    kitchenTicket: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    kitchenTicketLine: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    orderLine: {
      findMany: vi.fn(),
    },
    orderStatusHistory: {
      create: vi.fn(),
    },
    serviceNotification: {
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
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

describe('ExpoService', () => {
  let service: ExpoService;
  let prisma: ReturnType<typeof createMockPrisma>;

  const mockFeatureResolver = {
    assertEffective: vi.fn().mockResolvedValue(undefined),
    resolve: vi.fn().mockResolvedValue({ effective: true }),
  };

  const mockNotificationService = {
    createNotification: vi.fn().mockResolvedValue({ id: 'n1' }),
    resolveNotification: vi.fn().mockResolvedValue({}),
    cancelNotificationsForOrder: vi.fn().mockResolvedValue({}),
    cancelNotificationsForTicket: vi.fn().mockResolvedValue({}),
  };

  const mockKdsGateway = {
    broadcastToExpo: vi.fn(),
    broadcastToServiceBoard: vi.fn(),
    broadcastFulfillmentChanged: vi.fn(),
    broadcastTicketCreated: vi.fn(),
    broadcastTicketUpdated: vi.fn(),
    broadcastOrderConfirmed: vi.fn(),
    broadcastServiceNotification: vi.fn(),
  };

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new ExpoService(
      prisma as any,
      mockFeatureResolver as any,
      mockNotificationService as any,
      mockKdsGateway as any,
    );
  });

  describe('releaseOrder', () => {
    it('should release an order from expo', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'o1',
        tenantId: 't1',
        branchId: 'b1',
        fulfillmentStatus: 'READY_FOR_EXPO',
        expoReleasedAt: null,
        version: 3,
        assignedWaiterUserId: 'w1',
      });
      prisma.kitchenTicket.findMany.mockResolvedValue([
        { id: 't1', lines: [{ isRequired: true, status: 'READY' }], status: 'READY' },
      ]);

      const tx = createMockPrisma();
      tx.order.updateMany.mockResolvedValue({ count: 1 });
      tx.order.findUnique.mockResolvedValue({
        id: 'o1', fulfillmentStatus: 'READY_FOR_SERVICE', version: 4, expoReleasedAt: new Date(),
      });
      prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));

      const result = await service.releaseOrder({
        tenantId: 't1',
        branchId: 'b1',
        orderId: 'o1',
        actorUserId: 'u1',
        expectedVersion: 3,
      });

      expect(result.fulfillmentStatus).toBe('READY_FOR_SERVICE');
      expect(result.version).toBe(4);
      expect(mockNotificationService.createNotification).toHaveBeenCalled();
    });

    it('should reject if already released', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'o1',
        fulfillmentStatus: 'READY_FOR_SERVICE',
        expoReleasedAt: new Date(),
        version: 4,
      });

      await expect(
        service.releaseOrder({
          tenantId: 't1',
          branchId: 'b1',
          orderId: 'o1',
          actorUserId: 'u1',
          expectedVersion: 4,
        }),
      ).rejects.toThrow(expect.objectContaining({
        response: expect.objectContaining({
          code: KITCHEN_FULFILLMENT_ERRORS.EXPO_ALREADY_RELEASED,
        }),
      }));
    });

    it('should reject if version conflicts', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'o1',
        fulfillmentStatus: 'READY_FOR_EXPO',
        expoReleasedAt: null,
        version: 5,
      });

      await expect(
        service.releaseOrder({
          tenantId: 't1',
          branchId: 'b1',
          orderId: 'o1',
          actorUserId: 'u1',
          expectedVersion: 3,
        }),
      ).rejects.toThrow(expect.objectContaining({
        response: expect.objectContaining({
          code: KITCHEN_FULFILLMENT_ERRORS.ORDER_VERSION_CONFLICT,
        }),
      }));
    });

    it('should reject if not in correct fulfillment status', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'o1',
        fulfillmentStatus: 'PREPARING',
        expoReleasedAt: null,
        version: 2,
      });

      await expect(
        service.releaseOrder({
          tenantId: 't1',
          branchId: 'b1',
          orderId: 'o1',
          actorUserId: 'u1',
          expectedVersion: 2,
        }),
      ).rejects.toThrow(expect.objectContaining({
        response: expect.objectContaining({
          code: KITCHEN_FULFILLMENT_ERRORS.EXPO_RELEASE_BLOCKED,
        }),
      }));
    });
  });

  describe('recallOrder', () => {
    it('should recall a released order', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'o1',
        fulfillmentStatus: 'READY_FOR_SERVICE',
        expoReleasedAt: new Date(),
        servedAt: null,
        version: 4,
      });

      const tx = createMockPrisma();
      tx.kitchenTicket.findMany
        .mockResolvedValueOnce([
          { id: 't1', status: 'READY', readyAt: new Date(), ticketType: 'PREPARATION' },
        ])
        .mockResolvedValueOnce([]);
      tx.kitchenTicketLine.findMany.mockResolvedValue([
        { ticketId: 't1', isRequired: true, status: 'READY' },
      ]);
      tx.order.updateMany.mockResolvedValue({ count: 1 });
      tx.order.findUnique.mockResolvedValue({
        id: 'o1', fulfillmentStatus: 'READY_FOR_EXPO', version: 5, expoReleasedAt: null,
      });
      prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));

      const result = await service.recallOrder({
        tenantId: 't1',
        branchId: 'b1',
        orderId: 'o1',
        actorUserId: 'u1',
        reason: 'wrong items',
        expectedVersion: 4,
      });

      expect(result.fulfillmentStatus).toBe('READY_FOR_EXPO');
      expect(result.expoReleasedAt).toBeNull();
    });

    it('should reject recall if order is served', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'o1',
        fulfillmentStatus: 'SERVED',
        expoReleasedAt: new Date(),
        servedAt: new Date(),
        version: 6,
      });

      await expect(
        service.recallOrder({
          tenantId: 't1',
          branchId: 'b1',
          orderId: 'o1',
          actorUserId: 'u1',
          reason: 'oops',
          expectedVersion: 6,
        }),
      ).rejects.toThrow(expect.objectContaining({
        response: expect.objectContaining({
          code: KITCHEN_FULFILLMENT_ERRORS.ORDER_ALREADY_SERVED,
        }),
      }));
    });

    it('should reject recall if not yet released', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'o1',
        fulfillmentStatus: 'READY_FOR_EXPO',
        expoReleasedAt: null,
        servedAt: null,
        version: 3,
      });

      await expect(
        service.recallOrder({
          tenantId: 't1',
          branchId: 'b1',
          orderId: 'o1',
          actorUserId: 'u1',
          reason: 'oops',
          expectedVersion: 3,
        }),
      ).rejects.toThrow(expect.objectContaining({
        response: expect.objectContaining({
          code: KITCHEN_FULFILLMENT_ERRORS.EXPO_RECALL_BLOCKED,
        }),
      }));
    });
  });

  describe('listExpoOrders', () => {
    it('should list orders visible on expo screen', async () => {
      prisma.order.findMany.mockResolvedValue([
        {
          id: 'o1',
          orderNumber: 101n,
          tableId: 'T5',
          orderType: 'DINE_IN',
          fulfillmentStatus: 'READY_FOR_EXPO',
          tickets: [],
        },
      ]);

      const result = await service.listExpoOrders({
        tenantId: 't1',
        branchId: 'b1',
      });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('o1');
    });
  });

  describe('collectOrder', () => {
    it('collects exact ready quantities with scoped transactional version guards', async () => {
      prisma.order.findFirst.mockResolvedValue({ id: 'o1', fulfillmentStatus: 'READY_FOR_SERVICE', version: 4 });
      const tx = createMockPrisma();
      tx.order.updateMany.mockResolvedValue({ count: 1 });
      tx.order.findFirst.mockResolvedValue({ id: 'o1', fulfillmentStatus: 'READY_FOR_SERVICE', version: 5 });
      tx.kitchenTicket.findMany.mockResolvedValue([
        { id: 'ticket-1', status: 'READY', version: 3, lines: [{ id: 'line-1', quantityReady: 2, version: 2 }] },
        { id: 'ticket-2', status: 'COMPLETED', version: 4, lines: [{ id: 'line-2', quantityReady: 5, version: 3 }] },
      ]);
      tx.kitchenTicket.updateMany.mockResolvedValue({ count: 1 });
      tx.kitchenTicketLine.updateMany.mockResolvedValue({ count: 1 });
      prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));
      const result = await service.collectOrder({ tenantId: 'tenant-1', branchId: 'branch-1', orderId: 'o1', actorUserId: 'staff-1', expectedVersion: 4 });
      expect(result.version).toBe(5);
      expect(tx.order.updateMany).toHaveBeenCalledWith({
        where: { id: 'o1', tenantId: 'tenant-1', branchId: 'branch-1', version: 4 },
        data: { version: { increment: 1 } },
      });
      expect(tx.kitchenTicketLine.updateMany).toHaveBeenNthCalledWith(1, {
        where: { id: 'line-1', tenantId: 'tenant-1', branchId: 'branch-1', ticketId: 'ticket-1', version: 2, status: 'READY' },
        data: { quantityCollected: 2, collectedAt: expect.any(Date), version: { increment: 1 } },
      });
      expect(tx.kitchenTicketLine.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
        data: { quantityCollected: 5, collectedAt: expect.any(Date), version: { increment: 1 } },
      }));
      expect(tx.outboxEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ eventType: 'order.collected' }) }));
    });

    it('rejects a concurrent collector before ticket or line mutations', async () => {
      prisma.order.findFirst.mockResolvedValue({ id: 'o1', fulfillmentStatus: 'READY_FOR_SERVICE', version: 4 });
      const tx = createMockPrisma();
      tx.order.updateMany.mockResolvedValue({ count: 0 });
      prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));
      await expect(service.collectOrder({ tenantId: 'tenant-1', branchId: 'branch-1', orderId: 'o1', actorUserId: 'staff-1', expectedVersion: 4 })).rejects.toThrow();
      expect(tx.kitchenTicket.findMany).not.toHaveBeenCalled();
      expect(tx.kitchenTicketLine.updateMany).not.toHaveBeenCalled();
    });
  });
});
