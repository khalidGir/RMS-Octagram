import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WaiterService } from './waiter.service';
import { FulfillmentStatus, KITCHEN_FULFILLMENT_ERRORS } from '@rms/contracts';

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
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    kitchenTicketLine: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    tenantMembership: {
      findFirst: vi.fn(),
    },
    branchAssignment: {
      findUnique: vi.fn(),
    },
    orderStatusHistory: {
      create: vi.fn(),
    },
    serviceNotification: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
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

describe('WaiterService', () => {
  let service: WaiterService;
  let prisma: ReturnType<typeof createMockPrisma>;

  const mockFeatureResolver = {
    assertEffective: vi.fn().mockResolvedValue(undefined),
    resolve: vi.fn().mockResolvedValue({ effective: true }),
  };

  const mockFulfillmentStatusService = {
    deriveFulfillmentStatus: vi.fn().mockResolvedValue({
      fulfillmentStatus: FulfillmentStatus.READY_FOR_SERVICE,
      readyAt: new Date(),
      servedAt: null,
    }),
    applyFulfillmentStatus: vi.fn(),
  };

  const mockNotificationService = {
    createNotification: vi.fn().mockResolvedValue({ id: 'n1' }),
    resolveNotification: vi.fn().mockResolvedValue({}),
    cancelNotificationsForOrder: vi.fn().mockResolvedValue({}),
  };

  const mockPolicyService = {
    getPolicy: vi.fn().mockResolvedValue({
      serviceMode: 'ALL_AT_ONCE',
      expoMode: 'REQUIRED',
      allowWaiterSelfClaim: true,
      showUnassignedReadyOrdersToWaiters: true,
      autoCompleteKitchenTicketOnCollected: false,
    }),
  };

  const mockKdsGateway = {
    broadcastToExpo: vi.fn(),
    broadcastToServiceBoard: vi.fn(),
    broadcastFulfillmentChanged: vi.fn(),
    broadcastServiceNotification: vi.fn(),
  };

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new WaiterService(
      prisma as any,
      mockFeatureResolver as any,
      mockFulfillmentStatusService as any,
      mockNotificationService as any,
      mockPolicyService as any,
      mockKdsGateway as any,
    );
  });

  describe('assignWaiter', () => {
    it('should assign a waiter to an order', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'o1',
        tenantId: 't1',
        branchId: 'b1',
        assignedWaiterUserId: null,
        fulfillmentStatus: 'READY_FOR_SERVICE',
        version: 3,
      });
      prisma.tenantMembership.findFirst.mockResolvedValue({
        id: 'm1',
        userId: 'w1',
        status: 'ACTIVE',
        branchIds: ['b1'],
      });
      prisma.branchAssignment.findUnique.mockResolvedValue({
        id: 'ba1',
        branchId: 'b1',
        membershipId: 'm1',
      });

      const tx = createMockPrisma();
      tx.order.update.mockResolvedValue({
        id: 'o1', assignedWaiterUserId: 'w1', version: 4,
      });
      prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));

      const result = await service.assignWaiter({
        tenantId: 't1',
        branchId: 'b1',
        orderId: 'o1',
        waiterUserId: 'w1',
        actorUserId: 'mgr1',
        tenantRole: 'MANAGER',
      });

      expect(result.assignedWaiterUserId).toBe('w1');
      expect(result.version).toBe(4);
      expect(mockNotificationService.createNotification).toHaveBeenCalled();
    });

    it('should reject self-claim if policy disallows', async () => {
      mockPolicyService.getPolicy.mockResolvedValue({
        allowWaiterSelfClaim: false,
      });

      prisma.order.findFirst.mockResolvedValue({
        id: 'o1',
        assignedWaiterUserId: null,
        fulfillmentStatus: 'READY_FOR_SERVICE',
        version: 3,
      });

      await expect(
        service.assignWaiter({
          tenantId: 't1',
          branchId: 'b1',
          orderId: 'o1',
          waiterUserId: 'w1',
          actorUserId: 'w1',
          tenantRole: 'WAITER',
        }),
      ).rejects.toThrow(expect.objectContaining({
        response: expect.objectContaining({
          code: KITCHEN_FULFILLMENT_ERRORS.WAITER_SELF_CLAIM_DISABLED,
        }),
      }));
    });

    it('should allow manager to assign even when self-claim disabled', async () => {
      mockPolicyService.getPolicy.mockResolvedValue({
        allowWaiterSelfClaim: false,
      });

      prisma.order.findFirst.mockResolvedValue({
        id: 'o1',
        assignedWaiterUserId: null,
        fulfillmentStatus: 'READY_FOR_SERVICE',
        version: 3,
      });
      prisma.tenantMembership.findFirst.mockResolvedValue({
        id: 'm1',
        userId: 'w1',
        status: 'ACTIVE',
        branchIds: ['b1'],
      });
      prisma.branchAssignment.findUnique.mockResolvedValue({
        id: 'ba1',
        branchId: 'b1',
        membershipId: 'm1',
      });

      const tx = createMockPrisma();
      tx.order.update.mockResolvedValue({
        id: 'o1', assignedWaiterUserId: 'w1', version: 4,
      });
      prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));

      const result = await service.assignWaiter({
        tenantId: 't1',
        branchId: 'b1',
        orderId: 'o1',
        waiterUserId: 'w1',
        actorUserId: 'mgr1',
        tenantRole: 'MANAGER',
      });

      expect(result.assignedWaiterUserId).toBe('w1');
    });

    it('should throw if waiter not found in tenant', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'o1',
        assignedWaiterUserId: null,
        fulfillmentStatus: 'READY_FOR_SERVICE',
        version: 3,
      });
      prisma.tenantMembership.findFirst.mockResolvedValue(null);

      await expect(
        service.assignWaiter({
          tenantId: 't1',
          branchId: 'b1',
          orderId: 'o1',
          waiterUserId: 'unknown',
          actorUserId: 'mgr1',
          tenantRole: 'MANAGER',
        }),
      ).rejects.toThrow('Waiter user not found');
    });
  });

  describe('claimOrder', () => {
    it('should allow waiter to self-claim an unassigned order', async () => {
      mockPolicyService.getPolicy.mockResolvedValue({
        allowWaiterSelfClaim: true,
      });
      prisma.order.findFirst.mockResolvedValue({
        id: 'o1',
        assignedWaiterUserId: null,
        fulfillmentStatus: 'READY_FOR_SERVICE',
        version: 3,
      });
      prisma.tenantMembership.findFirst.mockResolvedValue({
        id: 'm1',
        userId: 'w1',
        status: 'ACTIVE',
        branchIds: ['b1'],
      });
      prisma.branchAssignment.findUnique.mockResolvedValue({
        id: 'ba1',
        branchId: 'b1',
        membershipId: 'm1',
      });

      const tx = createMockPrisma();
      tx.order.update.mockResolvedValue({
        id: 'o1', assignedWaiterUserId: 'w1', version: 4,
      });
      prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));

      const result = await service.claimOrder({
        tenantId: 't1',
        branchId: 'b1',
        orderId: 'o1',
        actorUserId: 'w1',
        tenantRole: 'WAITER',
      });

      expect(result.assignedWaiterUserId).toBe('w1');
    });

    it('should reject if order is already assigned to another waiter', async () => {
      mockPolicyService.getPolicy.mockResolvedValue({
        allowWaiterSelfClaim: true,
      });
      prisma.order.findFirst.mockResolvedValue({
        id: 'o1',
        assignedWaiterUserId: 'w2',
        fulfillmentStatus: 'READY_FOR_SERVICE',
        version: 3,
      });

      await expect(
        service.claimOrder({
          tenantId: 't1',
          branchId: 'b1',
          orderId: 'o1',
          actorUserId: 'w1',
          tenantRole: 'WAITER',
        }),
      ).rejects.toThrow(expect.objectContaining({
        response: expect.objectContaining({
          code: KITCHEN_FULFILLMENT_ERRORS.ORDER_ALREADY_ASSIGNED,
        }),
      }));
    });
  });

  describe('serveOrder', () => {
    it('should mark an order as served', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'o1',
        fulfillmentStatus: 'READY_FOR_SERVICE',
        version: 4,
        servedAt: null,
      });

      const tx = createMockPrisma();
      tx.kitchenTicket.findMany.mockResolvedValue([
        { id: 't1', status: 'READY', lines: [{ id: 'l1', quantityCollected: 2 }] },
      ]);
      tx.order.updateMany.mockResolvedValue({ count: 1 });
      tx.order.findUnique.mockResolvedValue({
        id: 'o1',
        fulfillmentStatus: 'SERVED',
        servedAt: new Date(),
        version: 5,
      });
      prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));

      const result = await service.serveOrder({
        tenantId: 't1',
        branchId: 'b1',
        orderId: 'o1',
        actorUserId: 'w1',
        expectedVersion: 4,
      });

      expect(result.fulfillmentStatus).toBe('SERVED');
      expect(result.servedAt).toBeInstanceOf(Date);
    });

    it('should reject if already served', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'o1',
        fulfillmentStatus: 'SERVED',
        servedAt: new Date(),
        version: 6,
      });

      await expect(
        service.serveOrder({
          tenantId: 't1',
          branchId: 'b1',
          orderId: 'o1',
          actorUserId: 'w1',
          expectedVersion: 6,
        }),
      ).rejects.toThrow(expect.objectContaining({
        response: expect.objectContaining({
          code: KITCHEN_FULFILLMENT_ERRORS.ORDER_ALREADY_SERVED,
        }),
      }));
    });

    it('should reject if order is cancelled or not routed', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'o1',
        fulfillmentStatus: 'CANCELLED',
        servedAt: null,
        version: 3,
      });

      await expect(
        service.serveOrder({
          tenantId: 't1',
          branchId: 'b1',
          orderId: 'o1',
          actorUserId: 'w1',
          expectedVersion: 3,
        }),
      ).rejects.toThrow(expect.objectContaining({
        response: expect.objectContaining({
          code: KITCHEN_FULFILLMENT_ERRORS.ORDER_NOT_SERVED,
        }),
      }));
    });
  });

  describe('collectOrder', () => {
    it('should collect ready work for an order', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'o1',
        fulfillmentStatus: 'READY_FOR_SERVICE',
        version: 4,
      });

      const tx = createMockPrisma();
      tx.kitchenTicket.findMany.mockResolvedValue([
        { id: 't1', status: 'READY', lines: [{ id: 'l1', quantityReady: 2 }] },
      ]);
      tx.order.findUnique.mockResolvedValue({
        id: 'o1',
        fulfillmentStatus: 'READY_FOR_SERVICE',
        version: 4,
      });
      prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));

      const result = await service.collectOrder({
        tenantId: 't1',
        branchId: 'b1',
        orderId: 'o1',
        actorUserId: 'w1',
        expectedVersion: 4,
      });

      expect(result.id).toBe('o1');
      expect(tx.kitchenTicket.updateMany).toHaveBeenCalled();
    });

    it('should reject if order is not ready', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'o1',
        fulfillmentStatus: 'PREPARING',
        version: 2,
      });

      await expect(
        service.collectOrder({
          tenantId: 't1',
          branchId: 'b1',
          orderId: 'o1',
          actorUserId: 'w1',
          expectedVersion: 2,
        }),
      ).rejects.toThrow(expect.objectContaining({
        response: expect.objectContaining({
          code: KITCHEN_FULFILLMENT_ERRORS.ORDER_NOT_READY_FOR_COLLECTION,
        }),
      }));
    });
  });

  describe('getServiceBoard', () => {
    it('should return orders for the service board', async () => {
      prisma.order.findMany.mockResolvedValue([
        {
          id: 'o1',
          orderNumber: 101n,
          orderType: 'DINE_IN',
          tableId: 'T5',
          fulfillmentStatus: 'READY_FOR_SERVICE',
          version: 4,
          assignedWaiterUserId: 'w1',
          waiter: { id: 'w1', phoneE164: '+251911111111' },
          readyForServiceAt: new Date(),
          servedAt: null,
          createdAt: new Date(),
          kitchenTickets: [
            {
              id: 't1',
              stationId: 's1',
              status: 'READY',
              ticketType: 'PREPARATION',
              collectionLabelSnapshot: 'Main pass',
              station: { name: 'Grill' },
              kitchen: { name: 'Main Kitchen' },
              lines: [
                { status: 'READY', isRequired: true, routeType: 'PREPARE', quantity: 2, quantityReady: 2, quantityCollected: 0, quantityServed: 0 },
              ],
            },
          ],
        },
      ]);

      const result = await service.getServiceBoard({
        tenantId: 't1',
        branchId: 'b1',
        waiterUserId: 'w1',
        scope: 'mine',
      });

      expect(result).toHaveLength(1);
      expect(result[0].canCollect).toBe(true);
    });

    it('serializes outstanding stations as unique station-name strings', async () => {
      prisma.order.findMany.mockResolvedValue([
        {
          id: 'o2',
          orderNumber: 102n,
          orderType: 'DINE_IN',
          tableId: 'T7',
          fulfillmentStatus: 'PARTIALLY_READY',
          version: 2,
          assignedWaiterUserId: null,
          waiter: null,
          readyForServiceAt: null,
          servedAt: null,
          createdAt: new Date(),
          kitchenTickets: [
            {
              id: 't1',
              stationId: 's1',
              status: 'READY',
              ticketType: 'PREPARATION',
              collectionLabelSnapshot: 'Main pass',
              station: { name: 'Grill' },
              kitchen: { name: 'Main Kitchen' },
              lines: [
                { status: 'READY', isRequired: true, routeType: 'PREPARE', quantity: 1, quantityReady: 1, quantityCollected: 0, quantityServed: 0 },
              ],
            },
            {
              id: 't2',
              stationId: 's2',
              status: 'IN_PROGRESS',
              ticketType: 'PREPARATION',
              collectionLabelSnapshot: null,
              station: { name: 'Hot Line' },
              kitchen: { name: 'Main Kitchen' },
              lines: [
                { status: 'IN_PROGRESS', isRequired: true, routeType: 'PREPARE', quantity: 1, quantityReady: 0, quantityCollected: 0, quantityServed: 0 },
              ],
            },
            {
              id: 't3',
              stationId: 's2',
              status: 'QUEUED',
              ticketType: 'PREPARATION',
              collectionLabelSnapshot: null,
              station: { name: 'Hot Line' },
              kitchen: { name: 'Main Kitchen' },
              lines: [],
            },
            {
              id: 't4',
              stationId: 's3',
              status: 'COMPLETED',
              ticketType: 'PREPARATION',
              collectionLabelSnapshot: null,
              station: { name: 'Dessert' },
              kitchen: { name: 'Main Kitchen' },
              lines: [],
            },
          ],
        },
      ]);

      const result = await service.getServiceBoard({
        tenantId: 't1',
        branchId: 'b1',
        waiterUserId: 'w1',
        scope: 'mine',
      });

      expect(result[0].outstandingStations).toEqual(['Hot Line']);
      expect(result[0].collectionPoints).toEqual(['Main pass']);
    });
  });
});
