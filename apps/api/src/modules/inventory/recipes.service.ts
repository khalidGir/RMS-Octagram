import { Injectable, Inject, NotFoundException, ConflictException } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PrismaService } from '../prisma/prisma.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { FeatureResolver } from '../features/feature-resolver.service';
import { FeatureKey } from '@rms/contracts';
import { normalizeUnit, validateCompatibleUnits } from './unit-conversion.util';
import type { Prisma } from '@prisma/client';

@Injectable()
export class RecipesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FeatureResolver) private readonly featureResolver: FeatureResolver,
  ) {}

  async getRecipe(params: {
    tenantId: string;
    branchId: string;
    variantId: string;
  }) {
    const { tenantId, branchId, variantId } = params;

    await this.featureResolver.assertEffective(tenantId, FeatureKey.INVENTORY, branchId);

    const recipe = await this.prisma.recipe.findFirst({
      where: { tenantId, branchId, menuItemVariantId: variantId, isActive: true },
      include: {
        components: {
          include: { inventoryItem: { select: { id: true, name: true, baseUnit: true } } },
        },
      },
    });

    if (!recipe) return null;

    return this.serializeRecipe(recipe);
  }

  async upsertRecipe(params: {
    tenantId: string;
    branchId: string;
    variantId: string;
    name: string;
    components: Array<{
      inventoryItemId: string;
      quantity: number;
      unit: string;
      portionQuantity?: number;
    }>;
    actorUserId: string;
  }) {
    const { tenantId, branchId, variantId, name, components, actorUserId } = params;

    await this.featureResolver.assertEffective(tenantId, FeatureKey.INVENTORY, branchId);

    if (components.length === 0) {
      throw new ConflictException('Recipe must have at least one component');
    }

    const variant = await this.prisma.menuItemVariant.findFirst({
      where: { id: variantId, tenantId },
    });
    if (!variant) throw new NotFoundException('Menu item variant not found');

    for (const comp of components) {
      const item = await this.prisma.inventoryItem.findFirst({
        where: { id: comp.inventoryItemId, tenantId, branchId, isActive: true },
      });
      if (!item) throw new NotFoundException(`Inventory item ${comp.inventoryItemId} not found`);
      validateCompatibleUnits(comp.unit, item.baseUnit);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.recipe.findFirst({
        where: { tenantId, branchId, menuItemVariantId: variantId, isActive: true },
      });

      let recipe;
      let version: number;

      if (existing) {
        version = existing.version + 1;

        await tx.recipeComponent.deleteMany({ where: { recipeId: existing.id } });

        recipe = await tx.recipe.update({
          where: { id: existing.id },
          data: {
            name,
            version,
            components: {
              create: components.map((c) => ({
                tenantId,
                branchId,
                inventoryItemId: c.inventoryItemId,
                quantity: c.quantity,
                unit: normalizeUnit(c.unit),
                portionQuantity: c.portionQuantity ?? null,
              })),
            },
          },
          include: { components: true },
        });
      } else {
        version = 1;

        recipe = await tx.recipe.create({
          data: {
            tenantId,
            branchId,
            menuItemVariantId: variantId,
            name,
            version,
            components: {
              create: components.map((c) => ({
                tenantId,
                branchId,
                inventoryItemId: c.inventoryItemId,
                quantity: c.quantity,
                unit: normalizeUnit(c.unit),
                portionQuantity: c.portionQuantity ?? null,
              })),
            },
          },
          include: { components: true },
        });
      }

      await tx.auditLog.create({
        data: {
          actorUserId,
          tenantId,
          branchId,
          action: 'RECIPE_UPDATE',
          entityType: 'Recipe',
          entityId: recipe.id,
          afterJson: {
            name,
            version,
            variantId,
            componentCount: components.length,
          },
        },
      });

      return recipe;
    });

    return this.serializeRecipe(result);
  }

  async deleteRecipe(params: {
    tenantId: string;
    branchId: string;
    variantId: string;
    actorUserId: string;
  }) {
    const { tenantId, branchId, variantId, actorUserId } = params;

    await this.featureResolver.assertEffective(tenantId, FeatureKey.INVENTORY, branchId);

    const existing = await this.prisma.recipe.findFirst({
      where: { tenantId, branchId, menuItemVariantId: variantId, isActive: true },
    });
    if (!existing) throw new NotFoundException('Recipe not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.recipe.update({
        where: { id: existing.id },
        data: { isActive: false },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          tenantId,
          branchId,
          action: 'RECIPE_DELETE',
          entityType: 'Recipe',
          entityId: existing.id,
          beforeJson: { name: existing.name, version: existing.version, isActive: true },
          afterJson: { isActive: false },
        },
      });
    });

    return { deleted: true };
  }

  async getRecipeForDeduction(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string,
    variantId: string,
  ) {
    const recipe = await tx.recipe.findFirst({
      where: { tenantId, branchId, menuItemVariantId: variantId, isActive: true },
      include: {
        components: {
          include: { inventoryItem: { select: { id: true, name: true, baseUnit: true } } },
        },
      },
    });
    return recipe;
  }

  private serializeRecipe(recipe: Record<string, unknown>) {
    const r = recipe as any;
    return {
      id: r.id,
      tenantId: r.tenantId,
      branchId: r.branchId,
      menuItemVariantId: r.menuItemVariantId,
      name: r.name,
      version: r.version,
      isActive: r.isActive,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      components: r.components?.map((c: any) => ({
        id: c.id,
        inventoryItemId: c.inventoryItemId,
        inventoryItemName: c.inventoryItem?.name,
        quantity: c.quantity?.toString?.() ?? c.quantity,
        unit: c.unit,
        portionQuantity: c.portionQuantity?.toString?.() ?? c.portionQuantity,
      })),
    };
  }
}
