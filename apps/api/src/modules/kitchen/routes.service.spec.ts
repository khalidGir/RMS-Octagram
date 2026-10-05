import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RoutesService } from './routes.service';

function mockPrisma(overrides: Record<string, any> = {}) {
  const hasKey = (key: string) => key in overrides;
  const mock = {
    menuItemStation: {
      findMany: vi.fn().mockResolvedValue(hasKey('routes') ? overrides.routes : []),
      findUnique: vi.fn().mockResolvedValue(hasKey('existingRoute') ? overrides.existingRoute : null),
      findFirst: vi.fn().mockImplementation((args?: any) => {
        // Delete-safety check (NOT clause present) — must be checked FIRST
        // because it also matches routeType+isRequired
        if (args?.where?.NOT) {
          return Promise.resolve(
            hasKey('deleteSafeRemaining')
              ? overrides.deleteSafeRemaining
              : { id: 'route-other' },
          );
        }
        // When called for required-prepare assertion, return override or null
        if (args?.where?.routeType === 'PREPARE' && args?.where?.isRequired === true) {
          return Promise.resolve(
            hasKey('requiredPrepare')
              ? overrides.requiredPrepare
              : { id: 'route-req', menuItemId: args.where.menuItemId, stationId: 's-1', routeType: 'PREPARE', isRequired: true },
          );
        }
        // Default: station lookup
        return Promise.resolve(
          hasKey('validStation')
            ? overrides.validStation
            : { id: 's-1', name: 'Grill', code: 'GRILL', isActive: true, isExpo: false },
        );
      }),
      create: vi.fn().mockResolvedValue(hasKey('createdRoute') ? overrides.createdRoute : {}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      delete: vi.fn().mockResolvedValue({}),
    },
    kitchenStation: {
      findFirst: vi.fn().mockResolvedValue(
        hasKey('validStation')
          ? overrides.validStation
          : { id: 's-1', name: 'Grill', code: 'GRILL', isActive: true, isExpo: false },
      ),
      findMany: vi.fn().mockResolvedValue(
        hasKey('validStations')
          ? overrides.validStations
          : [{ id: 's-1', name: 'Grill', isExpo: false }],
      ),
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

    it('rejects PREPARE route on expo station at config time', async () => {
      const prisma = mockPrisma({
        validStation: { id: 's-expo', name: 'Expo', code: 'EXPO', isActive: true, isExpo: true },
      });
      service = new RoutesService(prisma);

      await expect(
        service.createRoute({ tenantId: 't1', branchId: 'b1', menuItemId: 'mi-1', stationId: 's-expo', routeType: 'PREPARE', actorUserId: 'u1' }),
      ).rejects.toThrow('only accepts ASSEMBLE routes');
    });

    it('rejects ASSEMBLE route on normal station at config time', async () => {
      const prisma = mockPrisma({
        validStation: { id: 's-1', name: 'Grill', code: 'GRILL', isActive: true, isExpo: false },
      });
      service = new RoutesService(prisma);

      await expect(
        service.createRoute({ tenantId: 't1', branchId: 'b1', menuItemId: 'mi-1', stationId: 's-1', routeType: 'ASSEMBLE', actorUserId: 'u1' }),
      ).rejects.toThrow('only accepts PREPARE routes');
    });

    it('allows ASSEMBLE route on expo station', async () => {
      const prisma = mockPrisma({
        validStation: { id: 's-expo', name: 'Expo', code: 'EXPO', isActive: true, isExpo: true },
        requiredPrepare: { id: 'existing-prepare', menuItemId: 'mi-1', stationId: 's-1', routeType: 'PREPARE', isRequired: true },
      });
      prisma.menuItemStation.findUnique.mockResolvedValue(null);
      prisma.menuItemStation.create.mockResolvedValue({
        menuItemId: 'mi-1', stationId: 's-expo', routeType: 'ASSEMBLE', isRequired: true, sortOrder: 0, createdAt: new Date(),
        station: { id: 's-expo', name: 'Expo', code: 'EXPO', kitchenId: 'k-1', isExpo: true },
        menuItem: { id: 'mi-1', name: 'Burger' },
      });
      service = new RoutesService(prisma);

      const result = await service.createRoute({
        tenantId: 't1', branchId: 'b1', menuItemId: 'mi-1', stationId: 's-expo', routeType: 'ASSEMBLE', actorUserId: 'u1',
      });

      expect(result.assigned).toBe(true);
    });

    it('allows PREPARE route on normal station (default)', async () => {
      const prisma = mockPrisma();
      prisma.menuItemStation.findUnique.mockResolvedValue(null);
      prisma.menuItemStation.create.mockResolvedValue({
        menuItemId: 'mi-1', stationId: 's-1', routeType: 'PREPARE', isRequired: true, sortOrder: 0, createdAt: new Date(),
        station: { id: 's-1', name: 'Grill', code: 'GRILL', kitchenId: 'k-1', isExpo: false },
        menuItem: { id: 'mi-1', name: 'Burger' },
      });
      service = new RoutesService(prisma);

      const result = await service.createRoute({
        tenantId: 't1', branchId: 'b1', menuItemId: 'mi-1', stationId: 's-1', actorUserId: 'u1',
      });

      expect(result.assigned).toBe(true);
    });

    it('rejects when no required PREPARE route exists after creation (atomic rollback)', async () => {
      const prisma = mockPrisma({
        validStation: { id: 's-expo', name: 'Expo', code: 'EXPO', isActive: true, isExpo: true },
        requiredPrepare: null,
      });
      prisma.menuItemStation.findUnique.mockResolvedValue(null);
      prisma.menuItemStation.create.mockResolvedValue({
        menuItemId: 'mi-1', stationId: 's-expo', routeType: 'ASSEMBLE', isRequired: true, sortOrder: 0, createdAt: new Date(),
        station: { id: 's-expo', name: 'Expo', code: 'EXPO', kitchenId: 'k-1', isExpo: true },
        menuItem: { id: 'mi-1', name: 'Burger' },
      });
      service = new RoutesService(prisma);

      await expect(
        service.createRoute({ tenantId: 't1', branchId: 'b1', menuItemId: 'mi-1', stationId: 's-expo', routeType: 'ASSEMBLE', actorUserId: 'u1' }),
      ).rejects.toThrow('at least one required PREPARE route');

      // Verify the transaction was attempted (and rolled back by the assertion)
      expect(prisma.menuItemStation.create).toHaveBeenCalled();
      // The DB should remain unchanged — the create was inside a rolled-back transaction
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

    it('rejects PREPARE on expo station during replace', async () => {
      const prisma = mockPrisma({
        validStations: [{ id: 's-expo', name: 'Expo', isExpo: true }],
      });
      service = new RoutesService(prisma);

      await expect(
        service.replaceRoutes({
          tenantId: 't1', branchId: 'b1', menuItemId: 'mi-1',
          routes: [{ stationId: 's-expo', routeType: 'PREPARE' }],
          actorUserId: 'u1',
        }),
      ).rejects.toThrow('only accepts ASSEMBLE routes');

      // Verify no DB writes happened
      expect(prisma.menuItemStation.deleteMany).not.toHaveBeenCalled();
      expect(prisma.menuItemStation.create).not.toHaveBeenCalled();
    });

    it('rejects ASSEMBLE on normal station during replace', async () => {
      const prisma = mockPrisma({
        validStations: [{ id: 's-1', name: 'Grill', isExpo: false }],
      });
      service = new RoutesService(prisma);

      await expect(
        service.replaceRoutes({
          tenantId: 't1', branchId: 'b1', menuItemId: 'mi-1',
          routes: [{ stationId: 's-1', routeType: 'ASSEMBLE' }],
          actorUserId: 'u1',
        }),
      ).rejects.toThrow('only accepts PREPARE routes');

      // Verify no DB writes happened
      expect(prisma.menuItemStation.deleteMany).not.toHaveBeenCalled();
      expect(prisma.menuItemStation.create).not.toHaveBeenCalled();
    });

    it('rejects when result leaves no required PREPARE route (pre-write validation)', async () => {
      const prisma = mockPrisma({
        validStations: [{ id: 's-expo', name: 'Expo', isExpo: true }],
      });
      service = new RoutesService(prisma);

      await expect(
        service.replaceRoutes({
          tenantId: 't1', branchId: 'b1', menuItemId: 'mi-1',
          routes: [{ stationId: 's-expo', routeType: 'ASSEMBLE' }],
          actorUserId: 'u1',
        }),
      ).rejects.toThrow('at least one required PREPARE route');

      // Verify no DB writes happened — pre-write validation prevents any delete/create
      expect(prisma.menuItemStation.deleteMany).not.toHaveBeenCalled();
      expect(prisma.menuItemStation.create).not.toHaveBeenCalled();
    });
  });

  describe('deleteRoute', () => {
    it('deletes a route with audit log', async () => {
      const prisma = mockPrisma({
        existingRoute: { menuItemId: 'mi-1', stationId: 's-1', routeType: 'PREPARE', isRequired: true },
      });
      // There's another required PREPARE route remaining
      prisma.menuItemStation.findFirst.mockImplementation((args?: any) => {
        if (args?.where?.NOT) return Promise.resolve({ id: 'route-other' });
        return Promise.resolve({ id: 's-1', name: 'Grill', code: 'GRILL', isActive: true, isExpo: false });
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

    it('prevents deleting the last required PREPARE route', async () => {
      const prisma = mockPrisma({
        existingRoute: { menuItemId: 'mi-1', stationId: 's-1', routeType: 'PREPARE', isRequired: true },
        deleteSafeRemaining: null,
      });
      service = new RoutesService(prisma);

      await expect(
        service.deleteRoute({ tenantId: 't1', branchId: 'b1', menuItemId: 'mi-1', stationId: 's-1', routeType: 'PREPARE', actorUserId: 'u1' }),
      ).rejects.toThrow('last required PREPARE route');

      // Verify no DB writes happened
      expect(prisma.menuItemStation.delete).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('allows deleting a non-required route even if it is the only PREPARE', async () => {
      const prisma = mockPrisma({
        existingRoute: { menuItemId: 'mi-1', stationId: 's-1', routeType: 'PREPARE', isRequired: false },
      });
      service = new RoutesService(prisma);

      const result = await service.deleteRoute({
        tenantId: 't1', branchId: 'b1', menuItemId: 'mi-1', stationId: 's-1', routeType: 'PREPARE', actorUserId: 'u1',
      });

      expect(result.deleted).toBe(true);
    });

    it('allows deleting an ASSEMBLE route without PREPARE check', async () => {
      const prisma = mockPrisma({
        existingRoute: { menuItemId: 'mi-1', stationId: 's-expo', routeType: 'ASSEMBLE', isRequired: true },
      });
      service = new RoutesService(prisma);

      const result = await service.deleteRoute({
        tenantId: 't1', branchId: 'b1', menuItemId: 'mi-1', stationId: 's-expo', routeType: 'ASSEMBLE', actorUserId: 'u1',
      });

      expect(result.deleted).toBe(true);
    });
  });
});
