import { vi, describe, it, expect, beforeEach } from 'vitest';
import { RecipesService } from './recipes.service';
import { NotFoundException, ConflictException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { FeatureResolver } from '../features/feature-resolver.service';

function createMockPrisma() {
  const mockTx = {
    recipe: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    recipeComponent: {
      deleteMany: vi.fn(),
    },
    menuItemVariant: {
      findFirst: vi.fn(),
    },
    inventoryItem: {
      findFirst: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  };

  return {
    $transaction: vi.fn(async (fn: any) => fn(mockTx)),
    recipe: {
      findFirst: vi.fn(),
    },
    menuItemVariant: {
      findFirst: vi.fn(),
    },
    inventoryItem: {
      findFirst: vi.fn(),
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

describe('RecipesService', () => {
  let service: RecipesService;
  let prisma: ReturnType<typeof createMockPrisma>;
  let featureResolver: FeatureResolver;

  beforeEach(() => {
    prisma = createMockPrisma();
    featureResolver = createMockFeatureResolver();
    service = new RecipesService(prisma, featureResolver);
  });

  describe('getRecipe', () => {
    it('returns null when no active recipe found', async () => {
      prisma.recipe.findFirst.mockResolvedValue(null);

      const result = await service.getRecipe({
        tenantId: 't1', branchId: 'b1', variantId: 'v1',
      });

      expect(result).toBeNull();
    });

    it('returns serialized recipe with components', async () => {
      const recipe = {
        id: 'r1', tenantId: 't1', branchId: 'b1', menuItemVariantId: 'v1',
        name: 'Burger Recipe', version: 1, isActive: true,
        createdAt: new Date(), updatedAt: new Date(),
        components: [
          {
            id: 'c1', inventoryItemId: 'i1', quantity: 0.2, unit: 'kg',
            portionQuantity: null,
            inventoryItem: { id: 'i1', name: 'Bun', baseUnit: 'kg' },
          },
        ],
      };
      prisma.recipe.findFirst.mockResolvedValue(recipe);

      const result = await service.getRecipe({
        tenantId: 't1', branchId: 'b1', variantId: 'v1',
      });

      expect(result!.name).toBe('Burger Recipe');
      expect(result!.components).toHaveLength(1);
      expect(result!.components[0].inventoryItemName).toBe('Bun');
    });
  });

  describe('upsertRecipe', () => {
    const validVariant = { id: 'v1', tenantId: 't1' };
    const validItem = { id: 'i1', tenantId: 't1', branchId: 'b1', baseUnit: 'kg', isActive: true };

    it('creates new recipe when none exists', async () => {
      prisma.menuItemVariant.findFirst.mockResolvedValue(validVariant);
      prisma.inventoryItem.findFirst.mockResolvedValue(validItem);
      prisma._mockTx.recipe.findFirst.mockResolvedValue(null);
      const newRecipe = {
        id: 'r1', tenantId: 't1', branchId: 'b1', menuItemVariantId: 'v1',
        name: 'New Recipe', version: 1, isActive: true,
        createdAt: new Date(), updatedAt: new Date(),
        components: [
          { id: 'c1', inventoryItemId: 'i1', quantity: 0.5, unit: 'kg', portionQuantity: null, inventoryItem: { id: 'i1', name: 'Flour', baseUnit: 'kg' } },
        ],
      };
      prisma._mockTx.recipe.create.mockResolvedValue(newRecipe);

      const result = await service.upsertRecipe({
        tenantId: 't1', branchId: 'b1', variantId: 'v1',
        name: 'New Recipe',
        components: [{ inventoryItemId: 'i1', quantity: 0.5, unit: 'kg' }],
        actorUserId: 'user-1',
      });

      expect(result.version).toBe(1);
      expect(result.name).toBe('New Recipe');
    });

    it('increments version when updating existing recipe', async () => {
      prisma.menuItemVariant.findFirst.mockResolvedValue(validVariant);
      prisma.inventoryItem.findFirst.mockResolvedValue(validItem);
      const existing = {
        id: 'r1', version: 3, tenantId: 't1', branchId: 'b1',
        menuItemVariantId: 'v1', name: 'Old Recipe', isActive: true,
      };
      prisma._mockTx.recipe.findFirst.mockResolvedValue(existing);
      const updated = {
        ...existing, name: 'Updated Recipe', version: 4,
        components: [
          { id: 'c2', inventoryItemId: 'i1', quantity: 1, unit: 'kg', portionQuantity: null, inventoryItem: { id: 'i1', name: 'Flour', baseUnit: 'kg' } },
        ],
      };
      prisma._mockTx.recipe.update.mockResolvedValue(updated);

      const result = await service.upsertRecipe({
        tenantId: 't1', branchId: 'b1', variantId: 'v1',
        name: 'Updated Recipe',
        components: [{ inventoryItemId: 'i1', quantity: 1, unit: 'kg' }],
        actorUserId: 'user-1',
      });

      expect(result.version).toBe(4);
    });

    it('rejects empty components', async () => {
      prisma.menuItemVariant.findFirst.mockResolvedValue(validVariant);

      await expect(
        service.upsertRecipe({
          tenantId: 't1', branchId: 'b1', variantId: 'v1',
          name: 'Empty Recipe', components: [], actorUserId: 'user-1',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException for missing variant', async () => {
      prisma.menuItemVariant.findFirst.mockResolvedValue(null);

      await expect(
        service.upsertRecipe({
          tenantId: 't1', branchId: 'b1', variantId: 'missing',
          name: 'Recipe', components: [{ inventoryItemId: 'i1', quantity: 1, unit: 'kg' }],
          actorUserId: 'user-1',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for missing inventory item', async () => {
      prisma.menuItemVariant.findFirst.mockResolvedValue(validVariant);
      prisma.inventoryItem.findFirst.mockResolvedValue(null);

      await expect(
        service.upsertRecipe({
          tenantId: 't1', branchId: 'b1', variantId: 'v1',
          name: 'Recipe', components: [{ inventoryItemId: 'missing', quantity: 1, unit: 'kg' }],
          actorUserId: 'user-1',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteRecipe', () => {
    it('soft-deletes recipe and writes audit', async () => {
      const existing = {
        id: 'r1', name: 'Recipe', version: 1, isActive: true,
        tenantId: 't1', branchId: 'b1', menuItemVariantId: 'v1',
      };
      prisma.recipe.findFirst.mockResolvedValue(existing);

      const result = await service.deleteRecipe({
        tenantId: 't1', branchId: 'b1', variantId: 'v1', actorUserId: 'user-1',
      });

      expect(result.deleted).toBe(true);
      expect(prisma._mockTx.recipe.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isActive: false }),
        }),
      );
      expect(prisma._mockTx.auditLog.create).toHaveBeenCalled();
    });

    it('throws NotFoundException when recipe not found', async () => {
      prisma.recipe.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteRecipe({
          tenantId: 't1', branchId: 'b1', variantId: 'missing', actorUserId: 'user-1',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getRecipeForDeduction', () => {
    it('returns recipe from transaction client', async () => {
      const mockTx = {
        recipe: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'r1', components: [{ inventoryItemId: 'i1' }],
          }),
        },
      };

      const result = await service.getRecipeForDeduction(
        mockTx as any, 't1', 'b1', 'v1',
      );

      expect(result).not.toBeNull();
      expect(mockTx.recipe.findFirst).toHaveBeenCalled();
    });
  });
});
