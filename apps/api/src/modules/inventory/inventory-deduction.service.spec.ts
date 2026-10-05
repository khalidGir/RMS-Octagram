import { vi, describe, it, expect, beforeEach } from 'vitest';
import { InventoryDeductionService } from './inventory-deduction.service';
import { ConflictException, BadRequestException } from '@nestjs/common';
import type { FeatureResolver } from '../features/feature-resolver.service';

function createMockPrisma() {
  return {
    inventoryMovement: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    inventoryBatch: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    recipe: {
      findFirst: vi.fn(),
    },
    inventoryItem: {
      findFirst: vi.fn(),
    },
    auditLog: { create: vi.fn() },
    $executeRaw: vi.fn(),
  };
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

describe('InventoryDeductionService', () => {
  let service: InventoryDeductionService;
  let prisma: ReturnType<typeof createMockPrisma>;
  let featureResolver: FeatureResolver;
  let mockTx: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    prisma = createMockPrisma();
    featureResolver = createMockFeatureResolver();
    service = new InventoryDeductionService(prisma as any, featureResolver);
    mockTx = createMockPrisma();
  });

  describe('deductForOrder', () => {
    const baseParams = {
      tenantId: 't1', branchId: 'b1', orderId: 'order-1',
      lines: [{ variantId: 'v1', quantity: 2 }],
      actorUserId: 'user-1',
    };

    it('returns empty when INVENTORY feature is disabled', async () => {
      (featureResolver.resolve as any).mockResolvedValue({ effective: false });

      const result = await service.deductForOrder(mockTx as any, baseParams);

      expect(result.movements).toHaveLength(0);
      expect(result.totalLines).toBe(0);
    });

    it('skips variants without active recipe', async () => {
      mockTx.inventoryMovement.findMany.mockResolvedValue([]);
      mockTx.recipe.findFirst.mockResolvedValue(null);

      const result = await service.deductForOrder(mockTx as any, baseParams);

      expect(result.movements).toHaveLength(0);
    });

    it('deducts from FIFO batches and creates movements', async () => {
      mockTx.inventoryMovement.findMany.mockResolvedValue([]);
      mockTx.recipe.findFirst.mockResolvedValue({
        id: 'r1', components: [
          { inventoryItemId: 'i1', quantity: 0.5, unit: 'kg' },
        ],
      });
      mockTx.inventoryBatch.findMany.mockResolvedValue([
        { id: 'batch1', batchCode: 'B001', remainingQuantity: 100, receivedQuantity: 100, portionCount: null, remainingPortions: null },
        { id: 'batch2', batchCode: 'B002', remainingQuantity: 50, receivedQuantity: 50, portionCount: null, remainingPortions: null },
      ]);
      mockTx.$executeRaw.mockResolvedValue(undefined);
      mockTx.inventoryBatch.findUnique.mockResolvedValue({
        id: 'batch1', remainingQuantity: 99, batchCode: 'B001',
      });
      mockTx.inventoryMovement.create.mockResolvedValue({
        id: 'mov-1', inventoryItemId: 'i1', batchId: 'batch1',
        quantity: 1, unit: 'kg',
      });

      const result = await service.deductForOrder(mockTx as any, baseParams);

      expect(result.movements.length).toBeGreaterThan(0);
      expect(mockTx.$executeRaw).toHaveBeenCalled();
      expect(mockTx.auditLog.create).toHaveBeenCalled();
    });

    it('returns existing movements for idempotent deduction', async () => {
      const existingMovements = [
        { id: 'mov-existing', inventoryItemId: 'i1', batchId: 'batch1', quantity: 1, unit: 'kg' },
      ];
      mockTx.inventoryMovement.findMany.mockResolvedValue(existingMovements);

      const result = await service.deductForOrder(mockTx as any, baseParams);

      expect(result.movements).toHaveLength(1);
      expect(result.movements[0].id).toBe('mov-existing');
    });

    it('throws ConflictException when no eligible batches', async () => {
      mockTx.inventoryMovement.findMany.mockResolvedValue([]);
      mockTx.recipe.findFirst.mockResolvedValue({
        id: 'r1', components: [
          { inventoryItemId: 'i1', quantity: 0.5, unit: 'kg' },
        ],
      });
      mockTx.inventoryBatch.findMany.mockResolvedValue([]);

      await expect(
        service.deductForOrder(mockTx as any, baseParams),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('restoreForVoid', () => {
    const baseParams = {
      tenantId: 't1', branchId: 'b1', orderId: 'order-1', actorUserId: 'user-1',
    };

    it('returns empty when INVENTORY feature is disabled', async () => {
      (featureResolver.resolve as any).mockResolvedValue({ effective: false });

      const result = await service.restoreForVoid(mockTx as any, baseParams);

      expect(result.movements).toHaveLength(0);
    });

    it('returns empty when no original deductions exist', async () => {
      mockTx.inventoryMovement.findMany.mockResolvedValue([]);

      const result = await service.restoreForVoid(mockTx as any, baseParams);

      expect(result.movements).toHaveLength(0);
    });

    it('restores exact batches from original deductions', async () => {
      const originalDeductions = [
        { id: 'd1', inventoryItemId: 'i1', batchId: 'batch1', quantity: 5, unit: 'kg' },
        { id: 'd2', inventoryItemId: 'i2', batchId: 'batch2', quantity: 3, unit: 'ml' },
      ];
      mockTx.inventoryMovement.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(originalDeductions);
      mockTx.$executeRaw.mockResolvedValue(undefined);
      mockTx.inventoryBatch.findUnique.mockResolvedValue(null);
      mockTx.inventoryMovement.create.mockResolvedValue({
        id: 'restore-1', inventoryItemId: 'i1', batchId: 'batch1',
        quantity: 5, unit: 'kg',
      });

      const result = await service.restoreForVoid(mockTx as any, baseParams);

      expect(result.movements).toHaveLength(2);
      expect(mockTx.$executeRaw).toHaveBeenCalledTimes(2);
      expect(mockTx.auditLog.create).toHaveBeenCalled();
    });

    it('returns existing restores for idempotent void', async () => {
      const existingRestores = [
        { id: 'restore-existing', inventoryItemId: 'i1', batchId: 'batch1', quantity: 5, unit: 'kg' },
      ];
      mockTx.inventoryMovement.findMany.mockResolvedValue(existingRestores);

      const result = await service.restoreForVoid(mockTx as any, baseParams);

      expect(result.movements).toHaveLength(1);
      expect(result.movements[0].id).toBe('restore-existing');
    });
  });

  describe('recordAdjustment', () => {
    const baseParams = {
      tenantId: 't1', branchId: 'b1', inventoryItemId: 'i1',
      quantity: 10, unit: 'kg', reason: 'Physical count',
      actorUserId: 'user-1',
    };

    it('rejects zero adjustment', async () => {
      await expect(
        service.recordAdjustment(mockTx as any, { ...baseParams, quantity: 0 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws for missing item', async () => {
      mockTx.inventoryItem.findFirst.mockResolvedValue(null);

      await expect(
        service.recordAdjustment(mockTx as any, baseParams),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates adjustment movement and audit', async () => {
      mockTx.inventoryItem.findFirst.mockResolvedValue({ id: 'i1', baseUnit: 'kg' });
      mockTx.inventoryMovement.create.mockResolvedValue({
        id: 'adj-1', movementType: 'ADJUST', quantity: 10, unit: 'kg',
      });

      const result = await service.recordAdjustment(mockTx as any, baseParams);

      expect(result.idempotent).toBe(false);
      expect(mockTx.auditLog.create).toHaveBeenCalled();
    });

    it('returns idempotent for duplicate key', async () => {
      mockTx.inventoryItem.findFirst.mockResolvedValue({ id: 'i1', baseUnit: 'kg' });
      mockTx.inventoryMovement.findUnique.mockResolvedValue({
        id: 'adj-existing', movementType: 'ADJUST',
      });

      const result = await service.recordAdjustment(mockTx as any, {
        ...baseParams, idempotencyKey: 'adj-key-1',
      });

      expect(result.idempotent).toBe(true);
    });

    it('rejects negative batch adjustment that would go below zero', async () => {
      mockTx.inventoryItem.findFirst.mockResolvedValue({ id: 'i1', baseUnit: 'kg' });
      mockTx.inventoryBatch.findFirst.mockResolvedValue({
        id: 'batch1', remainingQuantity: 5, tenantId: 't1', branchId: 'b1', inventoryItemId: 'i1',
      });

      await expect(
        service.recordAdjustment(mockTx as any, {
          ...baseParams, quantity: -10, batchId: 'batch1',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('recordWaste', () => {
    const baseParams = {
      tenantId: 't1', branchId: 'b1', inventoryItemId: 'i1',
      quantity: 5, unit: 'kg', reason: 'Spoiled',
      actorUserId: 'user-1',
    };

    it('rejects zero waste', async () => {
      await expect(
        service.recordWaste(mockTx as any, { ...baseParams, quantity: 0 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects negative waste', async () => {
      await expect(
        service.recordWaste(mockTx as any, { ...baseParams, quantity: -5 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates waste movement and audit', async () => {
      mockTx.inventoryItem.findFirst.mockResolvedValue({ id: 'i1', baseUnit: 'kg' });
      mockTx.inventoryMovement.create.mockResolvedValue({
        id: 'waste-1', movementType: 'WASTE', quantity: 5, unit: 'kg',
      });

      const result = await service.recordWaste(mockTx as any, baseParams);

      expect(result.idempotent).toBe(false);
      expect(mockTx.auditLog.create).toHaveBeenCalled();
    });

    it('returns idempotent for duplicate key', async () => {
      mockTx.inventoryItem.findFirst.mockResolvedValue({ id: 'i1', baseUnit: 'kg' });
      mockTx.inventoryMovement.findUnique.mockResolvedValue({
        id: 'waste-existing', movementType: 'WASTE',
      });

      const result = await service.recordWaste(mockTx as any, {
        ...baseParams, idempotencyKey: 'waste-key-1',
      });

      expect(result.idempotent).toBe(true);
    });

    it('rejects waste that exceeds batch remaining', async () => {
      mockTx.inventoryItem.findFirst.mockResolvedValue({ id: 'i1', baseUnit: 'kg' });
      mockTx.inventoryBatch.findFirst.mockResolvedValue({
        id: 'batch1', remainingQuantity: 2, tenantId: 't1', branchId: 'b1', inventoryItemId: 'i1',
      });

      await expect(
        service.recordWaste(mockTx as any, {
          ...baseParams, quantity: 5, batchId: 'batch1',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });
});
