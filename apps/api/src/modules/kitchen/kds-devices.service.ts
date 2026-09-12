import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { randomBytes, createHash } from 'crypto';

@Injectable()
export class KdsDevicesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async listDevices(params: { tenantId: string; branchId: string }) {
    const { tenantId, branchId } = params;

    const devices = await this.prisma.kdsDevice.findMany({
      where: { tenantId, branchId, isActive: true },
      orderBy: [{ createdAt: 'asc' }],
      include: {
        stations: {
          select: { stationId: true, displayOrder: true },
          orderBy: { displayOrder: 'asc' },
        },
      },
    });

    return devices.map((d) => ({
      id: d.id,
      name: d.name,
      isActive: d.isActive,
      lastSeenAt: d.lastSeenAt,
      createdByUserId: d.createdByUserId,
      createdAt: d.createdAt,
      stationAssignments: d.stations.map((s) => ({
        stationId: s.stationId,
        displayOrder: s.displayOrder,
      })),
    }));
  }

  async registerDevice(params: {
    tenantId: string;
    branchId: string;
    name: string;
    actorUserId: string;
  }) {
    const { tenantId, branchId, name, actorUserId } = params;

    const deviceToken = randomBytes(32).toString('hex');
    const deviceTokenHash = createHash('sha256').update(deviceToken).digest('hex');

    const device = await this.prisma.$transaction(async (tx) => {
      const d = await tx.kdsDevice.create({
        data: {
          tenantId,
          branchId,
          name,
          deviceTokenHash,
          createdByUserId: actorUserId,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          tenantId,
          branchId,
          action: 'KDS_DEVICE_REGISTER',
          entityType: 'KdsDevice',
          entityId: d.id,
          afterJson: { name },
        },
      });

      return d;
    });

    return {
      id: device.id,
      name: device.name,
      deviceToken,
      createdAt: device.createdAt,
    };
  }

  async updateDevice(params: {
    tenantId: string;
    branchId: string;
    deviceId: string;
    name?: string;
    isActive?: boolean;
    actorUserId: string;
  }) {
    const { tenantId, branchId, deviceId, name, isActive, actorUserId } = params;

    const existing = await this.prisma.kdsDevice.findFirst({
      where: { id: deviceId, tenantId, branchId },
    });
    if (!existing) throw new NotFoundException('KDS device not found');

    const device = await this.prisma.$transaction(async (tx) => {
      const d = await tx.kdsDevice.update({
        where: { id: deviceId },
        data: {
          ...(name !== undefined && { name }),
          ...(isActive !== undefined && { isActive }),
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          tenantId,
          branchId,
          action: 'KDS_DEVICE_UPDATE',
          entityType: 'KdsDevice',
          entityId: deviceId,
          beforeJson: existing,
          afterJson: d,
        },
      });

      return d;
    });

    return {
      id: device.id,
      name: device.name,
      isActive: device.isActive,
      updatedAt: device.updatedAt,
    };
  }

  async deleteDevice(params: {
    tenantId: string;
    branchId: string;
    deviceId: string;
    actorUserId: string;
  }) {
    const { tenantId, branchId, deviceId, actorUserId } = params;

    const existing = await this.prisma.kdsDevice.findFirst({
      where: { id: deviceId, tenantId, branchId },
    });
    if (!existing) throw new NotFoundException('KDS device not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.kdsDevice.update({
        where: { id: deviceId },
        data: { isActive: false },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          tenantId,
          branchId,
          action: 'KDS_DEVICE_DELETE',
          entityType: 'KdsDevice',
          entityId: deviceId,
          beforeJson: existing,
          afterJson: { isActive: false },
        },
      });
    });

    return { deleted: true };
  }

  async assignStation(params: {
    tenantId: string;
    branchId: string;
    deviceId: string;
    stationId: string;
    displayOrder?: number;
    actorUserId: string;
  }) {
    const { tenantId, branchId, deviceId, stationId, displayOrder, actorUserId } = params;

    const device = await this.prisma.kdsDevice.findFirst({
      where: { id: deviceId, tenantId, branchId, isActive: true },
    });
    if (!device) throw new NotFoundException('KDS device not found or inactive');

    const station = await this.prisma.kitchenStation.findFirst({
      where: { id: stationId, tenantId, branchId, isActive: true },
    });
    if (!station) throw new NotFoundException('Kitchen station not found or inactive');

    const existing = await this.prisma.kdsDeviceStation.findUnique({
      where: { deviceId_stationId: { deviceId, stationId } },
    });
    if (existing) {
      return { assigned: true, idempotent: true };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.kdsDeviceStation.create({
        data: {
          tenantId,
          branchId,
          deviceId,
          stationId,
          displayOrder: displayOrder ?? 0,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          tenantId,
          branchId,
          action: 'KDS_DEVICE_STATION_ASSIGN',
          entityType: 'KdsDeviceStation',
          entityId: `${deviceId}:${stationId}`,
          afterJson: { stationId, displayOrder: displayOrder ?? 0 },
        },
      });
    });

    return { assigned: true, idempotent: false };
  }

  async removeStation(params: {
    tenantId: string;
    branchId: string;
    deviceId: string;
    stationId: string;
    actorUserId: string;
  }) {
    const { tenantId, branchId, deviceId, stationId, actorUserId } = params;

    const existing = await this.prisma.kdsDeviceStation.findUnique({
      where: { deviceId_stationId: { deviceId, stationId } },
    });
    if (!existing) throw new NotFoundException('Station assignment not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.kdsDeviceStation.delete({
        where: { deviceId_stationId: { deviceId, stationId } },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          tenantId,
          branchId,
          action: 'KDS_DEVICE_STATION_REMOVE',
          entityType: 'KdsDeviceStation',
          entityId: `${deviceId}:${stationId}`,
          beforeJson: existing,
        },
      });
    });

    return { removed: true };
  }

  async updateHeartbeat(params: { deviceId: string }) {
    await this.prisma.kdsDevice.update({
      where: { id: params.deviceId },
      data: { lastSeenAt: new Date() },
    });
  }
}
