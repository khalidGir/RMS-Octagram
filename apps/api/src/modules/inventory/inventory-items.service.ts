import { Injectable, Inject, NotFoundException } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PrismaService } from '../prisma/prisma.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { FeatureResolver } from '../features/feature-resolver.service';
import { FeatureKey } from '@rms/contracts';
import { normalizeUnit, getUnitGroup } from './unit-conversion.util';

@Injectable()
export class InventoryItemsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FeatureResolver) private readonly featureResolver: FeatureResolver,
  ) {}

  async createItem(params: {
    tenantId: string;
    branchId: string;
    name: string;
    sku?: string;
    baseUnit: string;
    lowStockThreshold?: number;
    actorUserId: string;
  }) {
    const { tenantId, branchId, name, sku, baseUnit, lowStockThreshold, actorUserId } = params;

    await this.featureResolver.assertEffective(tenantId, FeatureKey.INVENTORY, branchId);

    getUnitGroup(baseUnit);

    const item = await this.prisma.$transaction(async (tx) => {
      const i = await tx.inventoryItem.create({
        data: {
          tenantId,
          branchId,
          name,
          sku: sku ?? null,
          baseUnit: normalizeUnit(baseUnit),
          lowStockThreshold: lowStockThreshold ?? 0,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          tenantId,
          branchId,
          action: 'INVENTORY_ITEM_CREATE',
          entityType: 'InventoryItem',
          entityId: i.id,
          afterJson: { name, sku, baseUnit: normalizeUnit(baseUnit), lowStockThreshold: lowStockThreshold ?? 0 },
        },
      });

      return i;
    });

    return this.serializeItem(item);
  }

  async listItems(params: {
    tenantId: string;
    branchId: string;
    isActive?: boolean;
    search?: string;
    limit?: number;
    after?: string;
  }) {
    const { tenantId, branchId, isActive, search, limit = 50, after } = params;

    await this.featureResolver.assertEffective(tenantId, FeatureKey.INVENTORY, branchId);

    const where: Record<string, unknown> = { tenantId, branchId };
    if (isActive !== undefined) where.isActive = isActive;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
      ];
    }

    const items = await this.prisma.inventoryItem.findMany({
      where,
      orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
      take: limit + 1,
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
    });

    let nextCursor: string | undefined;
    if (items.length > limit) {
      const last = items.pop()!;
      nextCursor = last.id;
    }

    return {
      items: items.map((i) => this.serializeItem(i)),
      nextCursor,
    };
  }

  async updateItem(params: {
    tenantId: string;
    branchId: string;
    itemId: string;
    name?: string;
    sku?: string;
    lowStockThreshold?: number;
    isActive?: boolean;
    actorUserId: string;
  }) {
    const { tenantId, branchId, itemId, name, sku, lowStockThreshold, isActive, actorUserId } = params;

    await this.featureResolver.assertEffective(tenantId, FeatureKey.INVENTORY, branchId);

    const existing = await this.prisma.inventoryItem.findFirst({
      where: { id: itemId, tenantId, branchId },
    });
    if (!existing) throw new NotFoundException('Inventory item not found');

    const updated = await this.prisma.$transaction(async (tx) => {
      const i = await tx.inventoryItem.update({
        where: { id: itemId },
        data: {
          ...(name !== undefined && { name }),
          ...(sku !== undefined && { sku }),
          ...(lowStockThreshold !== undefined && { lowStockThreshold }),
          ...(isActive !== undefined && { isActive }),
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          tenantId,
          branchId,
          action: 'INVENTORY_ITEM_UPDATE',
          entityType: 'InventoryItem',
          entityId: itemId,
          beforeJson: {
            name: existing.name,
            sku: existing.sku,
            lowStockThreshold: existing.lowStockThreshold,
            isActive: existing.isActive,
          },
          afterJson: {
            name: i.name,
            sku: i.sku,
            lowStockThreshold: i.lowStockThreshold,
            isActive: i.isActive,
          },
        },
      });

      return i;
    });

    return this.serializeItem(updated);
  }

  async getItemById(tenantId: string, branchId: string, itemId: string) {
    await this.featureResolver.assertEffective(tenantId, FeatureKey.INVENTORY, branchId);

    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: itemId, tenantId, branchId },
    });
    if (!item) throw new NotFoundException('Inventory item not found');

    return this.serializeItem(item);
  }

  async getLowStockAlerts(params: {
    tenantId: string;
    branchId: string;
    limit?: number;
  }) {
    const { tenantId, branchId, limit = 50 } = params;

    await this.featureResolver.assertEffective(tenantId, FeatureKey.INVENTORY, branchId);

    const items = await this.prisma.inventoryItem.findMany({
      where: { tenantId, branchId, isActive: true },
      include: {
        batches: {
          where: { remainingQuantity: { gt: 0 } },
          select: { remainingQuantity: true, unit: true },
        },
      },
    });

    const alerts: Array<{
      id: string;
      name: string;
      sku: string | null;
      baseUnit: string;
      lowStockThreshold: string;
      currentStock: number;
      isLow: boolean;
    }> = [];

    for (const item of items) {
      const totalStock = item.batches.reduce(
        (sum, b) => sum + Number(b.remainingQuantity),
        0,
      );
      const threshold = Number(item.lowStockThreshold);
      if (threshold > 0 && totalStock <= threshold) {
        alerts.push({
          id: item.id,
          name: item.name,
          sku: item.sku,
          baseUnit: item.baseUnit,
          lowStockThreshold: item.lowStockThreshold.toString(),
          currentStock: totalStock,
          isLow: totalStock <= threshold,
        });
      }
    }

    alerts.sort((a, b) => a.currentStock - b.currentStock);

    return { alerts: alerts.slice(0, limit) };
  }

  private serializeItem(item: Record<string, unknown>) {
    const i = item as any;
    return {
      id: i.id,
      tenantId: i.tenantId,
      branchId: i.branchId,
      name: i.name,
      sku: i.sku,
      baseUnit: i.baseUnit,
      lowStockThreshold: i.lowStockThreshold?.toString?.() ?? i.lowStockThreshold,
      isActive: i.isActive,
      createdAt: i.createdAt,
      updatedAt: i.updatedAt,
    };
  }
}
