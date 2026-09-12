import { Controller, Get, Post, Patch, Delete, Body, Param, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { BranchScopeGuard } from '../auth/branch-scope.guard';
import { Roles, BranchScoped } from '../auth/types'; // eslint-disable-line @typescript-eslint/consistent-type-imports
import { TenantRole } from '@rms/contracts';
import { KdsDevicesService } from './kds-devices.service';
import { RegisterKdsDeviceDto, UpdateKdsDeviceDto, AssignStationToDeviceDto } from './dto'; // eslint-disable-line @typescript-eslint/consistent-type-imports

@ApiTags('Kitchen Configuration')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, BranchScopeGuard)
@Controller('branches/:branchId/kds-devices')
export class KdsDevicesController {
  constructor(private readonly devicesService: KdsDevicesService) {}

  @Get()
  @BranchScoped()
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.KITCHEN_STAFF)
  @ApiOperation({ summary: 'List KDS devices for a branch' })
  async listDevices(@Req() req: any, @Param('branchId') branchId: string) {
    const { data } = req.tenantContext;
    const devices = await this.devicesService.listDevices({ tenantId: data.tenantId, branchId });
    return { data: devices };
  }

  @Post()
  @BranchScoped()
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Register a new KDS device' })
  async registerDevice(
    @Req() req: any,
    @Param('branchId') branchId: string,
    @Body() body: RegisterKdsDeviceDto,
  ) {
    const { data, userId } = req.tenantContext;
    const device = await this.devicesService.registerDevice({
      tenantId: data.tenantId,
      branchId,
      name: body.name,
      actorUserId: userId,
    });
    return { data: device };
  }

  @Patch(':deviceId')
  @BranchScoped()
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Update a KDS device' })
  async updateDevice(
    @Req() req: any,
    @Param('branchId') branchId: string,
    @Param('deviceId') deviceId: string,
    @Body() body: UpdateKdsDeviceDto,
  ) {
    const { data, userId } = req.tenantContext;
    const device = await this.devicesService.updateDevice({
      tenantId: data.tenantId,
      branchId,
      deviceId,
      name: body.name,
      isActive: body.isActive,
      actorUserId: userId,
    });
    return { data: device };
  }

  @Delete(':deviceId')
  @BranchScoped()
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Deactivate a KDS device' })
  async deleteDevice(
    @Req() req: any,
    @Param('branchId') branchId: string,
    @Param('deviceId') deviceId: string,
  ) {
    const { data, userId } = req.tenantContext;
    const result = await this.devicesService.deleteDevice({
      tenantId: data.tenantId,
      branchId,
      deviceId,
      actorUserId: userId,
    });
    return { data: result };
  }

  @Post(':deviceId/stations')
  @BranchScoped()
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Assign a station to a KDS device' })
  async assignStation(
    @Req() req: any,
    @Param('branchId') branchId: string,
    @Param('deviceId') deviceId: string,
    @Body() body: AssignStationToDeviceDto,
  ) {
    const { data, userId } = req.tenantContext;
    const result = await this.devicesService.assignStation({
      tenantId: data.tenantId,
      branchId,
      deviceId,
      stationId: body.stationId,
      displayOrder: body.displayOrder,
      actorUserId: userId,
    });
    return { data: result };
  }

  @Delete(':deviceId/stations/:stationId')
  @BranchScoped()
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Remove a station assignment from a KDS device' })
  async removeStation(
    @Req() req: any,
    @Param('branchId') branchId: string,
    @Param('deviceId') deviceId: string,
    @Param('stationId') stationId: string,
  ) {
    const { data, userId } = req.tenantContext;
    const result = await this.devicesService.removeStation({
      tenantId: data.tenantId,
      branchId,
      deviceId,
      stationId,
      actorUserId: userId,
    });
    return { data: result };
  }
}
