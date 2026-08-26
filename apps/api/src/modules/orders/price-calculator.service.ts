import { Injectable, Inject, NotFoundException, ConflictException } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PrismaService } from '../prisma/prisma.service';
import { normalizeTimeValue, localTimeInTimezone, isWithinTimeWindow } from '../shared/time.utils';
import { RoundingMode } from '@rms/contracts';

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
  vatApplicable: boolean;
  vatRateBps: number; // basis points, e.g. 1500 = 15%
  vatMinor: bigint;
  serviceChargeMinor: bigint; // always zero — not configurable
  totalMinor: bigint;
  taxConfigVersionId: string | null;
  roundingMode: string | null; // RoundingMode enum value, null when VAT not applied
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
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async calculateCart(
    tenantId: string,
    branchId: string,
    lines: LineInput[],
  ): Promise<CartCalculation> {
    if (lines.length === 0) {
      return {
        lines: [],
        subtotalMinor: 0n,
        vatApplicable: false,
        vatRateBps: 0,
        vatMinor: 0n,
        serviceChargeMinor: 0n,
        totalMinor: 0n,
        taxConfigVersionId: null,
        roundingMode: null,
      };
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

    // 2. Load branch availability for all items + branch timezone
    const menuItemIds = [...new Set(variants.map((v) => v.menuItemId))];
    const [branchItems, branch] = await Promise.all([
      this.prisma.branchMenuItem.findMany({
        where: {
          branchId,
          menuItemId: { in: menuItemIds },
        },
      }),
      this.prisma.branch.findFirst({
        where: { id: branchId, tenantId },
        select: { timezone: true },
      }),
    ]);
    const branchItemMap = new Map(branchItems.map((bi) => [bi.menuItemId, bi]));
    const branchTimezone = branch?.timezone || 'Africa/Addis_Ababa';
    const currentTime = localTimeInTimezone(branchTimezone);

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

      // Branch time window check (using branch timezone, not UTC)
      if (branchItem?.availableFrom && branchItem?.availableUntil) {
        const from = normalizeTimeValue(branchItem.availableFrom);
        const until = normalizeTimeValue(branchItem.availableUntil);
        if (from && until && !isWithinTimeWindow(currentTime, from, until)) {
          throw new ConflictException(
            `Item "${variant.menuItem.name}" is only available from ${from} to ${until} (${branchTimezone})`,
          );
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

    // Resolve effective tax configuration (branch override > tenant default)
    const taxConfig = await this.resolveEffectiveTaxConfig(tenantId, branchId);

    // ─── VAT CALCULATION ────────────────────────────────────────────────
    // VAT rounding is an UNRESOLVED EXTERNAL DECISION (AGENTS.md pause condition).
    // Rounding mode comes from TenantTaxConfiguration.roundingMode (HALF_UP | DOWN).
    // The confirmation gate (confirmedBy required) prevents accidental activation.
    //
    // BigInt-safe arithmetic: the Prisma Decimal(9,6) vatRate is parsed from its
    // exact string representation into a BigInt numerator and integer scale.
    // VAT = subtotalMinor * numerator / 10^scale  (pure BigInt, no floating-point).
    // ─────────────────────────────────────────────────────────────────────
    const vatApplicable = taxConfig?.vatApplicable ?? false;
    const vatConfirmed = Boolean(taxConfig?.confirmedBy);
    const roundingMode: string | null = taxConfig?.roundingMode ?? null;

    // Parse Decimal(9,6) vatRate to exact BigInt numerator/scale.
    // "0.150000" → numerator=150000n, scale=6  (VAT = subtotal * 150000 / 10^6)
    // "0.151234" → numerator=151234n, scale=6  (preserves all 6 decimal places)
    let vatRateNumerator = 0n;
    let vatRateScale = 0;
    let vatRateBps = 0;

    if (taxConfig?.vatRate != null) {
      const rateStr = String(taxConfig.vatRate).trim();
      const dotIdx = rateStr.indexOf('.');
      if (dotIdx === -1) {
        vatRateNumerator = BigInt(rateStr);
        vatRateScale = 0;
      } else {
        const decPart = rateStr.slice(dotIdx + 1);
        vatRateNumerator = BigInt(rateStr.slice(0, dotIdx) + decPart);
        vatRateScale = decPart.length;
      }
      // Display-only: convert to basis points (truncates for >4 decimal places)
      const divisor = 10n ** BigInt(vatRateScale);
      vatRateBps = Number((vatRateNumerator * 10000n) / divisor);
    }

    let vatMinor = 0n;

    if (vatApplicable && vatRateNumerator > 0n && vatConfirmed) {
      if (!roundingMode) {
        throw new ConflictException(
          'Tax configuration is missing roundingMode. VAT cannot be calculated without a rounding policy.',
        );
      }

      const validModes = Object.values(RoundingMode);
      if (!validModes.includes(roundingMode as RoundingMode)) {
        throw new ConflictException(
          `Unsupported rounding mode "${roundingMode}". Supported modes: ${validModes.join(', ')}`,
        );
      }

      // Exact BigInt arithmetic: VAT = subtotalMinor * numerator / 10^scale
      // No Number conversion of subtotalMinor ever.
      const divisor = 10n ** BigInt(vatRateScale);
      const product = subtotalMinor * vatRateNumerator;

      if ((roundingMode as RoundingMode) === RoundingMode.HALF_UP) {
        // Add half of divisor before truncating division → rounds half up
        vatMinor = (product + divisor / 2n) / divisor;
      } else {
        // DOWN: BigInt integer division truncates toward zero (floor for positive values)
        vatMinor = product / divisor;
      }
    }

    // Service charge is always zero — not configurable
    const serviceChargeMinor = 0n;
    const totalMinor = subtotalMinor + vatMinor + serviceChargeMinor;

    // Snapshot roundingMode whenever a confirmed VAT config is applied,
    // even if the VAT calculation rounds to zero.
    const effectiveRoundingMode =
      vatApplicable && vatRateNumerator > 0n && vatConfirmed && roundingMode
        ? roundingMode
        : null;

    return {
      lines: calculatedLines,
      subtotalMinor,
      vatApplicable,
      vatRateBps,
      vatMinor,
      serviceChargeMinor,
      totalMinor,
      taxConfigVersionId: taxConfig?.id ?? null,
      roundingMode: effectiveRoundingMode,
    };
  }

  /**
   * Resolve the effective tax configuration for a tenant/branch.
   * Branch override takes precedence over tenant default.
   * Returns null if no configuration exists (VAT not applicable).
   */
  private async resolveEffectiveTaxConfig(tenantId: string, branchId: string) {
    // Try branch-specific config first
    const branchConfig = await this.prisma.tenantTaxConfiguration.findFirst({
      where: {
        tenantId,
        branchId,
        effectiveFrom: { lte: new Date() },
        OR: [
          { effectiveUntil: null },
          { effectiveUntil: { gt: new Date() } },
        ],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (branchConfig) return branchConfig;

    // Fall back to tenant default (branchId = null)
    return this.prisma.tenantTaxConfiguration.findFirst({
      where: {
        tenantId,
        branchId: null,
        effectiveFrom: { lte: new Date() },
        OR: [
          { effectiveUntil: null },
          { effectiveUntil: { gt: new Date() } },
        ],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
  }
}
