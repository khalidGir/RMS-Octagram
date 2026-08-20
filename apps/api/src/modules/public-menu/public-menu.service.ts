import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';
import { normalizeTimeValue, localTimeInTimezone, isWithinTimeWindow } from '../shared/time.utils';

/** Convert BigInt values to strings for JSON serialization */
function serializePrice(value: bigint | number | null): string | null {
  if (value === null || value === undefined) return null;
  return BigInt(value).toString();
}

export interface PublicBranchMenu {
  tenant: { id: string; name: string };
  branch: { id: string; name: string };
  categories: Array<{
    id: string;
    name: string;
    items: Array<{
      id: string;
      name: string;
      description: string | null;
      sku: string | null;
      variants: Array<{
        id: string;
        name: string;
        priceMinor: string;
        sku: string | null;
        isDefault: boolean;
      }>;
      modifierGroups: Array<{
        id: string;
        name: string;
        isRequired: boolean;
        minSelections: number;
        maxSelections: number | null;
        options: Array<{
          id: string;
          name: string;
          priceDeltaMinor: string;
        }>;
      }>;
    }>;
  }>;
}

export interface PublicTableContext {
  tenant: { id: string; name: string };
  branch: { id: string; name: string };
  table: { id: string; label: string; capacity: number };
  diningArea: { id: string; name: string };
}

@Injectable()
export class PublicMenuService {
  constructor(private readonly prisma: PrismaService) {}

  async getBranchMenu(branchId: string, tenantId: string): Promise<PublicBranchMenu> {
    const tenant = await this.prisma.tenant.findFirst({ where: { id: tenantId, status: 'ACTIVE' } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, tenantId, isActive: true } });
    if (!branch) throw new NotFoundException('Branch not found');

    // Get available items for this branch
    const branchItems = await this.prisma.branchMenuItem.findMany({
      where: { branchId, tenantId, isAvailable: true },
      include: {
        menuItem: {
          include: {
            variants: { where: { isActive: true }, orderBy: { isDefault: 'desc' } },
            category: { select: { id: true, name: true, sortOrder: true, isActive: true } },
            modifierGroups: {
              include: {
                modifierGroup: {
                  include: { options: { where: { isActive: true } } },
                },
              },
              orderBy: { sortOrder: 'asc' },
            },
          },
        },
      },
    });

    // Current time in the branch's configured timezone (e.g. Africa/Addis_Ababa = UTC+3)
    const branchTimezone = branch.timezone || 'Africa/Addis_Ababa';
    const currentTime = localTimeInTimezone(branchTimezone);

    // Group by category
    const categoryMap = new Map<string, { id: string; name: string; sortOrder: number; items: any[] }>();

    for (const bm of branchItems) {
      const item = bm.menuItem;
      if (!item || !item.isActive || item.deletedAt) continue;

      // Filter by availability window
      if (bm.availableFrom && bm.availableUntil) {
        const from = normalizeTimeValue(bm.availableFrom);
        const until = normalizeTimeValue(bm.availableUntil);
        if (from && until && !isWithinTimeWindow(currentTime, from, until)) {
          continue;
        }
      }

      const cat = item.category;
      // Skip inactive categories
      if (!cat || !cat.isActive) continue;

      const catKey = cat.id;

      if (!categoryMap.has(catKey)) {
        categoryMap.set(catKey, {
          id: cat.id,
          name: cat.name,
          sortOrder: cat.sortOrder,
          items: [],
        });
      }

      // Branch price override only applies to the default variant; other variants keep base prices
      const defaultVariant = item.variants.find(v => v.isDefault);
      const displayVariants = item.variants.map(v => {
        const isDefaultOverride = bm.priceOverrideMinor != null && v.id === defaultVariant?.id;
        return {
          id: v.id,
          name: v.name,
          priceMinor: serializePrice(isDefaultOverride ? bm.priceOverrideMinor : v.basePriceMinor),
          sku: v.sku,
          isDefault: v.isDefault,
        };
      });

      categoryMap.get(catKey)!.items.push({
        id: item.id,
        name: item.name,
        description: item.description,
        sku: item.sku,
        variants: displayVariants,
        modifierGroups: item.modifierGroups.map(mg => ({
          id: mg.modifierGroup.id,
          name: mg.modifierGroup.name,
          isRequired: mg.modifierGroup.isRequired,
          minSelections: mg.modifierGroup.minSelections,
          maxSelections: mg.modifierGroup.maxSelections,
          options: mg.modifierGroup.options.map(o => ({
            id: o.id,
            name: o.name,
            priceDeltaMinor: serializePrice(o.priceDeltaMinor),
          })),
        })),
      });
    }

    const categories = Array.from(categoryMap.values())
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(c => ({ id: c.id, name: c.name, items: c.items }));

    return {
      tenant: { id: tenant.id, name: tenant.name },
      branch: { id: branch.id, name: branch.name },
      categories,
    };
  }

  async resolveTableContext(token: string, tenantId: string): Promise<PublicTableContext> {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const qrToken = await this.prisma.tableQrToken.findUnique({
      where: { tokenHash },
      include: {
        table: {
          include: {
            diningArea: { select: { id: true, name: true } },
            branch: { select: { id: true, name: true, isActive: true } },
          },
        },
      },
    });

    if (!qrToken) throw new NotFoundException('Invalid QR token');
    if (qrToken.revokedAt) throw new ForbiddenException('QR token has been revoked');
    if (qrToken.expiresAt && qrToken.expiresAt < new Date()) throw new ForbiddenException('QR token has expired');
    if (qrToken.tenantId !== tenantId) throw new ForbiddenException('QR token does not belong to this tenant');
    if (!qrToken.table.branch.isActive) throw new ForbiddenException('Branch is inactive');

    const tenant = await this.prisma.tenant.findFirst({ where: { id: tenantId, status: 'ACTIVE' } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    return {
      tenant: { id: tenant.id, name: tenant.name },
      branch: { id: qrToken.table.branch.id, name: qrToken.table.branch.name },
      table: { id: qrToken.table.id, label: qrToken.table.label, capacity: qrToken.table.capacity },
      diningArea: qrToken.table.diningArea
        ? { id: qrToken.table.diningArea.id, name: qrToken.table.diningArea.name }
        : { id: '', name: 'Unassigned' },
    };
  }
}
