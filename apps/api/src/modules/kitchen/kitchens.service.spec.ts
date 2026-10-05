import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KitchensService } from './kitchens.service';

function mockPrisma(overrides: Record<string, any> = {}) {
  const mock = {
    kitchen: {
      findMany: vi.fn().mockResolvedValue(overrides.kitchens ?? []),
      findFirst: vi.fn().mockResolvedValue(overrides.existingKitchen ?? null),
      create: vi.fn().mockResolvedValue(overrides.createdKitchen ?? { id: 'k-1', name: 'Created Kitchen', branchId: 'b1', tenantId: 't1', description: null, collectionLabel: null, displayOrder: 0, isActive: true, createdAt: new Date() }),
      update: vi.fn().mockResolvedValue(overrides.updatedKitchen ?? {}),
    },
    kitchenStation: {
      count: vi.fn().mockResolvedValue(overrides.activeStations ?? 0),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn().mockImplementation(async (fn: any) => fn(mock)),
  } as any;
  return mock;
}

describe('KitchensService', () => {
  let service: KitchensService;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listKitchens', () => {
    it('returns active kitchens with station counts', async () => {
      const prisma = mockPrisma({
        kitchens: [
          {
            id: 'k-1', name: 'Main Kitchen', description: null, collectionLabel: 'Pass', displayOrder: 0,
            isActive: true, createdAt: new Date(),
            stations: [{ id: 's-1', name: 'Grill', isExpo: false }],
          },
        ],
      });
      service = new KitchensService(prisma);
      const result = await service.listKitchens('t1', 'b1');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Main Kitchen');
      expect(result[0].stationCount).toBe(1);
      expect(result[0].stations[0].name).toBe('Grill');
    });
  });

  describe('createKitchen', () => {
    it('creates a kitchen with audit log', async () => {
      const prisma = mockPrisma();
      prisma.kitchen.findFirst.mockResolvedValue(null); // no duplicate
      service = new KitchensService(prisma);

      const result = await service.createKitchen({
        tenantId: 't1', branchId: 'b1', name: 'Main Kitchen', actorUserId: 'u1',
      });

      expect(result.name).toBe('Created Kitchen');
      expect(prisma.kitchen.create).toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalled();
    });

    it('throws ConflictException on duplicate name', async () => {
      const prisma = mockPrisma();
      prisma.kitchen.findFirst.mockResolvedValue({ id: 'k-1', name: 'Main Kitchen' });
      service = new KitchensService(prisma);

      await expect(
        service.createKitchen({ tenantId: 't1', branchId: 'b1', name: 'Main Kitchen', actorUserId: 'u1' }),
      ).rejects.toThrow('already exists');
    });
  });

  describe('updateKitchen', () => {
    it('updates and writes audit log', async () => {
      const prisma = mockPrisma();
      prisma.kitchen.findFirst
        .mockResolvedValueOnce({ id: 'k-1', name: 'Old Name', tenantId: 't1', branchId: 'b1' }) // existence check
        .mockResolvedValueOnce(null); // no duplicate name
      prisma.kitchen.update.mockResolvedValue({ id: 'k-1', name: 'New Name' });
      service = new KitchensService(prisma);

      await service.updateKitchen({
        tenantId: 't1', branchId: 'b1', kitchenId: 'k-1', name: 'New Name', actorUserId: 'u1',
      });

      expect(prisma.kitchen.update).toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalled();
    });

    it('throws NotFoundException if kitchen not found', async () => {
      const prisma = mockPrisma();
      prisma.kitchen.findFirst.mockResolvedValue(null);
      service = new KitchensService(prisma);

      await expect(
        service.updateKitchen({ tenantId: 't1', branchId: 'b1', kitchenId: 'missing', actorUserId: 'u1' }),
      ).rejects.toThrow('not found');
    });

    it('throws ConflictException on duplicate name', async () => {
      const prisma = mockPrisma();
      prisma.kitchen.findFirst
        .mockResolvedValueOnce({ id: 'k-1', name: 'Old', tenantId: 't1', branchId: 'b1' }) // existence check
        .mockResolvedValueOnce({ id: 'k-2', name: 'Taken' }); // duplicate check
      service = new KitchensService(prisma);

      await expect(
        service.updateKitchen({ tenantId: 't1', branchId: 'b1', kitchenId: 'k-1', name: 'Taken', actorUserId: 'u1' }),
      ).rejects.toThrow('already exists');
    });

    it('throws ConflictException when deactivating kitchen with active stations', async () => {
      const prisma = mockPrisma({ activeStations: 2 });
      prisma.kitchen.findFirst.mockResolvedValue({ id: 'k-1', name: 'Main', tenantId: 't1', branchId: 'b1' });
      service = new KitchensService(prisma);

      await expect(
        service.updateKitchen({ tenantId: 't1', branchId: 'b1', kitchenId: 'k-1', isActive: false, actorUserId: 'u1' }),
      ).rejects.toThrow('active stations');
    });
  });

  describe('deleteKitchen', () => {
    it('soft-deletes and writes audit log', async () => {
      const prisma = mockPrisma({
        existingKitchen: { id: 'k-1', name: 'Main', tenantId: 't1', branchId: 'b1' },
        activeStations: 0,
      });
      service = new KitchensService(prisma);

      const result = await service.deleteKitchen({
        tenantId: 't1', branchId: 'b1', kitchenId: 'k-1', actorUserId: 'u1',
      });

      expect(result.deleted).toBe(true);
      expect(prisma.kitchen.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }),
      );
      expect(prisma.auditLog.create).toHaveBeenCalled();
    });

    it('throws ConflictException when kitchen has active stations', async () => {
      const prisma = mockPrisma({
        existingKitchen: { id: 'k-1', name: 'Main', tenantId: 't1', branchId: 'b1' },
        activeStations: 3,
      });
      service = new KitchensService(prisma);

      await expect(
        service.deleteKitchen({ tenantId: 't1', branchId: 'b1', kitchenId: 'k-1', actorUserId: 'u1' }),
      ).rejects.toThrow('active stations');
    });
  });
});
