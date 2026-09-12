import { Injectable, Inject, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class KitchensService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async listKitchens(tenantId: string, branchId: string) {
    const kitchens = await this.prisma.kitchen.findMany({
      where: { tenantId, branchId, isActive: true },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        stations: {
          where: { isActive: true },
          select: { id: true, name: true, isExpo: true },
          orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });

    return kitchens.map((k) => ({
      id: k.id,
      name: k.name,
      description: k.description,
      collectionLabel: k.collectionLabel,
      displayOrder: k.displayOrder,
      isActive: k.isActive,
      createdAt: k.createdAt,
      stationCount: k.stations.length,
      stations: k.stations.map((s) => ({
        id: s.id,
        name: s.name,
        isExpo: s.isExpo,
      })),
    }));
  }

  async createKitchen(params: {
    tenantId: string;
    branchId: string;
    name: string;
    description?: string;
    collectionLabel?: string;
    displayOrder?: number;
    actorUserId: string;
  }) {
    const { tenantId, branchId, name, description, collectionLabel, displayOrder, actorUserId } = params;

    const existing = await this.prisma.kitchen.findFirst({
      where: { tenantId, branchId, name },
    });
    if (existing) {
      throw new ConflictException(`Kitchen with name "${name}" already exists in this branch`);
    }

    const kitchen = await this.prisma.$transaction(async (tx) => {
      const k = await tx.kitchen.create({
        data: {
          tenantId,
          branchId,
          name,
          description: description ?? null,
          collectionLabel: collectionLabel ?? null,
          displayOrder: displayOrder ?? 0,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          tenantId,
          branchId,
          action: 'KITCHEN_CREATE',
          entityType: 'Kitchen',
          entityId: k.id,
          afterJson: { name, description, collectionLabel, displayOrder: displayOrder ?? 0 },
        },
      });

      return k;
    });

    return this.serializeKitchen(kitchen);
  }

  async updateKitchen(params: {
    tenantId: string;
    branchId: string;
    kitchenId: string;
    name?: string;
    description?: string | null;
    collectionLabel?: string | null;
    displayOrder?: number;
    isActive?: boolean;
    actorUserId: string;
  }) {
    const { tenantId, branchId, kitchenId, name, description, collectionLabel, displayOrder, isActive, actorUserId } = params;

    const existing = await this.prisma.kitchen.findFirst({
      where: { id: kitchenId, tenantId, branchId },
    });
    if (!existing) throw new NotFoundException('Kitchen not found');

    // Check name uniqueness if renaming
    if (name && name !== existing.name) {
      const duplicate = await this.prisma.kitchen.findFirst({
        where: { tenantId, branchId, name, id: { not: kitchenId } },
      });
      if (duplicate) {
        throw new ConflictException(`Kitchen with name "${name}" already exists in this branch`);
      }
    }

    // Cannot deactivate kitchen with active stations
    if (isActive === false) {
      const activeStations = await this.prisma.kitchenStation.count({
        where: { kitchenId, isActive: true },
      });
      if (activeStations > 0) {
        throw new ConflictException('Cannot deactivate kitchen with active stations. Reassign or deactivate stations first.');
      }
    }

    const kitchen = await this.prisma.$transaction(async (tx) => {
      const k = await tx.kitchen.update({
        where: { id: kitchenId },
        data: {
          ...(name !== undefined && { name }),
          ...(description !== undefined && { description }),
          ...(collectionLabel !== undefined && { collectionLabel }),
          ...(displayOrder !== undefined && { displayOrder }),
          ...(isActive !== undefined && { isActive }),
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          tenantId,
          branchId,
          action: 'KITCHEN_UPDATE',
          entityType: 'Kitchen',
          entityId: kitchenId,
          beforeJson: existing,
          afterJson: k,
        },
      });

      return k;
    });

    return this.serializeKitchen(kitchen);
  }

  async deleteKitchen(params: {
    tenantId: string;
    branchId: string;
    kitchenId: string;
    actorUserId: string;
  }) {
    const { tenantId, branchId, kitchenId, actorUserId } = params;

    const existing = await this.prisma.kitchen.findFirst({
      where: { id: kitchenId, tenantId, branchId },
    });
    if (!existing) throw new NotFoundException('Kitchen not found');

    // Cannot delete kitchen with active stations
    const activeStations = await this.prisma.kitchenStation.count({
      where: { kitchenId, isActive: true },
    });
    if (activeStations > 0) {
      throw new ConflictException('Cannot delete kitchen with active stations. Reassign or deactivate stations first.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.kitchen.update({
        where: { id: kitchenId },
        data: { isActive: false },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          tenantId,
          branchId,
          action: 'KITCHEN_DELETE',
          entityType: 'Kitchen',
          entityId: kitchenId,
          beforeJson: existing,
          afterJson: { isActive: false },
        },
      });
    });

    return { deleted: true };
  }

  private serializeKitchen(kitchen: any) {
    return {
      id: kitchen.id,
      name: kitchen.name,
      description: kitchen.description,
      collectionLabel: kitchen.collectionLabel,
      displayOrder: kitchen.displayOrder,
      isActive: kitchen.isActive,
      createdAt: kitchen.createdAt,
    };
  }
}
