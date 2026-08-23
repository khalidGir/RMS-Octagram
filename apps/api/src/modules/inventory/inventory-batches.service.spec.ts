import { vi, describe, it, expect, beforeEach } from 'vitest';
import { InventoryBatchesService } from './inventory-batches.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { FeatureResolver } from '../features/feature-resolver.service';

function createMockPrisma() {
  const mockTx = {
    inventoryMovement: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    inventoryBatch: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  };

  return {
    $transaction: vi.fn(async (fn: any) => fn(mockTx)),
    inventoryItem: {
      findFirst: vi.fn(),
    },
    inventoryBatch: {
      findMany: vi.fn(),
    },
    _mockTx: mockTx,
  } as unknown as PrismaService & { _mockTx: typeof mockTx };
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

describe('InventoryBatchesService', () => {
  let service: InventoryBatchesService;
  let prisma: ReturnType<typeof createMockPrisma>;
  let featureResolver: FeatureResolver;

  beforeEach(() => {
    prisma = createMockPrisma();
    featureResolver = createMockFeatureResolver();
    service = new InventoryBatchesService(prisma, featureResolver);
  });

  describe('receiveBatch', () => {
    const validItem = { id: 'item-1', tenantId: 't1', branchId: 'b1', baseUnit: 'kg', isActive: true };

    it('creates batch and movement with audit', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(validItem);
      const batch = {
        id: 'batch-1', tenantId: 't1', branchId: 'b1', inventoryItemId: 'item-1',
        batchCode: 'B001', receivedQuantity: 50, remainingQuantity: 50, unit: 'kg',
        portionCount: null, remainingPortions: null, costMinor: null,
        receivedAt: new Date(), expiresAt: null, createdAt: new Date(),
      };
      const movement = {
        id: 'mov-1', tenantId: 't1', branchId: 'b1', inventoryItemId: 'item-1',
        batchId: 'batch-1', movementType: 'RECEIVE', quantity: 50, unit: 'kg',
        orderId: null, reason: 'Batch received: B001', actorUserId: 'user-1',
        idempotencyKey: 'receive:batch-1', createdAt: new Date(),
      };
      prisma._mockTx.inventoryBatch.create.mockResolvedValue(batch);
      prisma._mockTx.inventoryMovement.create.mockResolvedValue(movement);

      const result = await service.receiveBatch({
        tenantId: 't1', branchId: 'b1', inventoryItemId: 'item-1',
        batchCode: 'B001', receivedQuantity: 50, unit: 'kg',
        actorUserId: 'user-1',
      });

      expect(result.batch.batchCode).toBe('B001');
      expect(result.movement.movementType).toBe('RECEIVE');
      expect(result.idempotent).toBe(false);
      expect(prisma._mockTx.auditLog.create).toHaveBeenCalled();
    });

    it('rejects zero receivedQuantity', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(validItem);

      await expect(
        service.receiveBatch({
          tenantId: 't1', branchId: 'b1', inventoryItemId: 'item-1',
          batchCode: 'B001', receivedQuantity: 0, unit: 'kg',
          actorUserId: 'user-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects negative receivedQuantity', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(validItem);

      await expect(
        service.receiveBatch({
          tenantId: 't1', branchId: 'b1', inventoryItemId: 'item-1',
          batchCode: 'B001', receivedQuantity: -10, unit: 'kg',
          actorUserId: 'user-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException for missing item', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(null);

      await expect(
        service.receiveBatch({
          tenantId: 't1', branchId: 'b1', inventoryItemId: 'missing',
          batchCode: 'B001', receivedQuantity: 50, unit: 'kg',
          actorUserId: 'user-1',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects incompatible units', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(validItem);

      await expect(
        service.receiveBatch({
          tenantId: 't1', branchId: 'b1', inventoryItemId: 'item-1',
          batchCode: 'B001', receivedQuantity: 50, unit: 'ml',
          actorUserId: 'user-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns idempotent response for duplicate idempotency key', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(validItem);
      const existingMovement = {
        id: 'mov-existing', tenantId: 't1', branchId: 'b1', inventoryItemId: 'item-1',
        batchId: 'batch-existing', movementType: 'RECEIVE', quantity: 50, unit: 'kg',
        orderId: null, reason: 'Batch received: B001', actorUserId: 'user-1',
        idempotencyKey: 'key-1', createdAt: new Date(),
      };
      const existingBatch = {
        id: 'batch-existing', batchCode: 'B001', receivedQuantity: 50,
        remainingQuantity: 50, unit: 'kg', portionCount: null, remainingPortions: null,
        costMinor: null, receivedAt: new Date(), expiresAt: null, createdAt: new Date(),
        tenantId: 't1', branchId: 'b1', inventoryItemId: 'item-1',
      };
      prisma._mockTx.inventoryMovement.findUnique.mockResolvedValue(existingMovement);
      prisma._mockTx.inventoryBatch.findUnique.mockResolvedValue(existingBatch);

      const result = await service.receiveBatch({
        tenantId: 't1', branchId: 'b1', inventoryItemId: 'item-1',
        batchCode: 'B001', receivedQuantity: 50, unit: 'kg',
        idempotencyKey: 'key-1', actorUserId: 'user-1',
      });

      expect(result.idempotent).toBe(true);
      expect(result.movement.id).toBe('mov-existing');
    });
  });

  describe('listBatches', () => {
    it('returns serialized batches', async () => {
      const batches = [
        {
          id: 'b1', tenantId: 't1', branchId: 'br1', inventoryItemId: 'i1',
          batchCode: 'B001', receivedQuantity: 50, remainingQuantity: 30, unit: 'kg',
          portionCount: null, remainingPortions: null, costMinor: BigInt(500),
          receivedAt: new Date(), expiresAt: null, createdAt: new Date(),
        },
      ];
      prisma.inventoryBatch.findMany.mockResolvedValue(batches);

      const result = await service.listBatches({ tenantId: 't1', branchId: 'br1', inventoryItemId: 'i1' });
      expect(result.batches).toHaveLength(1);
      expect(result.batches[0].costMinor).toBe('500');
    });
  });
});
