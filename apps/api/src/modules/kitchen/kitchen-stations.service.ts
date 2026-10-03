import { Injectable, Inject, ConflictException, NotFoundException } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class KitchenStationsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  // ─── CRUD ────────────────────────────────

  async createStation(params: {
    tenantId: string;
    branchId: string;
    kitchenId: string;
    name: string;
    code?: string;
    defaultPrepMinutes?: number;
    isExpo?: boolean;
    collectionLabelOverride?: string;
    displayOrder?: number;
    actorUserId: string;
  }) {
    const {
      tenantId, branchId, kitchenId, name, code,
      defaultPrepMinutes, isExpo, collectionLabelOverride, displayOrder, actorUserId,
    } = params;

    const kitchen = await this.prisma.kitchen.findFirst({
      where: { id: kitchenId, tenantId, branchId },
    });
    if (!kitchen) throw new NotFoundException('Kitchen not found');

    try {
      const station = await this.prisma.$transaction(async (tx) => {
        const s = await tx.kitchenStation.create({
          data: {
            tenantId,
            branchId,
            kitchenId,
            name,
            code: code ?? null,
            defaultPrepMinutes: defaultPrepMinutes ?? null,
            isExpo: isExpo ?? false,
            collectionLabelOverride: collectionLabelOverride ?? null,
            displayOrder: displayOrder ?? 0,
          },
        });

        await tx.auditLog.create({
          data: {
            actorUserId,
            tenantId,
            branchId,
            action: 'KITCHEN_STATION_CREATE',
            entityType: 'KitchenStation',
            entityId: s.id,
            afterJson: {
              name,
              kitchenId,
              code: code ?? null,
              defaultPrepMinutes: defaultPrepMinutes ?? null,
              isExpo: isExpo ?? false,
              collectionLabelOverride: collectionLabelOverride ?? null,
              displayOrder: displayOrder ?? 0,
            },
          },
        });

        return s;
      });

      return this.serializeStation(station);
    } catch (error) {
      this.rethrowStationConflict(error);
    }
  }

  async listStations(tenantId: string, branchId: string, kitchenId?: string) {
    const stations = await this.prisma.kitchenStation.findMany({
      where: {
        tenantId,
        branchId,
        isActive: true,
        ...(kitchenId && { kitchenId }),
      },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        menuItemAssignments: {
          select: { menuItemId: true },
        },
      },
    });

    return stations.map((s) => ({
      ...this.serializeStation(s),
      menuItemIds: s.menuItemAssignments.map((a) => a.menuItemId),
    }));
  }

  async updateStation(params: {
    tenantId: string;
    branchId: string;
    stationId: string;
    name?: string;
    code?: string;
    defaultPrepMinutes?: number;
    isExpo?: boolean;
    collectionLabelOverride?: string;
    displayOrder?: number;
    isActive?: boolean;
    actorUserId: string;
  }) {
    const {
      tenantId, branchId, stationId, name, code,
      defaultPrepMinutes, isExpo, collectionLabelOverride, displayOrder, isActive, actorUserId,
    } = params;

    const existing = await this.prisma.kitchenStation.findFirst({
      where: { id: stationId, tenantId, branchId },
    });
    if (!existing) throw new NotFoundException('Station not found');

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const s = await tx.kitchenStation.update({
          where: { id: stationId },
          data: {
            ...(name !== undefined && { name }),
            ...(code !== undefined && { code }),
            ...(defaultPrepMinutes !== undefined && { defaultPrepMinutes }),
            ...(isExpo !== undefined && { isExpo }),
            ...(collectionLabelOverride !== undefined && { collectionLabelOverride }),
            ...(displayOrder !== undefined && { displayOrder }),
            ...(isActive !== undefined && { isActive }),
          },
        });

        await tx.auditLog.create({
          data: {
            actorUserId,
            tenantId,
            branchId,
            action: 'KITCHEN_STATION_UPDATE',
            entityType: 'KitchenStation',
            entityId: stationId,
            beforeJson: {
              name: existing.name,
              code: existing.code,
              defaultPrepMinutes: existing.defaultPrepMinutes,
              isExpo: existing.isExpo,
              collectionLabelOverride: existing.collectionLabelOverride,
              displayOrder: existing.displayOrder,
              isActive: existing.isActive,
            },
            afterJson: {
              name: s.name,
              code: s.code,
              defaultPrepMinutes: s.defaultPrepMinutes,
              isExpo: s.isExpo,
              collectionLabelOverride: s.collectionLabelOverride,
              displayOrder: s.displayOrder,
              isActive: s.isActive,
            },
          },
        });

        return s;
      });

      return this.serializeStation(updated);
    } catch (error) {
      this.rethrowStationConflict(error);
    }
  }

  async deleteStation(params: {
    tenantId: string;
    branchId: string;
    stationId: string;
    actorUserId: string;
  }) {
    const { tenantId, branchId, stationId, actorUserId } = params;

    const existing = await this.prisma.kitchenStation.findFirst({
      where: { id: stationId, tenantId, branchId },
    });
    if (!existing) throw new NotFoundException('Station not found');

    // Soft-delete: set isActive = false
    await this.prisma.$transaction(async (tx) => {
      await tx.kitchenStation.update({
        where: { id: stationId },
        data: { isActive: false },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          tenantId,
          branchId,
          action: 'KITCHEN_STATION_DELETE',
          entityType: 'KitchenStation',
          entityId: stationId,
          beforeJson: { isActive: true },
          afterJson: { isActive: false },
        },
      });
    });

    return { deleted: true };
  }

  // ─── Menu Item ↔ Station Mapping ─────────

  async assignMenuItem(params: {
    tenantId: string;
    branchId: string;
    stationId: string;
    menuItemId: string;
    actorUserId: string;
  }) {
    const { tenantId, branchId, stationId, menuItemId, actorUserId } = params;

    const station = await this.prisma.kitchenStation.findFirst({
      where: { id: stationId, tenantId, branchId, isActive: true },
    });
    if (!station) throw new NotFoundException('Station not found');

    const menuItem = await this.prisma.menuItem.findFirst({
      where: { id: menuItemId, tenantId, isActive: true, deletedAt: null },
    });
    if (!menuItem) throw new NotFoundException('Menu item not found');

    // Check for existing assignment (idempotent)
    const existing = await this.prisma.menuItemStation.findUnique({
      where: { branchId_menuItemId_stationId_routeType: { branchId, menuItemId, stationId, routeType: 'PREPARE' } },
    });
    if (existing) return { assigned: true, idempotent: true };

    await this.prisma.$transaction(async (tx) => {
      await tx.menuItemStation.create({
        data: { tenantId, branchId, menuItemId, stationId, routeType: 'PREPARE' },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          tenantId,
          branchId,
          action: 'KITCHEN_STATION_MENU_ITEM_ASSIGN',
          entityType: 'MenuItemStation',
          entityId: `${branchId}:${menuItemId}:${stationId}`,
          afterJson: { stationId, menuItemId },
        },
      });
    });

    return { assigned: true, idempotent: false };
  }

  async removeMenuItemAssignment(params: {
    tenantId: string;
    branchId: string;
    stationId: string;
    menuItemId: string;
    actorUserId: string;
  }) {
    const { tenantId, branchId, stationId, menuItemId, actorUserId } = params;

    const existing = await this.prisma.menuItemStation.findUnique({
      where: { branchId_menuItemId_stationId_routeType: { branchId, menuItemId, stationId, routeType: 'PREPARE' } },
    });
    if (!existing) throw new NotFoundException('Assignment not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.menuItemStation.delete({
        where: { branchId_menuItemId_stationId_routeType: { branchId, menuItemId, stationId, routeType: 'PREPARE' } },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          tenantId,
          branchId,
          action: 'KITCHEN_STATION_MENU_ITEM_REMOVE',
          entityType: 'MenuItemStation',
          entityId: `${branchId}:${menuItemId}:${stationId}`,
          beforeJson: { stationId, menuItemId },
        },
      });
    });

    return { removed: true };
  }

  async getStationMenuItems(_tenantId: string, branchId: string, stationId: string) {
    const assignments = await this.prisma.menuItemStation.findMany({
      where: { branchId, stationId },
      select: { menuItemId: true },
    });
    return { menuItemIds: assignments.map((a) => a.menuItemId) };
  }

  // ─── Resolve stations for an order (used by ticket creation) ──

  async resolveOrderStations(orderId: string): Promise<
    { stationId: string; ticketLines: { orderLineId: string; quantity: number }[] }[]
  > {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { lines: { select: { id: true, menuItemId: true, quantity: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');

    const stationMap = new Map<string, { orderLineId: string; quantity: number }[]>();

    for (const line of order.lines) {
      if (!line.menuItemId) continue;
      const assignments = await this.prisma.menuItemStation.findMany({
        where: {
          branchId: order.branchId,
          menuItemId: line.menuItemId,
        },
      });

      if (assignments.length === 0) {
        // No station assigned — skip (or could use default station)
        continue;
      }

      // Use first assigned station for now
      const stationId = assignments[0].stationId;
      const existing = stationMap.get(stationId) ?? [];
      existing.push({ orderLineId: line.id, quantity: line.quantity });
      stationMap.set(stationId, existing);
    }

    return Array.from(stationMap.entries()).map(([stationId, ticketLines]) => ({
      stationId,
      ticketLines,
    }));
  }

  // ─── Helpers ──────────────────────────────

  private serializeStation(station: any) {
    return {
      id: station.id,
      name: station.name,
      kitchenId: station.kitchenId ?? null,
      code: station.code ?? null,
      defaultPrepMinutes: station.defaultPrepMinutes ?? null,
      isExpo: station.isExpo ?? false,
      collectionLabelOverride: station.collectionLabelOverride ?? null,
      displayOrder: station.displayOrder,
      isActive: station.isActive,
      createdAt: station.createdAt,
    };
  }

  private isP2002(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    );
  }

  // Station uniqueness: code unique per branch (@@unique([branchId, code])) and
  // one active expo station per branch (partial unique index from migration SQL).
  private rethrowStationConflict(error: unknown): never {
    if (this.isP2002(error)) {
      const meta = (error as { meta?: { target?: unknown } }).meta;
      const rawTarget = Array.isArray(meta?.target) ? meta.target.join(',') : String(meta?.target ?? '');
      if (rawTarget.includes('code')) {
        throw new ConflictException('Station code already exists in this branch');
      }
      throw new ConflictException('Only one active expo station is allowed per branch');
    }
    throw error;
  }
}
