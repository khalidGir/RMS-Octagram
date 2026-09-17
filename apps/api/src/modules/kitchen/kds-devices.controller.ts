import { Controller, Get, Post, Patch, Delete, Body, Param, Req, UseGuards, HttpCode, HttpStatus, Inject } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { BranchScopeGuard } from '../auth/branch-scope.guard';
import { Roles, BranchScoped, type TenantContext } from '../auth/types'; // eslint-disable-line @typescript-eslint/consistent-type-imports
import { TenantRole } from '@rms/contracts';
import { KdsDevicesService } from './kds-devices.service';
import { RegisterKdsDeviceDto, UpdateKdsDeviceDto, AssignStationToDeviceDto } from './dto'; // eslint-disable-line @typescript-eslint/consistent-type-imports

@ApiTags('Kitchen Configuration')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, BranchScopeGuard)
@Controller('branches/:branchId/kds-devices')
export class KdsDevicesController {
  constructor(@Inject(KdsDevicesService) private readonly devicesService: KdsDevicesService) {}

  @Get()
  @BranchScoped()
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.KITCHEN_STAFF)
  @ApiOperation({ summary: 'List KDS devices for a branch' })
  async listDevices(@Req() req: Request, @Param('branchId') branchId: string) {
    const ctx = req.tenantContext as TenantContext;
    const devices = await this.devicesService.listDevices({
      tenantId: ctx.tenantId!,
      branchId,
      userRole: ctx.tenantRole,
    });
    return { data: devices };
  }

  @Post()
  @BranchScoped()
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Register a new KDS device' })
  async registerDevice(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Body() body: RegisterKdsDeviceDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const device = await this.devicesService.registerDevice({
      tenantId: ctx.tenantId!,
      branchId,
      name: body.name,
      actorUserId: ctx.userId,
    });
    return { data: device };
  }

  @Patch(':deviceId')
  @BranchScoped()
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Update a KDS device' })
  async updateDevice(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('deviceId') deviceId: string,
    @Body() body: UpdateKdsDeviceDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const device = await this.devicesService.updateDevice({
      tenantId: ctx.tenantId!,
      branchId,
      deviceId,
      name: body.name,
      isActive: body.isActive,
      actorUserId: ctx.userId,
    });
    return { data: device };
  }

  @Delete(':deviceId')
  @BranchScoped()
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Deactivate a KDS device' })
  async deleteDevice(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('deviceId') deviceId: string,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const result = await this.devicesService.deleteDevice({
      tenantId: ctx.tenantId!,
      branchId,
      deviceId,
      actorUserId: ctx.userId,
    });
    return { data: result };
  }

  @Post(':deviceId/rotate-token')
  @BranchScoped()
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate KDS device token (old token invalidated)' })
  async rotateToken(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('deviceId') deviceId: string,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const result = await this.devicesService.rotateToken({
      tenantId: ctx.tenantId!,
      branchId,
      deviceId,
      actorUserId: ctx.userId,
    });
    return { data: result };
  }

  @Post(':deviceId/stations')
  @BranchScoped()
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Assign a station to a KDS device' })
  async assignStation(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('deviceId') deviceId: string,
    @Body() body: AssignStationToDeviceDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const result = await this.devicesService.assignStation({
      tenantId: ctx.tenantId!,
      branchId,
      deviceId,
      stationId: body.stationId,
      displayOrder: body.displayOrder,
      actorUserId: ctx.userId,
    });
    return { data: result };
  }

  @Delete(':deviceId/stations/:stationId')
  @BranchScoped()
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Remove a station assignment from a KDS device' })
  async removeStation(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('deviceId') deviceId: string,
    @Param('stationId') stationId: string,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const result = await this.devicesService.removeStation({
      tenantId: ctx.tenantId!,
      branchId,
      deviceId,
      stationId,
      actorUserId: ctx.userId,
    });
    return { data: result };
  }
}
