import { Injectable, Inject, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '@rms/database';

@Injectable()
export class RoutesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async listRoutes(params: {
    tenantId: string;
    branchId: string;
    menuItemId?: string;
    stationId?: string;
    routeType?: string;
  }) {
    const { tenantId, branchId, menuItemId, stationId, routeType } = params;

    const where: any = { tenantId, branchId };
    if (menuItemId) where.menuItemId = menuItemId;
    if (stationId) where.stationId = stationId;
    if (routeType) where.routeType = routeType;

    const routes = await this.prisma.menuItemStation.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        station: {
          select: { id: true, name: true, code: true, kitchenId: true, isExpo: true },
        },
        menuItem: {
          select: { id: true, name: true },
        },
      },
    });

    return routes.map((r) => this.serializeRoute(r));
  }

  async createRoute(params: {
    tenantId: string;
    branchId: string;
    menuItemId: string;
    stationId: string;
    routeType?: string;
    isRequired?: boolean;
    sortOrder?: number;
    actorUserId: string;
  }) {
    const { tenantId, branchId, menuItemId, stationId, routeType = 'PREPARE', isRequired = true, sortOrder = 0, actorUserId } = params;

    // Validate station exists and is active
    const station = await this.prisma.kitchenStation.findFirst({
      where: { id: stationId, tenantId, branchId, isActive: true },
    });
    if (!station) throw new NotFoundException('Station not found or inactive');

    // Validate menu item exists
    const menuItem = await this.prisma.menuItem.findFirst({
      where: { id: menuItemId, tenantId, isActive: true, deletedAt: null },
    });
    if (!menuItem) throw new NotFoundException('Menu item not found');

    // Validate route type
    if (routeType !== 'PREPARE' && routeType !== 'ASSEMBLE') {
      throw new ConflictException('routeType must be PREPARE or ASSEMBLE');
    }

    // Reject route-type/station-type mismatch at configuration time
    if (station.isExpo && routeType !== 'ASSEMBLE') {
      throw new ConflictException({
        code: 'INVALID_ROUTE_STATION_ASSIGNMENT',
        message: `Expo station "${station.name}" only accepts ASSEMBLE routes, got ${routeType}`,
      });
    }
    if (!station.isExpo && routeType !== 'PREPARE') {
      throw new ConflictException({
        code: 'INVALID_ROUTE_STATION_ASSIGNMENT',
        message: `Normal station "${station.name}" only accepts PREPARE routes, got ${routeType}`,
      });
    }

    // Check for duplicate
    const existing = await this.prisma.menuItemStation.findUnique({
      where: {
        branchId_menuItemId_stationId_routeType: {
          branchId,
          menuItemId,
          stationId,
          routeType,
        },
      },
    });
    if (existing) {
      return { assigned: true, idempotent: true, route: this.serializeRoute(existing) };
    }

    // Atomic: create route + assert required PREPARE exists, all inside one transaction
    const route = await this.prisma.$transaction(async (tx) => {
      const r = await tx.menuItemStation.create({
        data: {
          tenantId,
          branchId,
          menuItemId,
          stationId,
          routeType,
          isRequired,
          sortOrder,
        },
        include: {
          station: {
            select: { id: true, name: true, code: true, kitchenId: true, isExpo: true },
          },
          menuItem: {
            select: { id: true, name: true },
          },
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          tenantId,
          branchId,
          action: 'ROUTE_CREATE',
          entityType: 'MenuItemStation',
          entityId: `${branchId}:${menuItemId}:${stationId}:${routeType}`,
          afterJson: { menuItemId, stationId, routeType, isRequired, sortOrder },
        },
      });

      // Assert inside transaction so rollback undoes the write on failure
      await this.assertRequiredPrepareRouteExistsTx(tx, tenantId, branchId, menuItemId);

      return r;
    });

    return { assigned: true, idempotent: false, route: this.serializeRoute(route) };
  }

  async replaceRoutes(params: {
    tenantId: string;
    branchId: string;
    menuItemId: string;
    routes: {
      stationId: string;
      routeType?: string;
      isRequired?: boolean;
      sortOrder?: number;
    }[];
    actorUserId: string;
  }) {
    const { tenantId, branchId, menuItemId, routes, actorUserId } = params;

    // Validate menu item exists
    const menuItem = await this.prisma.menuItem.findFirst({
      where: { id: menuItemId, tenantId, isActive: true, deletedAt: null },
    });
    if (!menuItem) throw new NotFoundException('Menu item not found');

    // Validate all stations and check route-type/station-type consistency
    const stationIds = routes.map((r) => r.stationId);
    const validStations = await this.prisma.kitchenStation.findMany({
      where: { id: { in: stationIds }, tenantId, branchId, isActive: true },
      select: { id: true, name: true, isExpo: true },
    });
    if (validStations.length !== stationIds.length) {
      throw new NotFoundException('One or more stations not found or inactive');
    }

    const stationMap = new Map(validStations.map((s) => [s.id, s]));

    // Validate each route's type against its station
    for (const route of routes) {
      const rt = route.routeType ?? 'PREPARE';
      const station = stationMap.get(route.stationId)!;

      if (rt !== 'PREPARE' && rt !== 'ASSEMBLE') {
        throw new ConflictException('routeType must be PREPARE or ASSEMBLE');
      }
      if (station.isExpo && rt !== 'ASSEMBLE') {
        throw new ConflictException({
          code: 'INVALID_ROUTE_STATION_ASSIGNMENT',
          message: `Expo station "${station.name}" only accepts ASSEMBLE routes, got ${rt}`,
        });
      }
      if (!station.isExpo && rt !== 'PREPARE') {
        throw new ConflictException({
          code: 'INVALID_ROUTE_STATION_ASSIGNMENT',
          message: `Normal station "${station.name}" only accepts PREPARE routes, got ${rt}`,
        });
      }
    }

    // Validate proposed set has at least one required PREPARE route BEFORE writing
    this.assertProposedRoutesHaveRequiredPrepare(routes, validStations);

    // Atomic replace: delete old routes, create new ones
    const result = await this.prisma.$transaction(async (tx) => {
      // Delete existing routes for this menu item
      await tx.menuItemStation.deleteMany({
        where: { branchId, menuItemId },
      });

      // Create new routes
      const created = [];
      for (const route of routes) {
        const r = await tx.menuItemStation.create({
          data: {
            tenantId,
            branchId,
            menuItemId,
            stationId: route.stationId,
            routeType: route.routeType ?? 'PREPARE',
            isRequired: route.isRequired ?? true,
            sortOrder: route.sortOrder ?? 0,
          },
          include: {
            station: {
              select: { id: true, name: true, code: true, kitchenId: true, isExpo: true },
            },
            menuItem: {
              select: { id: true, name: true },
            },
          },
        });
        created.push(r);
      }

      await tx.auditLog.create({
        data: {
          actorUserId,
          tenantId,
          branchId,
          action: 'ROUTE_REPLACE',
          entityType: 'MenuItemStation',
          entityId: menuItemId,
          afterJson: { routes: routes.map((r) => ({ stationId: r.stationId, routeType: r.routeType ?? 'PREPARE' })) },
        },
      });

      return created;
    });

    return { replaced: true, routes: result.map((r) => this.serializeRoute(r)) };
  }

  async deleteRoute(params: {
    tenantId: string;
    branchId: string;
    menuItemId: string;
    stationId: string;
    routeType: string;
    actorUserId: string;
  }) {
    const { tenantId, branchId, menuItemId, stationId, routeType, actorUserId } = params;

    const existing = await this.prisma.menuItemStation.findUnique({
      where: {
        branchId_menuItemId_stationId_routeType: {
          branchId,
          menuItemId,
          stationId,
          routeType,
        },
      },
    });
    if (!existing) throw new NotFoundException('Route not found');

    // Prevent deleting the last required PREPARE route — do BEFORE any writes
    if (routeType === 'PREPARE' && existing.isRequired) {
      await this.assertDeleteSafe(tenantId, branchId, menuItemId, stationId, routeType);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.menuItemStation.delete({
        where: {
          branchId_menuItemId_stationId_routeType: {
            branchId,
            menuItemId,
            stationId,
            routeType,
          },
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          tenantId,
          branchId,
          action: 'ROUTE_DELETE',
          entityType: 'MenuItemStation',
          entityId: `${branchId}:${menuItemId}:${stationId}:${routeType}`,
          beforeJson: existing,
        },
      });
    });

    return { deleted: true };
  }

  /**
   * Assert using the transaction client that at least one required PREPARE route
   * exists for the menu item. Called inside $transaction so failure rolls back.
   */
  private async assertRequiredPrepareRouteExistsTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string,
    menuItemId: string,
  ): Promise<void> {
    const requiredPrepare = await tx.menuItemStation.findFirst({
      where: {
        tenantId,
        branchId,
        menuItemId,
        routeType: 'PREPARE',
        isRequired: true,
        station: { isActive: true },
      },
    });

    if (!requiredPrepare) {
      throw new ConflictException({
        code: 'REQUIRED_PREPARE_ROUTE_MISSING',
        message: `Menu item must have at least one required PREPARE route on an active normal station`,
      });
    }
  }

  /**
   * Validate the proposed route array (before any DB writes) contains at least
   * one required PREPARE route on a normal station.
   */
  private assertProposedRoutesHaveRequiredPrepare(
    routes: { stationId: string; routeType?: string; isRequired?: boolean }[],
    stations: { id: string; name: string; isExpo: boolean }[],
  ): void {
    const stationMap = new Map(stations.map((s) => [s.id, s]));

    const hasRequiredPrepare = routes.some((r) => {
      const rt = r.routeType ?? 'PREPARE';
      const station = stationMap.get(r.stationId);
      const isRequired = r.isRequired ?? true;
      return rt === 'PREPARE' && isRequired && station && !station.isExpo;
    });

    if (!hasRequiredPrepare) {
      throw new ConflictException({
        code: 'REQUIRED_PREPARE_ROUTE_MISSING',
        message: `Menu item must have at least one required PREPARE route on an active normal station`,
      });
    }
  }

  /**
   * Check that deleting this route leaves at least one required PREPARE route.
   * Called before the delete transaction — safe because it only reads.
   */
  private async assertDeleteSafe(
    tenantId: string,
    branchId: string,
    menuItemId: string,
    excludeStationId: string,
    excludeRouteType: string,
  ): Promise<void> {
    const remaining = await this.prisma.menuItemStation.findFirst({
      where: {
        tenantId,
        branchId,
        menuItemId,
        routeType: 'PREPARE',
        isRequired: true,
        station: { isActive: true },
        NOT: {
          stationId: excludeStationId,
          routeType: excludeRouteType,
        },
      },
    });

    if (!remaining) {
      throw new ConflictException({
        code: 'REQUIRED_PREPARE_ROUTE_MISSING',
        message: `Cannot delete the last required PREPARE route for this menu item`,
      });
    }
  }

  private serializeRoute(route: any) {
    return {
      menuItemId: route.menuItemId,
      menuItemName: route.menuItem?.name ?? null,
      stationId: route.stationId,
      stationName: route.station?.name ?? null,
      stationCode: route.station?.code ?? null,
      kitchenId: route.station?.kitchenId ?? null,
      routeType: route.routeType,
      isRequired: route.isRequired,
      sortOrder: route.sortOrder,
      createdAt: route.createdAt,
    };
  }
}
