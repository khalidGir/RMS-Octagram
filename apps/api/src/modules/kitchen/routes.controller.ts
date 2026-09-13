import { Controller, Get, Post, Put, Delete, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { BranchScopeGuard } from '../auth/branch-scope.guard';
import { Roles, BranchScoped, type TenantContext } from '../auth/types'; // eslint-disable-line @typescript-eslint/consistent-type-imports
import { TenantRole } from '@rms/contracts';
import { RoutesService } from './routes.service'; // eslint-disable-line @typescript-eslint/consistent-type-imports
import { CreateRouteDto, ReplaceRoutesDto } from './dto'; // eslint-disable-line @typescript-eslint/consistent-type-imports

@ApiTags('Kitchen Configuration')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, BranchScopeGuard)
@Controller('branches/:branchId/routes')
export class RoutesController {
  constructor(private readonly routesService: RoutesService) {}

  @Get()
  @BranchScoped()
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.CASHIER, TenantRole.KITCHEN_STAFF)
  @ApiOperation({ summary: 'List menu item routes (station assignments)' })
  @ApiQuery({ name: 'menuItemId', required: false })
  @ApiQuery({ name: 'stationId', required: false })
  @ApiQuery({ name: 'routeType', required: false, enum: ['PREPARE', 'ASSEMBLE'] })
  async listRoutes(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Query('menuItemId') menuItemId?: string,
    @Query('stationId') stationId?: string,
    @Query('routeType') routeType?: string,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const routes = await this.routesService.listRoutes({
      tenantId: ctx.tenantId!,
      branchId,
      menuItemId,
      stationId,
      routeType,
    });
    return { data: routes };
  }

  @Post()
  @BranchScoped()
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Create a route (assign menu item to station)' })
  async createRoute(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Body() body: CreateRouteDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const result = await this.routesService.createRoute({
      tenantId: ctx.tenantId!,
      branchId,
      menuItemId: body.menuItemId,
      stationId: body.stationId,
      routeType: body.routeType,
      isRequired: body.isRequired,
      sortOrder: body.sortOrder,
      actorUserId: ctx.userId,
    });
    return { data: result };
  }

  @Put('menu-items/:menuItemId')
  @BranchScoped()
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Replace all routes for a menu item (atomic)' })
  async replaceRoutes(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('menuItemId') menuItemId: string,
    @Body() body: ReplaceRoutesDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const result = await this.routesService.replaceRoutes({
      tenantId: ctx.tenantId!,
      branchId,
      menuItemId,
      routes: body.routes,
      actorUserId: ctx.userId,
    });
    return { data: result };
  }

  @Delete(':menuItemId/:stationId/:routeType')
  @BranchScoped()
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Delete a route' })
  async deleteRoute(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('menuItemId') menuItemId: string,
    @Param('stationId') stationId: string,
    @Param('routeType') routeType: string,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const result = await this.routesService.deleteRoute({
      tenantId: ctx.tenantId!,
      branchId,
      menuItemId,
      stationId,
      routeType,
      actorUserId: ctx.userId,
    });
    return { data: result };
  }
}
