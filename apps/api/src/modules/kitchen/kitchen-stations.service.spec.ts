import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KitchenStationsService } from './kitchen-stations.service';

function createMockPrisma() {
  return {
    kitchenStation: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    menuItem: {
      findFirst: vi.fn(),
    },
    menuItemStation: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
    },
    order: {
      findUnique: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(async (fn: any) => fn(createMockPrisma())),
  };
}

describe('KitchenStationsService', () => {
  let service: KitchenStationsService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new KitchenStationsService(prisma as any);
  });

  describe('createStation', () => {
    it('should create a station and audit', async () => {
      const station = { id: 's1', name: 'Grill', displayOrder: 0, isActive: true, createdAt: new Date() };
      const tx = createMockPrisma();
      tx.kitchenStation.create.mockResolvedValue(station);
      prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));

      const result = await service.createStation({
        tenantId: 't1',
        branchId: 'b1',
        name: 'Grill',
        actorUserId: 'u1',
      });

      expect(result.name).toBe('Grill');
      expect(tx.kitchenStation.create).toHaveBeenCalled();
      expect(tx.auditLog.create).toHaveBeenCalled();
    });
  });

  describe('listStations', () => {
    it('should list active stations with menu item IDs', async () => {
      prisma.kitchenStation.findMany.mockResolvedValue([
        {
          id: 's1', name: 'Grill', displayOrder: 0, isActive: true, createdAt: new Date(),
          menuItemAssignments: [{ menuItemId: 'mi1' }, { menuItemId: 'mi2' }],
        },
      ]);

      const result = await service.listStations('t1', 'b1');
      expect(result).toHaveLength(1);
      expect(result[0].menuItemIds).toEqual(['mi1', 'mi2']);
    });
  });

  describe('deleteStation', () => {
    it('should soft-delete a station', async () => {
      prisma.kitchenStation.findFirst.mockResolvedValue({ id: 's1', isActive: true });
      const tx = createMockPrisma();
      prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));

      const result = await service.deleteStation({
        tenantId: 't1', branchId: 'b1', stationId: 's1', actorUserId: 'u1',
      });

      expect(result.deleted).toBe(true);
      expect(tx.kitchenStation.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { isActive: false },
      });
    });

    it('should throw NotFoundException for unknown station', async () => {
      prisma.kitchenStation.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteStation({ tenantId: 't1', branchId: 'b1', stationId: 'bad', actorUserId: 'u1' }),
      ).rejects.toThrow('Station not found');
    });
  });

  describe('assignMenuItem', () => {
    it('should assign a menu item to a station', async () => {
      prisma.kitchenStation.findFirst.mockResolvedValue({ id: 's1', isActive: true });
      (prisma as any).menuItem.findFirst.mockResolvedValue({ id: 'mi1', isActive: true, deletedAt: null });
      prisma.menuItemStation.findUnique.mockResolvedValue(null);
      const tx = createMockPrisma();
      prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));

      const result = await service.assignMenuItem({
        tenantId: 't1', branchId: 'b1', stationId: 's1', menuItemId: 'mi1', actorUserId: 'u1',
      });

      expect(result.assigned).toBe(true);
      expect(result.idempotent).toBe(false);
    });

    it('should return idempotent if already assigned', async () => {
      prisma.kitchenStation.findFirst.mockResolvedValue({ id: 's1', isActive: true });
      (prisma as any).menuItem.findFirst.mockResolvedValue({ id: 'mi1', isActive: true, deletedAt: null });
      prisma.menuItemStation.findUnique.mockResolvedValue({ branchId: 'b1', menuItemId: 'mi1', stationId: 's1' });

      const result = await service.assignMenuItem({
        tenantId: 't1', branchId: 'b1', stationId: 's1', menuItemId: 'mi1', actorUserId: 'u1',
      });

      expect(result.idempotent).toBe(true);
    });
  });
});
