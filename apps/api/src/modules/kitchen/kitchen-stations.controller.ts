import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
  Inject,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import type { Request } from 'express';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { KitchenStationsService } from './kitchen-stations.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { BranchScopeGuard } from '../auth/branch-scope.guard';
import { Roles, BranchScoped, type TenantContext } from '../auth/types';
import { TenantRole } from '@rms/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import {
  CreateStationDto,
  UpdateStationDto,
  AssignMenuItemToStationDto,
} from './dto';

@ApiTags('Kitchen Stations')
@ApiCookieAuth()
@UseGuards(JwtAuthGuard, RolesGuard, BranchScopeGuard)
@Controller('branches/:branchId/kitchen-stations')
@BranchScoped()
export class KitchenStationsController {
  constructor(
    @Inject(KitchenStationsService)
    private readonly stationsService: KitchenStationsService,
  ) {}

  @Get()
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.CASHIER, TenantRole.KITCHEN_STAFF)
  @ApiOperation({ summary: 'List kitchen stations' })
  async listStations(@Req() req: Request, @Param('branchId') branchId: string) {
    const ctx = req.tenantContext as TenantContext;
    const stations = await this.stationsService.listStations(ctx.tenantId!, branchId);
    return { data: stations };
  }

  @Post()
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Create a kitchen station' })
  async createStation(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Body() dto: CreateStationDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const station = await this.stationsService.createStation({
      tenantId: ctx.tenantId!,
      branchId,
      name: dto.name,
      displayOrder: dto.displayOrder,
      actorUserId: ctx.userId,
    });
    return { data: station };
  }

  @Patch(':stationId')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Update a kitchen station' })
  async updateStation(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('stationId') stationId: string,
    @Body() dto: UpdateStationDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const station = await this.stationsService.updateStation({
      tenantId: ctx.tenantId!,
      branchId,
      stationId,
      name: dto.name,
      displayOrder: dto.displayOrder,
      isActive: dto.isActive,
      actorUserId: ctx.userId,
    });
    return { data: station };
  }

  @Delete(':stationId')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Soft-delete a kitchen station' })
  async deleteStation(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('stationId') stationId: string,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const result = await this.stationsService.deleteStation({
      tenantId: ctx.tenantId!,
      branchId,
      stationId,
      actorUserId: ctx.userId,
    });
    return { data: result };
  }

  // ─── Menu Item Assignments ────────────────

  @Post(':stationId/menu-items')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Assign a menu item to a station' })
  async assignMenuItem(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('stationId') stationId: string,
    @Body() dto: AssignMenuItemToStationDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const result = await this.stationsService.assignMenuItem({
      tenantId: ctx.tenantId!,
      branchId,
      stationId,
      menuItemId: dto.menuItemId,
      actorUserId: ctx.userId,
    });
    return { data: result };
  }

  @Delete(':stationId/menu-items/:menuItemId')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Remove a menu item assignment from a station' })
  async removeMenuItem(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('stationId') stationId: string,
    @Param('menuItemId') menuItemId: string,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const result = await this.stationsService.removeMenuItemAssignment({
      tenantId: ctx.tenantId!,
      branchId,
      stationId,
      menuItemId,
      actorUserId: ctx.userId,
    });
    return { data: result };
  }

  @Get(':stationId/menu-items')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.CASHIER, TenantRole.KITCHEN_STAFF)
  @ApiOperation({ summary: 'List menu items assigned to a station' })
  async getStationMenuItems(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('stationId') stationId: string,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const result = await this.stationsService.getStationMenuItems(ctx.tenantId!, branchId, stationId);
    return { data: result };
  }
}
