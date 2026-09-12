import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RoutesService } from './routes.service';

function mockPrisma(overrides: Record<string, any> = {}) {
  const hasKey = (key: string) => key in overrides;
  const mock = {
    menuItemStation: {
      findMany: vi.fn().mockResolvedValue(hasKey('routes') ? overrides.routes : []),
      findUnique: vi.fn().mockResolvedValue(hasKey('existingRoute') ? overrides.existingRoute : null),
      create: vi.fn().mockResolvedValue(hasKey('createdRoute') ? overrides.createdRoute : {}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      delete: vi.fn().mockResolvedValue({}),
    },
    kitchenStation: {
      findFirst: vi.fn().mockResolvedValue(hasKey('validStation') ? overrides.validStation : { id: 's-1', name: 'Grill', isActive: true }),
      findMany: vi.fn().mockResolvedValue(hasKey('validStations') ? overrides.validStations : [{ id: 's-1' }]),
    },
    menuItem: {
      findFirst: vi.fn().mockResolvedValue(hasKey('validMenuItem') ? overrides.validMenuItem : { id: 'mi-1', name: 'Burger', isActive: true, deletedAt: null }),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn().mockImplementation(async (fn: any) => fn(mock)),
  } as any;
  return mock;
}

describe('RoutesService', () => {
  let service: RoutesService;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listRoutes', () => {
    it('returns serialized routes', async () => {
      const prisma = mockPrisma({
        routes: [
          {
            menuItemId: 'mi-1', stationId: 's-1', routeType: 'PREPARE', isRequired: true, sortOrder: 0, createdAt: new Date(),
            station: { id: 's-1', name: 'Grill', code: 'GRILL', kitchenId: 'k-1', isExpo: false },
            menuItem: { id: 'mi-1', name: 'Burger' },
          },
        ],
      });
      service = new RoutesService(prisma);

      const result = await service.listRoutes({ tenantId: 't1', branchId: 'b1' });

      expect(result).toHaveLength(1);
      expect(result[0].menuItemName).toBe('Burger');
      expect(result[0].stationName).toBe('Grill');
      expect(result[0].routeType).toBe('PREPARE');
    });

    it('filters by menuItemId', async () => {
      const prisma = mockPrisma({ routes: [] });
      service = new RoutesService(prisma);

      await service.listRoutes({ tenantId: 't1', branchId: 'b1', menuItemId: 'mi-1' });

      expect(prisma.menuItemStation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ menuItemId: 'mi-1' }),
        }),
      );
    });
  });

  describe('createRoute', () => {
    it('creates a route with audit log', async () => {
      const prisma = mockPrisma();
      prisma.menuItemStation.findUnique.mockResolvedValue(null);
      prisma.menuItemStation.create.mockResolvedValue({
        menuItemId: 'mi-1', stationId: 's-1', routeType: 'PREPARE', isRequired: true, sortOrder: 0, createdAt: new Date(),
        station: { id: 's-1', name: 'Grill', code: null, kitchenId: 'k-1', isExpo: false },
        menuItem: { id: 'mi-1', name: 'Burger' },
      });
      service = new RoutesService(prisma);

      const result = await service.createRoute({
        tenantId: 't1', branchId: 'b1', menuItemId: 'mi-1', stationId: 's-1', actorUserId: 'u1',
      });

      expect(result.assigned).toBe(true);
      expect(result.idempotent).toBe(false);
      expect(prisma.auditLog.create).toHaveBeenCalled();
    });

    it('returns idempotent if route already exists', async () => {
      const prisma = mockPrisma({
        existingRoute: { menuItemId: 'mi-1', stationId: 's-1', routeType: 'PREPARE' },
      });
      service = new RoutesService(prisma);

      const result = await service.createRoute({
        tenantId: 't1', branchId: 'b1', menuItemId: 'mi-1', stationId: 's-1', actorUserId: 'u1',
      });

      expect(result.idempotent).toBe(true);
      expect(prisma.menuItemStation.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException if station not found', async () => {
      const prisma = mockPrisma({ validStation: null });
      service = new RoutesService(prisma);

      await expect(
        service.createRoute({ tenantId: 't1', branchId: 'b1', menuItemId: 'mi-1', stationId: 'missing', actorUserId: 'u1' }),
      ).rejects.toThrow('not found');
    });

    it('throws NotFoundException if menu item not found', async () => {
      const prisma = mockPrisma({ validMenuItem: null });
      service = new RoutesService(prisma);

      await expect(
        service.createRoute({ tenantId: 't1', branchId: 'b1', menuItemId: 'missing', stationId: 's-1', actorUserId: 'u1' }),
      ).rejects.toThrow('not found');
    });

    it('throws ConflictException for invalid route type', async () => {
      const prisma = mockPrisma();
      service = new RoutesService(prisma);

      await expect(
        service.createRoute({ tenantId: 't1', branchId: 'b1', menuItemId: 'mi-1', stationId: 's-1', routeType: 'INVALID', actorUserId: 'u1' }),
      ).rejects.toThrow('PREPARE or ASSEMBLE');
    });
  });

  describe('replaceRoutes', () => {
    it('atomically replaces routes', async () => {
      const prisma = mockPrisma();
      prisma.menuItemStation.deleteMany.mockResolvedValue({ count: 2 });
      prisma.menuItemStation.create.mockResolvedValue({
        menuItemId: 'mi-1', stationId: 's-1', routeType: 'PREPARE', isRequired: true, sortOrder: 0, createdAt: new Date(),
        station: { id: 's-1', name: 'Grill', code: null, kitchenId: 'k-1', isExpo: false },
        menuItem: { id: 'mi-1', name: 'Burger' },
      });
      service = new RoutesService(prisma);

      const result = await service.replaceRoutes({
        tenantId: 't1', branchId: 'b1', menuItemId: 'mi-1',
        routes: [{ stationId: 's-1', routeType: 'PREPARE' }],
        actorUserId: 'u1',
      });

      expect(result.replaced).toBe(true);
      expect(prisma.menuItemStation.deleteMany).toHaveBeenCalled();
      expect(prisma.menuItemStation.create).toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalled();
    });

    it('throws NotFoundException if menu item not found', async () => {
      const prisma = mockPrisma({ validMenuItem: null });
      service = new RoutesService(prisma);

      await expect(
        service.replaceRoutes({ tenantId: 't1', branchId: 'b1', menuItemId: 'missing', routes: [], actorUserId: 'u1' }),
      ).rejects.toThrow('not found');
    });
  });

  describe('deleteRoute', () => {
    it('deletes a route with audit log', async () => {
      const prisma = mockPrisma({
        existingRoute: { menuItemId: 'mi-1', stationId: 's-1', routeType: 'PREPARE' },
      });
      service = new RoutesService(prisma);

      const result = await service.deleteRoute({
        tenantId: 't1', branchId: 'b1', menuItemId: 'mi-1', stationId: 's-1', routeType: 'PREPARE', actorUserId: 'u1',
      });

      expect(result.deleted).toBe(true);
      expect(prisma.menuItemStation.delete).toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalled();
    });

    it('throws NotFoundException if route not found', async () => {
      const prisma = mockPrisma({ existingRoute: null });
      service = new RoutesService(prisma);

      await expect(
        service.deleteRoute({ tenantId: 't1', branchId: 'b1', menuItemId: 'mi-1', stationId: 's-1', routeType: 'PREPARE', actorUserId: 'u1' }),
      ).rejects.toThrow('not found');
    });
  });
});
