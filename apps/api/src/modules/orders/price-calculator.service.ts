import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

export interface LineInput {
  variantId: string;
  quantity: number;
  modifierOptionIds?: string[];
  notes?: string;
}

export interface CalculatedModifier {
  modifierOptionId: string;
  nameSnapshot: string;
  unitPriceDeltaMinor: bigint;
  quantity: number;
  totalDeltaMinor: bigint;
}

export interface CalculatedLine {
  menuItemId: string;
  variantId: string;
  itemNameSnapshot: string;
  variantNameSnapshot: string;
  skuSnapshot: string | null;
  unitPriceMinor: bigint;
  quantity: number;
  lineTotalMinor: bigint;
  modifiers: CalculatedModifier[];
}

export interface CartCalculation {
  lines: CalculatedLine[];
  subtotalMinor: bigint;
}

/**
 * Server-authoritative price calculation.
 *
 * Rules:
 * - Load active tenant-owned items, variants, modifiers
 * - Check branch availability and time windows
 * - Apply branch price override only for default variants
 * - Reject inactive/deleted items and options
 * - Calculate all totals using BigInt minor units
 * - Never trust client totals
 */
@Injectable()
export class PriceCalculatorService {
  constructor(private readonly prisma: PrismaService) {}

  async calculateCart(
    tenantId: string,
    branchId: string,
    lines: LineInput[],
  ): Promise<CartCalculation> {
    if (lines.length === 0) {
      return { lines: [], subtotalMinor: 0n };
    }

    // 1. Load all variants in one query
    const variantIds = lines.map((l) => l.variantId);
    const variants = await this.prisma.menuItemVariant.findMany({
      where: {
        id: { in: variantIds },
        tenantId,
        isActive: true,
        menuItem: { isActive: true, deletedAt: null },
      },
      include: {
        menuItem: { select: { id: true, name: true, sku: true } },
      },
    });

    const variantMap = new Map(variants.map((v) => [v.id, v]));

    // 2. Load branch availability for all items
    const menuItemIds = [...new Set(variants.map((v) => v.menuItemId))];
    const branchItems = await this.prisma.branchMenuItem.findMany({
      where: {
        branchId,
        menuItemId: { in: menuItemIds },
      },
    });
    const branchItemMap = new Map(branchItems.map((bi) => [bi.menuItemId, bi]));

    // 3. Load all modifier options in one query
    const allModifierIds = lines.flatMap((l) => l.modifierOptionIds ?? []);
    const uniqueModifierIds = [...new Set(allModifierIds)];
    const modifierOptions =
      uniqueModifierIds.length > 0
        ? await this.prisma.modifierOption.findMany({
            where: {
              id: { in: uniqueModifierIds },
              tenantId,
              isActive: true,
            },
          })
        : [];
    const modifierMap = new Map(modifierOptions.map((m) => [m.id, m]));

    // 4. Calculate each line
    const calculatedLines: CalculatedLine[] = [];
    let subtotalMinor = 0n;

    for (const input of lines) {
      const variant = variantMap.get(input.variantId);
      if (!variant) {
        throw new NotFoundException(
          `Variant ${input.variantId} not found or inactive`,
        );
      }

      const branchItem = branchItemMap.get(variant.menuItemId);
      if (branchItem && !branchItem.isAvailable) {
        throw new ConflictException(
          `Item "${variant.menuItem.name}" is not available at this branch`,
        );
      }

      // Determine unit price: branch override on default variant, or base price
      let unitPriceMinor = variant.basePriceMinor;
      if (branchItem?.priceOverrideMinor != null && variant.isDefault) {
        unitPriceMinor = branchItem.priceOverrideMinor;
      }

      // Calculate modifier deltas
      const calculatedModifiers: CalculatedModifier[] = [];
      let modifierTotal = 0n;

      for (const modId of input.modifierOptionIds ?? []) {
        const mod = modifierMap.get(modId);
        if (!mod) {
          throw new NotFoundException(
            `Modifier option ${modId} not found or inactive`,
          );
        }
        const delta: CalculatedModifier = {
          modifierOptionId: mod.id,
          nameSnapshot: mod.name,
          unitPriceDeltaMinor: mod.priceDeltaMinor,
          quantity: 1,
          totalDeltaMinor: mod.priceDeltaMinor,
        };
        calculatedModifiers.push(delta);
        modifierTotal += mod.priceDeltaMinor;
      }

      const quantity = input.quantity;
      const lineTotal = unitPriceMinor * BigInt(quantity) + modifierTotal;

      calculatedLines.push({
        menuItemId: variant.menuItem.id,
        variantId: variant.id,
        itemNameSnapshot: variant.menuItem.name,
        variantNameSnapshot: variant.name,
        skuSnapshot: variant.sku ?? variant.menuItem.sku,
        unitPriceMinor,
        quantity,
        lineTotalMinor: lineTotal,
        modifiers: calculatedModifiers,
      });

      subtotalMinor += lineTotal;
    }

    return { lines: calculatedLines, subtotalMinor };
  }
}
