import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  Query,
  Inject,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PlatformAdminService } from './platform-admin.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/types';
import { PlatformRole } from '@rms/contracts';

@ApiTags('Platform Admin')
@Controller('platform')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(PlatformRole.SUPER_ADMIN)
@ApiCookieAuth()
export class PlatformAdminController {
  constructor(@Inject(PlatformAdminService) private readonly platformAdminService: PlatformAdminService) {}

  @Get('tenants')
  @ApiOperation({ summary: 'List tenants with aggregate counts' })
  async listTenants(@Query('status') status?: string) {
    const tenants = await this.platformAdminService.listTenants(status ? { status } : undefined);
    return { data: tenants };
  }

  @Patch('tenants/:tenantId/suspend')
  @ApiOperation({ summary: 'Suspend tenant' })
  async suspendTenant(@Param('tenantId') tenantId: string) {
    const tenant = await this.platformAdminService.suspendTenant(tenantId);
    return { data: tenant };
  }

  @Patch('tenants/:tenantId/activate')
  @ApiOperation({ summary: 'Activate tenant' })
  async activateTenant(@Param('tenantId') tenantId: string) {
    const tenant = await this.platformAdminService.activateTenant(tenantId);
    return { data: tenant };
  }

  @Get('users')
  @ApiOperation({ summary: 'List users, optionally scoped to tenant' })
  async listUsers(@Query('tenantId') tenantId?: string) {
    const users = await this.platformAdminService.listUsers(tenantId);
    return { data: users };
  }

  @Patch('users/:userId/role')
  @ApiOperation({ summary: 'Assign platform role' })
  async setUserRole(@Param('userId') userId: string, @Body() body: { platformRole: string }) {
    const user = await this.platformAdminService.setUserPlatformRole(userId, body.platformRole);
    return { data: user };
  }

  @Patch('users/:userId/deactivate')
  @ApiOperation({ summary: 'Deactivate user' })
  async deactivateUser(@Param('userId') userId: string) {
    const user = await this.platformAdminService.deactivateUser(userId);
    return { data: user };
  }
}
