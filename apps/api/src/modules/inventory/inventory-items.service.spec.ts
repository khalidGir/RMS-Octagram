import { vi, describe, it, expect, beforeEach } from 'vitest';
import { InventoryItemsService } from './inventory-items.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { FeatureResolver } from '../features/feature-resolver.service';

function createMockPrisma() {
  const mockTx = {
    inventoryItem: {
      create: vi.fn(),
      update: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  };

  return {
    $transaction: vi.fn(async (fn: any) => fn(mockTx)),
    inventoryItem: {
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
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

describe('InventoryItemsService', () => {
  let service: InventoryItemsService;
  let prisma: ReturnType<typeof createMockPrisma>;
  let featureResolver: FeatureResolver;

  beforeEach(() => {
    prisma = createMockPrisma();
    featureResolver = createMockFeatureResolver();
    service = new InventoryItemsService(prisma, featureResolver);
  });

  describe('createItem', () => {
    it('creates item with audit log', async () => {
      const item = {
        id: 'item-1',
        tenantId: 't1',
        branchId: 'b1',
        name: 'Flour',
        sku: 'FL001',
        baseUnit: 'kg',
        lowStockThreshold: 5,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prisma._mockTx.inventoryItem.create.mockResolvedValue(item);

      const result = await service.createItem({
        tenantId: 't1',
        branchId: 'b1',
        name: 'Flour',
        sku: 'FL001',
        baseUnit: 'kg',
        lowStockThreshold: 5,
        actorUserId: 'user-1',
      });

      expect(result.id).toBe('item-1');
      expect(result.name).toBe('Flour');
      expect(result.baseUnit).toBe('kg');
      expect(prisma._mockTx.auditLog.create).toHaveBeenCalled();
    });

    it('normalizes base unit to lowercase', async () => {
      const item = {
        id: 'item-2',
        tenantId: 't1',
        branchId: 'b1',
        name: 'Milk',
        sku: null,
        baseUnit: 'ml',
        lowStockThreshold: 0,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prisma._mockTx.inventoryItem.create.mockResolvedValue(item);

      const result = await service.createItem({
        tenantId: 't1',
        branchId: 'b1',
        name: 'Milk',
        baseUnit: 'ML',
        actorUserId: 'user-1',
      });

      expect(result.baseUnit).toBe('ml');
    });

    it('throws for unknown unit', async () => {
      await expect(
        service.createItem({
          tenantId: 't1',
          branchId: 'b1',
          name: 'Thing',
          baseUnit: 'widget',
          actorUserId: 'user-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getItemById', () => {
    it('returns item when found', async () => {
      const item = {
        id: 'item-1',
        tenantId: 't1',
        branchId: 'b1',
        name: 'Flour',
        sku: 'FL001',
        baseUnit: 'kg',
        lowStockThreshold: 5,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prisma.inventoryItem.findFirst.mockResolvedValue(item);

      const result = await service.getItemById('t1', 'b1', 'item-1');
      expect(result.id).toBe('item-1');
    });

    it('throws NotFoundException when item not found', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(null);

      await expect(service.getItemById('t1', 'b1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateItem', () => {
    it('updates item fields', async () => {
      const existing = {
        id: 'item-1',
        tenantId: 't1',
        branchId: 'b1',
        name: 'Flour',
        sku: 'FL001',
        baseUnit: 'kg',
        lowStockThreshold: 5,
        isActive: true,
      };
      const updated = { ...existing, name: 'All-Purpose Flour', lowStockThreshold: 10 };
      prisma.inventoryItem.findFirst.mockResolvedValue(existing);
      prisma._mockTx.inventoryItem.update.mockResolvedValue(updated);

      const result = await service.updateItem({
        tenantId: 't1',
        branchId: 'b1',
        itemId: 'item-1',
        name: 'All-Purpose Flour',
        lowStockThreshold: 10,
        actorUserId: 'user-1',
      });

      expect(result.name).toBe('All-Purpose Flour');
      expect(prisma._mockTx.auditLog.create).toHaveBeenCalled();
    });

    it('throws NotFoundException for missing item', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(null);

      await expect(
        service.updateItem({
          tenantId: 't1',
          branchId: 'b1',
          itemId: 'missing',
          name: 'New',
          actorUserId: 'user-1',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('listItems', () => {
    it('paginates with cursor', async () => {
      const items = [
        { id: 'i1', tenantId: 't1', branchId: 'b1', name: 'A', sku: null, baseUnit: 'kg', lowStockThreshold: 0, isActive: true, createdAt: new Date(), updatedAt: new Date() },
        { id: 'i2', tenantId: 't1', branchId: 'b1', name: 'B', sku: null, baseUnit: 'kg', lowStockThreshold: 0, isActive: true, createdAt: new Date(), updatedAt: new Date() },
      ];
      prisma.inventoryItem.findMany.mockResolvedValue(items);

      const result = await service.listItems({ tenantId: 't1', branchId: 'b1', limit: 2 });
      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBeUndefined();
    });

    it('returns nextCursor when more items exist', async () => {
      const items = [
        { id: 'i1', tenantId: 't1', branchId: 'b1', name: 'A', sku: null, baseUnit: 'kg', lowStockThreshold: 0, isActive: true, createdAt: new Date(), updatedAt: new Date() },
        { id: 'i2', tenantId: 't1', branchId: 'b1', name: 'B', sku: null, baseUnit: 'kg', lowStockThreshold: 0, isActive: true, createdAt: new Date(), updatedAt: new Date() },
        { id: 'i3', tenantId: 't1', branchId: 'b1', name: 'C', sku: null, baseUnit: 'kg', lowStockThreshold: 0, isActive: true, createdAt: new Date(), updatedAt: new Date() },
      ];
      prisma.inventoryItem.findMany.mockResolvedValue(items);

      const result = await service.listItems({ tenantId: 't1', branchId: 'b1', limit: 2 });
      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBe('i3');
    });
  });

  describe('getLowStockAlerts', () => {
    it('returns items below threshold sorted by stock ascending', async () => {
      const items = [
        {
          id: 'i1', name: 'Sugar', sku: 'S1', baseUnit: 'kg', lowStockThreshold: 10,
          batches: [{ remainingQuantity: 3, unit: 'kg' }],
        },
        {
          id: 'i2', name: 'Flour', sku: 'F1', baseUnit: 'kg', lowStockThreshold: 10,
          batches: [{ remainingQuantity: 8, unit: 'kg' }],
        },
      ];
      prisma.inventoryItem.findMany.mockResolvedValue(items);

      const result = await service.getLowStockAlerts({ tenantId: 't1', branchId: 'b1' });
      expect(result.alerts).toHaveLength(2);
      expect(result.alerts[0].name).toBe('Sugar');
      expect(result.alerts[1].name).toBe('Flour');
    });

    it('returns empty when all items above threshold', async () => {
      const items = [
        {
          id: 'i1', name: 'Sugar', sku: 'S1', baseUnit: 'kg', lowStockThreshold: 5,
          batches: [{ remainingQuantity: 20, unit: 'kg' }],
        },
      ];
      prisma.inventoryItem.findMany.mockResolvedValue(items);

      const result = await service.getLowStockAlerts({ tenantId: 't1', branchId: 'b1' });
      expect(result.alerts).toHaveLength(0);
    });
  });
});
