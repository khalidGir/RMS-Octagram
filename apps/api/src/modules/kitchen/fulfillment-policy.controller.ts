import { Controller, Get, Put, Body, Param, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { BranchScopeGuard } from '../auth/branch-scope.guard';
import { Roles, BranchScoped, type TenantContext } from '../auth/types'; // eslint-disable-line @typescript-eslint/consistent-type-imports
import { TenantRole } from '@rms/contracts';
import { FulfillmentPolicyService } from './fulfillment-policy.service'; // eslint-disable-line @typescript-eslint/consistent-type-imports
import { UpsertFulfillmentPolicyDto } from './dto'; // eslint-disable-line @typescript-eslint/consistent-type-imports

@ApiTags('Kitchen Configuration')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, BranchScopeGuard)
@Controller('branches/:branchId/fulfillment-policy')
export class FulfillmentPolicyController {
  constructor(private readonly policyService: FulfillmentPolicyService) {}

  @Get()
  @BranchScoped()
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.CASHIER, TenantRole.KITCHEN_STAFF)
  @ApiOperation({ summary: 'Get the branch fulfillment policy' })
  async getPolicy(@Req() req: Request, @Param('branchId') branchId: string) {
    const ctx = req.tenantContext as TenantContext;
    const policy = await this.policyService.getPolicy(ctx.tenantId!, branchId);
    return { data: policy };
  }

  @Put()
  @BranchScoped()
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Create or update the branch fulfillment policy' })
  async upsertPolicy(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Body() body: UpsertFulfillmentPolicyDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const policy = await this.policyService.upsertPolicy({
      tenantId: ctx.tenantId!,
      branchId,
      serviceMode: body.serviceMode,
      expoMode: body.expoMode,
      allowWaiterSelfClaim: body.allowWaiterSelfClaim,
      showUnassignedReadyOrdersToWaiters: body.showUnassignedReadyOrdersToWaiters,
      readyReminderSeconds: body.readyReminderSeconds,
      readyEscalationSeconds: body.readyEscalationSeconds,
      autoCompleteKitchenTicketOnCollected: body.autoCompleteKitchenTicketOnCollected,
      orderAcceptancePolicy: body.orderAcceptancePolicy,
      assistanceEscalationSeconds: body.assistanceEscalationSeconds,
      cashAtCounterEnabled: body.cashAtCounterEnabled,
      cashToWaiterEnabled: body.cashToWaiterEnabled,
      actorUserId: ctx.userId,
    });
    return { data: policy };
  }
}
