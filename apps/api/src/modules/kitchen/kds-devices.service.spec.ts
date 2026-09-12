import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KdsDevicesService } from './kds-devices.service';

function mockPrisma(overrides: Record<string, any> = {}) {
  const hasKey = (key: string) => key in overrides;
  const mock = {
    kdsDevice: {
      findMany: vi.fn().mockResolvedValue(hasKey('devices') ? overrides.devices : []),
      findFirst: vi.fn().mockResolvedValue(hasKey('existingDevice') ? overrides.existingDevice : null),
      create: vi.fn().mockResolvedValue(hasKey('createdDevice') ? overrides.createdDevice : {
        id: 'd-1', name: 'KDS 1', branchId: 'b1', tenantId: 't1', isActive: true,
        deviceTokenHash: 'hash', lastSeenAt: null, createdByUserId: 'u1', createdAt: new Date(), updatedAt: new Date(),
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    kdsDeviceStation: {
      findUnique: vi.fn().mockResolvedValue(hasKey('existingAssignment') ? overrides.existingAssignment : null),
      create: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
    kitchenStation: {
      findFirst: vi.fn().mockResolvedValue(hasKey('validStation') ? overrides.validStation : { id: 's-1', name: 'Grill', isActive: true }),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn().mockImplementation(async (fn: any) => fn(mock)),
  } as any;
  return mock;
}

describe('KdsDevicesService', () => {
  let service: KdsDevicesService;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listDevices', () => {
    it('returns devices with station assignments', async () => {
      const prisma = mockPrisma({
        devices: [
          {
            id: 'd-1', name: 'KDS 1', isActive: true, lastSeenAt: null, createdByUserId: 'u1', createdAt: new Date(),
            stations: [{ stationId: 's-1', displayOrder: 0 }],
          },
        ],
      });
      service = new KdsDevicesService(prisma);

      const result = await service.listDevices({ tenantId: 't1', branchId: 'b1' });

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('KDS 1');
      expect(result[0].stationAssignments).toHaveLength(1);
    });
  });

  describe('registerDevice', () => {
    it('creates a device and returns plaintext token', async () => {
      const prisma = mockPrisma();
      prisma.kdsDevice.create.mockResolvedValue({
        id: 'd-1', name: 'KDS Screen 1', branchId: 'b1', tenantId: 't1', isActive: true,
        deviceTokenHash: 'hash', lastSeenAt: null, createdByUserId: 'u1', createdAt: new Date(), updatedAt: new Date(),
      });
      service = new KdsDevicesService(prisma);

      const result = await service.registerDevice({
        tenantId: 't1', branchId: 'b1', name: 'KDS Screen 1', actorUserId: 'u1',
      });

      expect(result.name).toBe('KDS Screen 1');
      expect(result.deviceToken).toBeDefined();
      expect(result.deviceToken.length).toBe(64); // 32 bytes hex
      expect(prisma.kdsDevice.create).toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalled();
    });
  });

  describe('updateDevice', () => {
    it('updates and writes audit log', async () => {
      const prisma = mockPrisma({
        existingDevice: { id: 'd-1', name: 'Old', tenantId: 't1', branchId: 'b1' },
      });
      service = new KdsDevicesService(prisma);

      await service.updateDevice({
        tenantId: 't1', branchId: 'b1', deviceId: 'd-1', name: 'New', actorUserId: 'u1',
      });

      expect(prisma.kdsDevice.update).toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalled();
    });

    it('throws NotFoundException if device not found', async () => {
      const prisma = mockPrisma({ existingDevice: null });
      service = new KdsDevicesService(prisma);

      await expect(
        service.updateDevice({ tenantId: 't1', branchId: 'b1', deviceId: 'missing', actorUserId: 'u1' }),
      ).rejects.toThrow('not found');
    });
  });

  describe('deleteDevice', () => {
    it('soft-deletes and writes audit log', async () => {
      const prisma = mockPrisma({
        existingDevice: { id: 'd-1', name: 'KDS', tenantId: 't1', branchId: 'b1' },
      });
      service = new KdsDevicesService(prisma);

      const result = await service.deleteDevice({
        tenantId: 't1', branchId: 'b1', deviceId: 'd-1', actorUserId: 'u1',
      });

      expect(result.deleted).toBe(true);
      expect(prisma.kdsDevice.update).toHaveBeenCalled();
    });
  });

  describe('assignStation', () => {
    it('creates assignment with audit log', async () => {
      const prisma = mockPrisma({
        existingDevice: { id: 'd-1', name: 'KDS', tenantId: 't1', branchId: 'b1', isActive: true },
        existingAssignment: null,
      });
      service = new KdsDevicesService(prisma);

      const result = await service.assignStation({
        tenantId: 't1', branchId: 'b1', deviceId: 'd-1', stationId: 's-1', actorUserId: 'u1',
      });

      expect(result.assigned).toBe(true);
      expect(result.idempotent).toBe(false);
    });

    it('returns idempotent if already assigned', async () => {
      const prisma = mockPrisma({
        existingDevice: { id: 'd-1', name: 'KDS', tenantId: 't1', branchId: 'b1', isActive: true },
        existingAssignment: { deviceId: 'd-1', stationId: 's-1' },
      });
      service = new KdsDevicesService(prisma);

      const result = await service.assignStation({
        tenantId: 't1', branchId: 'b1', deviceId: 'd-1', stationId: 's-1', actorUserId: 'u1',
      });

      expect(result.idempotent).toBe(true);
    });

    it('throws NotFoundException if device not found', async () => {
      const prisma = mockPrisma({ existingDevice: null });
      service = new KdsDevicesService(prisma);

      await expect(
        service.assignStation({ tenantId: 't1', branchId: 'b1', deviceId: 'missing', stationId: 's-1', actorUserId: 'u1' }),
      ).rejects.toThrow('not found');
    });
  });

  describe('removeStation', () => {
    it('removes assignment with audit log', async () => {
      const prisma = mockPrisma({ existingAssignment: { deviceId: 'd-1', stationId: 's-1' } });
      service = new KdsDevicesService(prisma);

      const result = await service.removeStation({
        tenantId: 't1', branchId: 'b1', deviceId: 'd-1', stationId: 's-1', actorUserId: 'u1',
      });

      expect(result.removed).toBe(true);
    });

    it('throws NotFoundException if assignment not found', async () => {
      const prisma = mockPrisma({ existingAssignment: null });
      service = new KdsDevicesService(prisma);

      await expect(
        service.removeStation({ tenantId: 't1', branchId: 'b1', deviceId: 'd-1', stationId: 's-1', actorUserId: 'u1' }),
      ).rejects.toThrow('not found');
    });
  });
});
