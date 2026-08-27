import {
  Controller,
  Get,
  Patch,
  Put,
  Body,
  Param,
  Query,
  Inject,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { PlatformAdminService } from './platform-admin.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, type TenantContext } from '../auth/types';
import { PlatformRole, EntitlementStatus } from '@rms/contracts';
import type { FeatureKey } from '@rms/contracts';
import { IsString, IsEnum, IsOptional, IsDateString } from 'class-validator';

class SetEntitlementDto {
  @IsEnum(EntitlementStatus)
  status!: EntitlementStatus;

  @IsOptional()
  @IsDateString()
  trialEndsAt?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  internalNote?: string;
}

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

  // ─── ENTITLEMENTS ──────────────────────────

  @Get('tenants/:tenantId/features')
  @ApiOperation({ summary: 'List entitlements for a tenant (all 9 features with status)' })
  async listEntitlements(@Param('tenantId') tenantId: string) {
    const entitlements = await this.platformAdminService.listEntitlements(tenantId);
    return { data: entitlements };
  }

  @Put('tenants/:tenantId/features/:featureKey')
  @ApiOperation({ summary: 'Set a single feature entitlement for a tenant' })
  async setEntitlement(
    @Req() req: Request,
    @Param('tenantId') tenantId: string,
    @Param('featureKey') featureKey: FeatureKey,
    @Body() body: SetEntitlementDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const entitlement = await this.platformAdminService.setEntitlement({
      tenantId,
      featureKey,
      status: body.status,
      trialEndsAt: body.trialEndsAt,
      reason: body.reason,
      internalNote: body.internalNote,
      actorUserId: ctx.userId,
    });
    return { data: entitlement };
  }

  @Get('tenants/:tenantId/features/effective')
  @ApiOperation({ summary: 'Compute effective feature map for a tenant' })
  async getEffectiveFeatures(
    @Param('tenantId') tenantId: string,
    @Query('branchId') branchId?: string,
  ) {
    const features = await this.platformAdminService.getEffectiveFeatures(tenantId, branchId);
    return { data: features };
  }
}
