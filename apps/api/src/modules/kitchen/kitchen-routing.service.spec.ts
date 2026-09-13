import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KitchenRoutingService } from './kitchen-routing.service';

function mockPrisma(overrides: Record<string, any> = {}) {
  return {
    order: {
      findFirst: vi.fn().mockResolvedValue(overrides.order ?? null),
    },
    kitchenStation: {
      findMany: vi.fn().mockResolvedValue(overrides.stations ?? []),
    },
    menuItemStation: {
      findMany: vi.fn().mockResolvedValue(overrides.assignments ?? []),
    },
  } as any;
}

describe('KitchenRoutingService', () => {
  let service: KitchenRoutingService;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('resolveOrderRoutes', () => {
    it('throws MENU_ITEM_ROUTE_MISSING when items have no station assignment', async () => {
      const prisma = mockPrisma({
        order: {
          id: 'order-1',
          branchId: 'branch-1',
          lines: [
            { id: 'line-1', menuItemId: 'item-1', quantity: 2, itemNameSnapshot: null, variantNameSnapshot: null, notes: null },
          ],
        },
        stations: [{ id: 'station-1', name: 'Grill', code: 'GRILL', kitchenId: 'k-1', kitchen: { id: 'k-1', name: 'Main', collectionLabel: null }, isActive: true }],
        assignments: [],
      });

      service = new KitchenRoutingService(prisma);

      await expect(
        service.resolveOrderRoutes({ tenantId: 't1', branchId: 'branch-1', orderId: 'order-1' }),
      ).rejects.toThrow(expect.objectContaining({ message: expect.stringContaining('no active kitchen route') }));
    });

    it('groups lines by station with correct routeType', async () => {
      const prisma = mockPrisma({
        order: {
          id: 'order-1',
          branchId: 'branch-1',
          lines: [
            { id: 'line-1', menuItemId: 'item-1', quantity: 2, itemNameSnapshot: 'Burger', variantNameSnapshot: null, notes: null },
            { id: 'line-2', menuItemId: 'item-2', quantity: 1, itemNameSnapshot: 'Fries', variantNameSnapshot: null, notes: null },
          ],
        },
        stations: [
          { id: 's-grill', name: 'Grill', code: 'GRILL', kitchenId: 'k-main', kitchen: { id: 'k-main', name: 'Main Kitchen', collectionLabel: 'Pass' }, isActive: true },
          { id: 's-drinks', name: 'Drinks', code: 'DRINKS', kitchenId: 'k-bar', kitchen: { id: 'k-bar', name: 'Bar', collectionLabel: 'Bar counter' }, isActive: true },
        ],
        assignments: [
          { stationId: 's-grill', menuItemId: 'item-1', routeType: 'PREPARE', isRequired: true, sortOrder: 0 },
          { stationId: 's-drinks', menuItemId: 'item-2', routeType: 'PREPARE', isRequired: true, sortOrder: 0 },
        ],
      });

      // Prisma mock returns all assignments regardless of where clause —
      // use mockResolvedValueOnce to return per-line results
      prisma.menuItemStation.findMany
        .mockResolvedValueOnce([{ stationId: 's-grill', menuItemId: 'item-1', routeType: 'PREPARE', isRequired: true, sortOrder: 0 }])
        .mockResolvedValueOnce([{ stationId: 's-drinks', menuItemId: 'item-2', routeType: 'PREPARE', isRequired: true, sortOrder: 0 }]);

      service = new KitchenRoutingService(prisma);
      const groups = await service.resolveOrderRoutes({ tenantId: 't1', branchId: 'branch-1', orderId: 'order-1' });

      expect(groups).toHaveLength(2);
      expect(groups[0].stationId).toBe('s-grill');
      expect(groups[0].ticketLines).toHaveLength(1);
      expect(groups[0].ticketLines[0].quantity).toBe(2);
      expect(groups[0].ticketLines[0].routeType).toBe('PREPARE');
      expect(groups[0].kitchenId).toBe('k-main');
      expect(groups[0].ticketType).toBe('PREPARATION');

      expect(groups[1].stationId).toBe('s-drinks');
      expect(groups[1].ticketLines[0].quantity).toBe(1);
    });

    it('snapshots station and kitchen names in route data', async () => {
      const prisma = mockPrisma({
        order: {
          id: 'order-1',
          branchId: 'branch-1',
          lines: [
            { id: 'line-1', menuItemId: 'item-1', quantity: 1, itemNameSnapshot: null, variantNameSnapshot: null, notes: null },
          ],
        },
        stations: [
          { id: 's-1', name: 'Grill Station', code: 'GRILL', kitchenId: 'k-1', kitchen: { id: 'k-1', name: 'Main Kitchen', collectionLabel: 'Pass window' }, isActive: true },
        ],
        assignments: [
          { stationId: 's-1', menuItemId: 'item-1', routeType: 'PREPARE', isRequired: true, sortOrder: 0 },
        ],
      });

      prisma.menuItemStation.findMany.mockResolvedValueOnce([{ stationId: 's-1', menuItemId: 'item-1', routeType: 'PREPARE', isRequired: true, sortOrder: 0 }]);

      service = new KitchenRoutingService(prisma);
      const groups = await service.resolveOrderRoutes({ tenantId: 't1', branchId: 'branch-1', orderId: 'order-1' });

      expect(groups[0].collectionLabelSnapshot).toBe('Pass window');
      expect(groups[0].routes[0].stationName).toBe('Grill Station');
      expect(groups[0].routes[0].stationCode).toBe('GRILL');
      expect(groups[0].routes[0].kitchenName).toBe('Main Kitchen');
    });

    it('supports PREPARE and ASSEMBLE routes on same item/station', async () => {
      const prisma = mockPrisma({
        order: {
          id: 'order-1',
          branchId: 'branch-1',
          lines: [
            { id: 'line-1', menuItemId: 'item-1', quantity: 3, itemNameSnapshot: null, variantNameSnapshot: null, notes: null },
          ],
        },
        stations: [
          { id: 's-1', name: 'Kitchen', code: null, kitchenId: 'k-1', kitchen: { id: 'k-1', name: 'Main', collectionLabel: null }, isActive: true },
        ],
        assignments: [
          { stationId: 's-1', menuItemId: 'item-1', routeType: 'PREPARE', isRequired: true, sortOrder: 0 },
          { stationId: 's-1', menuItemId: 'item-1', routeType: 'ASSEMBLE', isRequired: true, sortOrder: 1 },
        ],
      });

      prisma.menuItemStation.findMany.mockResolvedValueOnce([
        { stationId: 's-1', menuItemId: 'item-1', routeType: 'PREPARE', isRequired: true, sortOrder: 0 },
        { stationId: 's-1', menuItemId: 'item-1', routeType: 'ASSEMBLE', isRequired: true, sortOrder: 1 },
      ]);

      service = new KitchenRoutingService(prisma);
      const groups = await service.resolveOrderRoutes({ tenantId: 't1', branchId: 'branch-1', orderId: 'order-1' });

      // Both routes are on the same station — should produce one group with both routes
      expect(groups).toHaveLength(1);
      expect(groups[0].routes).toHaveLength(2);
      expect(groups[0].routes.map((r) => r.routeType)).toContain('PREPARE');
      expect(groups[0].routes.map((r) => r.routeType)).toContain('ASSEMBLE');
      // ASSEMBLE route present but not all routes are ASSEMBLE → PREPARATION
      expect(groups[0].ticketType).toBe('PREPARATION');
      // One ticket line per route type per order line (PREPARE + ASSEMBLE = 2)
      expect(groups[0].ticketLines).toHaveLength(2);
      expect(groups[0].ticketLines[0].quantity).toBe(3);
      expect(groups[0].ticketLines[1].quantity).toBe(3);
      expect(groups[0].ticketLines.map((l) => l.routeType)).toContain('PREPARE');
      expect(groups[0].ticketLines.map((l) => l.routeType)).toContain('ASSEMBLE');
    });

    it('returns empty array when order has no lines with menuItemId', async () => {
      const prisma = mockPrisma({
        order: {
          id: 'order-1',
          branchId: 'branch-1',
          lines: [
            { id: 'line-1', menuItemId: null, quantity: 1, itemNameSnapshot: null, variantNameSnapshot: null, notes: null },
          ],
        },
        stations: [],
        assignments: [],
      });

      service = new KitchenRoutingService(prisma);
      const groups = await service.resolveOrderRoutes({ tenantId: 't1', branchId: 'branch-1', orderId: 'order-1' });

      expect(groups).toEqual([]);
    });
  });

  describe('validateLineRoute', () => {
    it('throws MENU_ITEM_ROUTE_MISSING when no routes exist', async () => {
      const prisma = mockPrisma({ assignments: [] });
      service = new KitchenRoutingService(prisma);

      await expect(
        service.validateLineRoute({ tenantId: 't1', branchId: 'b1', menuItemId: 'item-1' }),
      ).rejects.toThrow();
    });

    it('returns routes when assignments exist', async () => {
      const prisma = mockPrisma({
        assignments: [
          {
            routeType: 'PREPARE',
            isRequired: true,
            sortOrder: 0,
            station: { id: 's-1', name: 'Grill', code: 'GRILL', kitchenId: 'k-1', kitchen: { id: 'k-1', name: 'Main', collectionLabel: null } },
          },
        ],
      });
      service = new KitchenRoutingService(prisma);

      const routes = await service.validateLineRoute({ tenantId: 't1', branchId: 'b1', menuItemId: 'item-1' });
      expect(routes).toHaveLength(1);
      expect(routes[0].stationName).toBe('Grill');
      expect(routes[0].routeType).toBe('PREPARE');
    });
  });
});
