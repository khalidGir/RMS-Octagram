import { Injectable, BadRequestException } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PrismaService } from '../prisma/prisma.service';
import { KITCHEN_ROUTING_ERRORS } from '@rms/contracts';

export interface RouteSnapshot {
  stationId: string;
  stationName: string;
  stationCode: string | null;
  kitchenId: string | null;
  kitchenName: string | null;
  routeType: string;
  isRequired: boolean;
  sortOrder: number;
}

export interface RoutedLine {
  orderLineId: string;
  quantity: number;
  routeType: string;
  isRequired: boolean;
  menuItemId: string | null;
  itemNameSnapshot: string | null;
  variantNameSnapshot: string | null;
  notesSnapshot: string | null;
}

export interface StationRouteGroup {
  stationId: string;
  kitchenId: string | null;
  ticketType: string;
  collectionLabelSnapshot: string | null;
  routes: RouteSnapshot[];
  ticketLines: RoutedLine[];
}

@Injectable()
export class KitchenRoutingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve all order lines to their station routes.
   *
   * Station type enforcement (P0):
   * - Normal stations (isExpo=false): only PREPARE routes → ticket type PREPARATION
   * - Expo stations (isExpo=true): only ASSEMBLE routes → ticket type EXPO
   * - Mixed route types on the same station are rejected
   *
   * For each order line:
   * 1. Look up all active MenuItemStation assignments
   * 2. Validate route-type/station-type consistency
   * 3. Each route becomes a RoutedLine on its station group
   *
   * Returns station groups sorted by station displayOrder.
   * Does NOT create tickets — that's the caller's responsibility.
   */
  async resolveOrderRoutes(params: {
    tenantId: string;
    branchId: string;
    orderId: string;
  }): Promise<StationRouteGroup[]> {
    const { tenantId, branchId, orderId } = params;

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId, branchId },
      include: {
        lines: {
          select: {
            id: true,
            menuItemId: true,
            quantity: true,
            itemNameSnapshot: true,
            variantNameSnapshot: true,
            notes: true,
          },
        },
      },
    });
    if (!order) throw new BadRequestException('Order not found');

    // Fetch all active stations for this branch (for snapshots + isExpo check)
    const stations = await this.prisma.kitchenStation.findMany({
      where: { tenantId, branchId, isActive: true },
      include: { kitchen: { select: { id: true, name: true, collectionLabel: true } } },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
    type StationWithKitchen = (typeof stations)[number];
    const stationMap = new Map<string, StationWithKitchen>(stations.map((s: StationWithKitchen) => [s.id, s]));

    // Group station routes: stationId -> RouteSnapshot[]
    const stationRoutes = new Map<string, RouteSnapshot[]>();

    // Track which orderLineIds have routes at each station
    const stationLineIds = new Map<string, Set<string>>();

    // Track per-line isRequired at each station: lineId -> stationId -> isRequired
    // Since each station now has exactly one route type, there's no overwrite concern.
    const lineIsRequired = new Map<string, Map<string, boolean>>();

    // Track lines that need routing validation
    const unrouteableLines: string[] = [];

    // Track lines that have no PREPARE route
    const noPrepareRouteLines: string[] = [];

    // Track invalid route-type/station-type assignments
    const invalidRouteAssignments: { menuItemId: string; stationId: string; routeType: string; isExpo: boolean }[] = [];

    for (const line of order.lines) {
      if (!line.menuItemId) continue;

      const assignments = await this.prisma.menuItemStation.findMany({
        where: {
          tenantId,
          branchId,
          menuItemId: line.menuItemId,
          station: { isActive: true, kitchen: { isActive: true } },
        },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      });

      if (assignments.length === 0) {
        unrouteableLines.push(line.id);
        continue;
      }

      // P0: At least one active PREPARE route is required (on a normal station)
      const hasPrepare = assignments.some((a) => a.routeType === 'PREPARE');
      if (!hasPrepare) {
        noPrepareRouteLines.push(line.id);
      }

      for (const assignment of assignments) {
        const station = stationMap.get(assignment.stationId);
        if (!station) continue;

        // P0: Validate route-type/station-type consistency
        if (station.isExpo && assignment.routeType !== 'ASSEMBLE') {
          invalidRouteAssignments.push({
            menuItemId: line.menuItemId,
            stationId: station.id,
            routeType: assignment.routeType,
            isExpo: true,
          });
          continue;
        }
        if (!station.isExpo && assignment.routeType !== 'PREPARE') {
          invalidRouteAssignments.push({
            menuItemId: line.menuItemId,
            stationId: station.id,
            routeType: assignment.routeType,
            isExpo: false,
          });
          continue;
        }

        const snapshot: RouteSnapshot = {
          stationId: station.id,
          stationName: station.name,
          stationCode: station.code,
          kitchenId: station.kitchenId,
          kitchenName: station.kitchen?.name ?? null,
          routeType: assignment.routeType,
          isRequired: assignment.isRequired,
          sortOrder: assignment.sortOrder,
        };

        const existing = stationRoutes.get(assignment.stationId) ?? [];
        existing.push(snapshot);
        stationRoutes.set(assignment.stationId, existing);

        const lineIds = stationLineIds.get(assignment.stationId) ?? new Set();
        lineIds.add(line.id);
        stationLineIds.set(assignment.stationId, lineIds);

        // Track isRequired per line/station (each station has one route type, no overwrite)
        const stationReq = lineIsRequired.get(line.id) ?? new Map<string, boolean>();
        stationReq.set(assignment.stationId, assignment.isRequired);
        lineIsRequired.set(line.id, stationReq);
      }
    }

    if (invalidRouteAssignments.length > 0) {
      throw new BadRequestException({
        code: 'INVALID_ROUTE_STATION_ASSIGNMENT',
        message: `${invalidRouteAssignments.length} route assignment(s) violate station type: PREPARE requires normal station, ASSEMBLE requires expo station`,
        details: invalidRouteAssignments,
      });
    }

    if (unrouteableLines.length > 0) {
      throw new BadRequestException({
        code: KITCHEN_ROUTING_ERRORS.MENU_ITEM_ROUTE_MISSING,
        message: `${unrouteableLines.length} item(s) have no active kitchen route`,
        orderLineIds: unrouteableLines,
      });
    }

    if (noPrepareRouteLines.length > 0) {
      throw new BadRequestException({
        code: KITCHEN_ROUTING_ERRORS.MENU_ITEM_ROUTE_MISSING,
        message: `${noPrepareRouteLines.length} item(s) have no active PREPARE route (every item requires at least one preparation station)`,
        orderLineIds: noPrepareRouteLines,
      });
    }

    // Build station route groups with ticket lines
    const groups: StationRouteGroup[] = [];

    for (const [stationId, routes] of stationRoutes) {
      const station = stationMap.get(stationId);
      if (!station) continue;

      const ticketLines: RoutedLine[] = [];

      for (const line of order.lines) {
        if (!line.menuItemId) continue;

        // Check if this line has a route on this station
        const lineIds = stationLineIds.get(stationId);
        if (!lineIds?.has(line.id)) continue;

        // Each station has exactly one route type — one ticket line per order line per station
        const isRequired = lineIsRequired.get(line.id)?.get(stationId) ?? true;

        ticketLines.push({
          orderLineId: line.id,
          quantity: line.quantity,
          routeType: routes[0].routeType,
          isRequired,
          menuItemId: line.menuItemId,
          itemNameSnapshot: line.itemNameSnapshot,
          variantNameSnapshot: line.variantNameSnapshot,
          notesSnapshot: line.notes,
        });
      }

      // P0: Ticket type determined by station type (enforced above: each station has one route type)
      const ticketType = station.isExpo ? 'EXPO' : 'PREPARATION';

      // Use station's collectionLabelOverride if set, else kitchen's collection label
      const collectionLabelSnapshot = station.collectionLabelOverride ?? station.kitchen?.collectionLabel ?? null;

      groups.push({
        stationId,
        kitchenId: station.kitchenId,
        ticketType,
        collectionLabelSnapshot,
        routes,
        ticketLines,
      });
    }

    // Sort by station displayOrder
    groups.sort((a, b) => {
      const sa = stationMap.get(a.stationId);
      const sb = stationMap.get(b.stationId);
      return (sa?.displayOrder ?? 0) - (sb?.displayOrder ?? 0);
    });

    return groups;
  }

  /**
   * Validate that a single order line has an active route.
   * Returns the routes if found, throws if not.
   */
  async validateLineRoute(params: {
    tenantId: string;
    branchId: string;
    menuItemId: string;
  }): Promise<RouteSnapshot[]> {
    const { tenantId, branchId, menuItemId } = params;

    const assignments = await this.prisma.menuItemStation.findMany({
      where: {
        tenantId,
        branchId,
        menuItemId,
        station: { isActive: true, kitchen: { isActive: true } },
      },
      include: {
        station: {
          select: {
            id: true,
            name: true,
            code: true,
            kitchenId: true,
            isExpo: true,
            kitchen: { select: { id: true, name: true, collectionLabel: true } },
          },
        },
      },
    });

    if (assignments.length === 0) {
      throw new BadRequestException({
        code: KITCHEN_ROUTING_ERRORS.MENU_ITEM_ROUTE_MISSING,
        message: `Menu item ${menuItemId} has no active kitchen route`,
      });
    }

    return assignments.map((a: (typeof assignments)[number]) => ({
      stationId: a.station.id,
      stationName: a.station.name,
      stationCode: a.station.code,
      kitchenId: a.station.kitchenId,
      kitchenName: a.station.kitchen?.name ?? null,
      routeType: a.routeType,
      isRequired: a.isRequired,
      sortOrder: a.sortOrder,
    }));
  }
}
