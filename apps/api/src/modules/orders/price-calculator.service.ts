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
 * - Validate modifier options belong to item's modifier groups
 * - Enforce min/max/required constraints per modifier group
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

    // 3. Load modifier groups linked to each item
    const modifierGroupLinks = await this.prisma.menuItemModifierGroup.findMany({
      where: { menuItemId: { in: menuItemIds } },
      include: {
        modifierGroup: {
          include: {
            options: { where: { isActive: true }, select: { id: true } },
          },
        },
      },
    });

    // Build map: menuItemId → { groupId → { min, max, required, optionIds } }
    const itemModifierGroups = new Map<
      string,
      Map<string, { min: number; max: number | null; required: boolean; optionIds: Set<string> }>
    >();
    for (const link of modifierGroupLinks) {
      if (!itemModifierGroups.has(link.menuItemId)) {
        itemModifierGroups.set(link.menuItemId, new Map());
      }
      const group = link.modifierGroup;
      itemModifierGroups.get(link.menuItemId)!.set(group.id, {
        min: group.minSelections,
        max: group.maxSelections,
        required: group.isRequired,
        optionIds: new Set(group.options.map((o) => o.id)),
      });
    }

    // 4. Load all modifier options in one query
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

    // 5. Calculate each line
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

      // Branch availability check: explicit unavailability rejects
      if (branchItem && !branchItem.isAvailable) {
        throw new ConflictException(
          `Item "${variant.menuItem.name}" is not available at this branch`,
        );
      }

      // Branch time window check
      if (branchItem?.availableFrom && branchItem?.availableUntil) {
        const now = new Date();
        const hours = now.getUTCHours();
        const minutes = now.getUTCMinutes();
        const currentTime = hours * 60 + minutes; // minutes since midnight UTC

        const fromParts = (branchItem.availableFrom as unknown as string).split(':');
        const fromMinutes = parseInt(fromParts[0], 10) * 60 + parseInt(fromParts[1], 10);

        const untilParts = (branchItem.availableUntil as unknown as string).split(':');
        const untilMinutes = parseInt(untilParts[0], 10) * 60 + parseInt(untilParts[1], 10);

        if (fromMinutes <= untilMinutes) {
          // Same-day window (e.g., 09:00 - 21:00)
          if (currentTime < fromMinutes || currentTime > untilMinutes) {
            throw new ConflictException(
              `Item "${variant.menuItem.name}" is only available from ${fromParts.join(':')} to ${untilParts.join(':')}`,
            );
          }
        } else {
          // Overnight window (e.g., 22:00 - 06:00)
          if (currentTime < fromMinutes && currentTime > untilMinutes) {
            throw new ConflictException(
              `Item "${variant.menuItem.name}" is only available from ${fromParts.join(':')} to ${untilParts.join(':')}`,
            );
          }
        }
      }

      // Determine unit price: branch override on default variant, or base price
      let unitPriceMinor = variant.basePriceMinor;
      if (branchItem?.priceOverrideMinor != null && variant.isDefault) {
        unitPriceMinor = branchItem.priceOverrideMinor;
      }

      // Validate modifier options belong to item's modifier groups
      const itemGroups = itemModifierGroups.get(variant.menuItemId);
      const groupSelectionCounts = new Map<string, number>();

      for (const modId of input.modifierOptionIds ?? []) {
        const mod = modifierMap.get(modId);
        if (!mod) {
          throw new NotFoundException(
            `Modifier option ${modId} not found or inactive`,
          );
        }

        // Find which group this modifier belongs to
        let belongsToGroup = false;
        if (itemGroups) {
          for (const [groupId, groupInfo] of itemGroups) {
            if (groupInfo.optionIds.has(modId)) {
              groupSelectionCounts.set(
                groupId,
                (groupSelectionCounts.get(groupId) ?? 0) + 1,
              );
              belongsToGroup = true;
              break;
            }
          }
        }

        if (!belongsToGroup) {
          throw new ConflictException(
            `Modifier option "${mod.name}" is not available for item "${variant.menuItem.name}"`,
          );
        }
      }

      // Enforce min/max/required constraints per modifier group
      if (itemGroups) {
        for (const [groupId, groupInfo] of itemGroups) {
          const count = groupSelectionCounts.get(groupId) ?? 0;

          if (groupInfo.required && count < 1) {
            throw new ConflictException(
              `At least one selection is required from modifier group`,
            );
          }
          if (count < groupInfo.min) {
            throw new ConflictException(
              `Modifier group requires at least ${groupInfo.min} selections, got ${count}`,
            );
          }
          if (groupInfo.max !== null && count > groupInfo.max) {
            throw new ConflictException(
              `Modifier group allows at most ${groupInfo.max} selections, got ${count}`,
            );
          }
        }
      }

      // Calculate modifier deltas (multiplied by line quantity)
      const calculatedModifiers: CalculatedModifier[] = [];
      let modifierTotal = 0n;
      const quantity = BigInt(input.quantity);

      for (const modId of input.modifierOptionIds ?? []) {
        const mod = modifierMap.get(modId)!;
        const totalDelta = mod.priceDeltaMinor * quantity;
        const delta: CalculatedModifier = {
          modifierOptionId: mod.id,
          nameSnapshot: mod.name,
          unitPriceDeltaMinor: mod.priceDeltaMinor,
          quantity: input.quantity,
          totalDeltaMinor: totalDelta,
        };
        calculatedModifiers.push(delta);
        modifierTotal += totalDelta;
      }

      const lineTotal = unitPriceMinor * quantity + modifierTotal;

      calculatedLines.push({
        menuItemId: variant.menuItem.id,
        variantId: variant.id,
        itemNameSnapshot: variant.menuItem.name,
        variantNameSnapshot: variant.name,
        skuSnapshot: variant.sku ?? variant.menuItem.sku,
        unitPriceMinor,
        quantity: input.quantity,
        lineTotalMinor: lineTotal,
        modifiers: calculatedModifiers,
      });

      subtotalMinor += lineTotal;
    }

    return { lines: calculatedLines, subtotalMinor };
  }
}
