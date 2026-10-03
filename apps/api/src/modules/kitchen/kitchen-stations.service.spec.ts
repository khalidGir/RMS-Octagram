import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KitchenStationsService } from './kitchen-stations.service';

function createMockPrisma() {
  return {
    kitchen: {
      findFirst: vi.fn(),
    },
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

function p2002Error(target?: unknown) {
  const err = new Error('Unique constraint') as Error & { code?: string; meta?: { target?: unknown } };
  err.code = 'P2002';
  if (target !== undefined) err.meta = { target };
  return err;
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
      prisma.kitchen.findFirst.mockResolvedValue({ id: 'k1' });
      const station = {
        id: 's1', name: 'Grill', kitchenId: 'k1', code: 'GRILL',
        defaultPrepMinutes: 10, isExpo: false, collectionLabelOverride: null,
        displayOrder: 0, isActive: true, createdAt: new Date(),
      };
      const tx = createMockPrisma();
      tx.kitchenStation.create.mockResolvedValue(station);
      prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));

      const result = await service.createStation({
        tenantId: 't1',
        branchId: 'b1',
        kitchenId: 'k1',
        name: 'Grill',
        code: 'GRILL',
        defaultPrepMinutes: 10,
        isExpo: false,
        actorUserId: 'u1',
      });

      expect(result.name).toBe('Grill');
      expect(result.kitchenId).toBe('k1');
      expect(result.code).toBe('GRILL');
      expect(tx.kitchenStation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tenantId: 't1', branchId: 'b1', kitchenId: 'k1', code: 'GRILL' }),
        }),
      );
      expect(tx.auditLog.create).toHaveBeenCalled();
    });

    it('should persist expo flag and collection label override', async () => {
      prisma.kitchen.findFirst.mockResolvedValue({ id: 'k1' });
      const tx = createMockPrisma();
      tx.kitchenStation.create.mockResolvedValue({
        id: 's2', name: 'Expo', kitchenId: 'k1', code: 'EXPO',
        defaultPrepMinutes: 0, isExpo: true, collectionLabelOverride: 'Pass 2',
        displayOrder: 0, isActive: true, createdAt: new Date(),
      });
      prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));

      const result = await service.createStation({
        tenantId: 't1',
        branchId: 'b1',
        kitchenId: 'k1',
        name: 'Expo',
        code: 'EXPO',
        defaultPrepMinutes: 0,
        isExpo: true,
        collectionLabelOverride: 'Pass 2',
        actorUserId: 'u1',
      });

      expect(result.isExpo).toBe(true);
      expect(result.collectionLabelOverride).toBe('Pass 2');
      expect(tx.kitchenStation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isExpo: true, collectionLabelOverride: 'Pass 2', defaultPrepMinutes: 0 }),
        }),
      );
    });

    it('should reject a kitchen outside the tenant or branch', async () => {
      prisma.kitchen.findFirst.mockResolvedValue(null);

      await expect(
        service.createStation({
          tenantId: 't1', branchId: 'b1', kitchenId: 'other-tenant-kitchen',
          name: 'Grill', actorUserId: 'u1',
        }),
      ).rejects.toThrow('Kitchen not found');

      expect(prisma.kitchen.findFirst).toHaveBeenCalledWith({
        where: { id: 'other-tenant-kitchen', tenantId: 't1', branchId: 'b1' },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should map a duplicate station code to a conflict', async () => {
      prisma.kitchen.findFirst.mockResolvedValue({ id: 'k1' });
      const tx = createMockPrisma();
      tx.kitchenStation.create.mockRejectedValue(p2002Error(['branchId', 'code']));
      prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));

      await expect(
        service.createStation({
          tenantId: 't1', branchId: 'b1', kitchenId: 'k1',
          name: 'Grill', code: 'GRILL', actorUserId: 'u1',
        }),
      ).rejects.toThrow('Station code already exists in this branch');
    });

    it('should map an expo uniqueness violation to a conflict', async () => {
      prisma.kitchen.findFirst.mockResolvedValue({ id: 'k1' });
      const tx = createMockPrisma();
      tx.kitchenStation.create.mockRejectedValue(p2002Error('KitchenStation_oneExpoPerBranch_idx'));
      prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));

      await expect(
        service.createStation({
          tenantId: 't1', branchId: 'b1', kitchenId: 'k1',
          name: 'Expo', isExpo: true, actorUserId: 'u1',
        }),
      ).rejects.toThrow('Only one active expo station is allowed per branch');
    });

    it('should rethrow non-uniqueness errors unchanged', async () => {
      prisma.kitchen.findFirst.mockResolvedValue({ id: 'k1' });
      const tx = createMockPrisma();
      tx.kitchenStation.create.mockRejectedValue(new Error('connection reset'));
      prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));

      await expect(
        service.createStation({
          tenantId: 't1', branchId: 'b1', kitchenId: 'k1', name: 'Grill', actorUserId: 'u1',
        }),
      ).rejects.toThrow('connection reset');
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

    it('should filter by kitchenId when provided', async () => {
      prisma.kitchenStation.findMany.mockResolvedValue([]);

      await service.listStations('t1', 'b1', 'k-bar');

      expect(prisma.kitchenStation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: 't1', branchId: 'b1', isActive: true, kitchenId: 'k-bar' }),
        }),
      );
    });

    it('should omit the kitchen filter when no kitchenId is provided', async () => {
      prisma.kitchenStation.findMany.mockResolvedValue([]);

      await service.listStations('t1', 'b1');

      const where = prisma.kitchenStation.findMany.mock.calls[0][0].where;
      expect(where).not.toHaveProperty('kitchenId');
    });
  });

  describe('updateStation', () => {
    const existing = {
      id: 's1', tenantId: 't1', branchId: 'b1', kitchenId: 'k1',
      name: 'Grill', code: 'OLD', defaultPrepMinutes: 5, isExpo: false,
      collectionLabelOverride: null, displayOrder: 0, isActive: true,
    };

    it('should apply code, prep, expo, and collection fields with audit', async () => {
      prisma.kitchenStation.findFirst.mockResolvedValue(existing);
      const tx = createMockPrisma();
      tx.kitchenStation.update.mockResolvedValue({
        ...existing, code: 'GRILL', defaultPrepMinutes: 12, isExpo: true,
        collectionLabelOverride: 'Pass 1',
      });
      prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));

      const result = await service.updateStation({
        tenantId: 't1', branchId: 'b1', stationId: 's1',
        code: 'GRILL', defaultPrepMinutes: 12, isExpo: true,
        collectionLabelOverride: 'Pass 1',
        actorUserId: 'u1',
      });

      expect(tx.kitchenStation.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: {
          code: 'GRILL',
          defaultPrepMinutes: 12,
          isExpo: true,
          collectionLabelOverride: 'Pass 1',
        },
      });
      expect(result.code).toBe('GRILL');
      expect(result.isExpo).toBe(true);
      expect(tx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            beforeJson: expect.objectContaining({ code: 'OLD', isExpo: false }),
            afterJson: expect.objectContaining({ code: 'GRILL', isExpo: true }),
          }),
        }),
      );
    });

    it('should map a duplicate station code to a conflict', async () => {
      prisma.kitchenStation.findFirst.mockResolvedValue(existing);
      const tx = createMockPrisma();
      tx.kitchenStation.update.mockRejectedValue(p2002Error(['branchId', 'code']));
      prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));

      await expect(
        service.updateStation({
          tenantId: 't1', branchId: 'b1', stationId: 's1', code: 'DUP', actorUserId: 'u1',
        }),
      ).rejects.toThrow('Station code already exists in this branch');
    });

    it('should throw NotFoundException for unknown station', async () => {
      prisma.kitchenStation.findFirst.mockResolvedValue(null);

      await expect(
        service.updateStation({ tenantId: 't1', branchId: 'b1', stationId: 'bad', actorUserId: 'u1' }),
      ).rejects.toThrow('Station not found');
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
