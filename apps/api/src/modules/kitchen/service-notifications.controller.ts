import { Controller, Get, Inject, Param, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { FeatureKey, TenantRole } from '@rms/contracts';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { BranchScopeGuard } from '../auth/branch-scope.guard';
import { BranchScoped, Roles, type TenantContext } from '../auth/types';
import { FeatureEnabled } from '../features/feature-enabled.decorator';
import { FeatureEnabledGuard } from '../features/feature-enabled.guard';
import { ServiceNotificationService } from './service-notification.service';

@ApiTags('Service Notifications')
@ApiBearerAuth()
@Controller('branches/:branchId/service-notifications')
@UseGuards(JwtAuthGuard, RolesGuard, BranchScopeGuard, FeatureEnabledGuard)
@BranchScoped()
@FeatureEnabled(FeatureKey.KDS)
export class ServiceNotificationsController {
  constructor(@Inject(ServiceNotificationService) private readonly notifications: ServiceNotificationService) {}

  @Get()
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.WAITER)
  @ApiOperation({ summary: 'List scoped durable service notifications; waiters see their own recipients only' })
  async list(@Req() request: Request, @Param('branchId') branchId: string) {
    const context = request.tenantContext as TenantContext;
    const data = await this.notifications.listNotifications({
      tenantId: context.tenantId!, branchId, limit: 50,
      ...(context.tenantRole === TenantRole.WAITER ? { assignedUserId: context.userId } : {}),
    });
    return { data };
  }
}
