import { vi, describe, it, expect, beforeEach } from 'vitest';
import { InventoryMovementsService } from './inventory-movements.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { FeatureResolver } from '../features/feature-resolver.service';

function createMockPrisma() {
  return {
    inventoryMovement: {
      findMany: vi.fn(),
    },
    _mockTx: {},
  } as unknown as PrismaService;
}

function createMockFeatureResolver(): FeatureResolver {
  return {
    resolve: vi.fn().mockResolvedValue({
      effective: true,
      platformStatus: 'ENABLED',
      trialEndsAt: null,
      tenantEnabled: true,
      branchOverride: null,
    }),
    assertEffective: vi.fn().mockResolvedValue(undefined),
    resolveAll: vi.fn().mockResolvedValue({}),
    getCatalog: vi.fn().mockReturnValue([]),
  } as unknown as FeatureResolver;
}

describe('InventoryMovementsService', () => {
  let service: InventoryMovementsService;
  let prisma: ReturnType<typeof createMockPrisma>;
  let featureResolver: FeatureResolver;

  beforeEach(() => {
    prisma = createMockPrisma();
    featureResolver = createMockFeatureResolver();
    service = new InventoryMovementsService(prisma, featureResolver);
  });

  describe('listMovements', () => {
    it('returns paginated movements with nextCursor', async () => {
      const movements = [
        { id: 'm1', tenantId: 't1', branchId: 'b1', inventoryItemId: 'i1', batchId: 'batch1', movementType: 'RECEIVE', quantity: 50, unit: 'kg', orderId: null, reason: 'received', actorUserId: 'u1', idempotencyKey: 'k1', createdAt: new Date() },
        { id: 'm2', tenantId: 't1', branchId: 'b1', inventoryItemId: 'i1', batchId: 'batch1', movementType: 'DEDUCT', quantity: 10, unit: 'kg', orderId: 'o1', reason: 'order deduction', actorUserId: 'u1', idempotencyKey: 'k2', createdAt: new Date() },
        { id: 'm3', tenantId: 't1', branchId: 'b1', inventoryItemId: 'i1', batchId: 'batch1', movementType: 'ADJUST', quantity: 5, unit: 'kg', orderId: null, reason: 'count adjustment', actorUserId: 'u1', idempotencyKey: 'k3', createdAt: new Date() },
      ];
      prisma.inventoryMovement.findMany.mockResolvedValue(movements);

      const result = await service.listMovements({
        tenantId: 't1', branchId: 'b1', inventoryItemId: 'i1', limit: 2,
      });

      expect(result.movements).toHaveLength(2);
      expect(result.nextCursor).toBe('m3');
    });

    it('filters by movementType', async () => {
      prisma.inventoryMovement.findMany.mockResolvedValue([]);

      await service.listMovements({
        tenantId: 't1', branchId: 'b1', inventoryItemId: 'i1',
        movementType: 'DEDUCT',
      });

      const where = prisma.inventoryMovement.findMany.mock.calls[0][0].where;
      expect(where.movementType).toBe('DEDUCT');
    });

    it('filters by date range', async () => {
      prisma.inventoryMovement.findMany.mockResolvedValue([]);

      await service.listMovements({
        tenantId: 't1', branchId: 'b1', inventoryItemId: 'i1',
        from: '2026-01-01', to: '2026-12-31',
      });

      const where = prisma.inventoryMovement.findMany.mock.calls[0][0].where;
      expect(where.createdAt.gte).toBeInstanceOf(Date);
      expect(where.createdAt.lte).toBeInstanceOf(Date);
    });

    it('returns movements with nextCursor undefined when fewer than limit', async () => {
      const movements = [
        { id: 'm1', tenantId: 't1', branchId: 'b1', inventoryItemId: 'i1', batchId: 'batch1', movementType: 'RECEIVE', quantity: 50, unit: 'kg', orderId: null, reason: 'received', actorUserId: 'u1', idempotencyKey: 'k1', createdAt: new Date() },
      ];
      prisma.inventoryMovement.findMany.mockResolvedValue(movements);

      const result = await service.listMovements({
        tenantId: 't1', branchId: 'b1', inventoryItemId: 'i1', limit: 50,
      });

      expect(result.movements).toHaveLength(1);
      expect(result.nextCursor).toBeUndefined();
    });
  });

  describe('getMovementAggregate', () => {
    it('calculates total stock from all movement types', async () => {
      const movements = [
        { movementType: 'RECEIVE', quantity: 100 },
        { movementType: 'RECEIVE', quantity: 50 },
        { movementType: 'DEDUCT', quantity: 30 },
        { movementType: 'DEDUCT', quantity: 10 },
        { movementType: 'ADJUST', quantity: 5 },
        { movementType: 'VOID_RESTORE', quantity: 20 },
        { movementType: 'WASTE', quantity: 3 },
      ];
      prisma.inventoryMovement.findMany.mockResolvedValue(movements);

      const result = await service.getMovementAggregate({
        tenantId: 't1', branchId: 'b1', inventoryItemId: 'i1',
      });

      expect(result.received).toBe(150);
      expect(result.deducted).toBe(40);
      expect(result.adjusted).toBe(5);
      expect(result.voidRestored).toBe(20);
      expect(result.wasted).toBe(3);
      expect(result.totalStock).toBe(132); // 150 - 40 + 5 + 20 - 3
    });

    it('returns zeros for no movements', async () => {
      prisma.inventoryMovement.findMany.mockResolvedValue([]);

      const result = await service.getMovementAggregate({
        tenantId: 't1', branchId: 'b1', inventoryItemId: 'i1',
      });

      expect(result.received).toBe(0);
      expect(result.deducted).toBe(0);
      expect(result.adjusted).toBe(0);
      expect(result.voidRestored).toBe(0);
      expect(result.wasted).toBe(0);
      expect(result.totalStock).toBe(0);
    });
  });
});
