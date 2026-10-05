import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  Query,
  UseGuards,
  Inject,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { ServiceRequestService } from './service-request.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { BranchScopeGuard } from '../auth/branch-scope.guard';
import { Roles, BranchScoped, type TenantContext } from '../auth/types';
import { TenantRole } from '@rms/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS needs runtime DTO classes for validation metadata.
import { ServiceRequestActionDto, ServiceRequestListQueryDto } from './dto';

@ApiTags('Service Requests')
@ApiCookieAuth()
@UseGuards(JwtAuthGuard, RolesGuard, BranchScopeGuard)
@Controller('branches/:branchId/service-requests')
@BranchScoped()
export class ServiceRequestsController {
  constructor(
    @Inject(ServiceRequestService)
    private readonly serviceRequests: ServiceRequestService,
  ) {}

  @Get()
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.WAITER)
  @ApiOperation({ summary: 'List active service requests for the branch' })
  async list(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Query() query: ServiceRequestListQueryDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const data = await this.serviceRequests.listBranchRequests({
      tenantId: ctx.tenantId!,
      branchId,
      status: query.status,
      limit: query.limit,
    });
    return { data };
  }

  @Post(':id/claim')
  @HttpCode(HttpStatus.OK)
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.WAITER)
  @ApiOperation({ summary: 'Claim an open or escalated service request' })
  async claim(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('id') id: string,
    @Body() dto: ServiceRequestActionDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const data = await this.serviceRequests.claim({
      tenantId: ctx.tenantId!,
      branchId,
      requestId: id,
      actorUserId: ctx.userId,
      actorRole: ctx.tenantRole as string,
      expectedVersion: dto.expectedVersion,
    });
    return { data };
  }

  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.WAITER)
  @ApiOperation({ summary: 'Resolve a claimed service request' })
  async resolve(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('id') id: string,
    @Body() dto: ServiceRequestActionDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const data = await this.serviceRequests.resolve({
      tenantId: ctx.tenantId!,
      branchId,
      requestId: id,
      actorUserId: ctx.userId,
      actorRole: ctx.tenantRole as string,
      expectedVersion: dto.expectedVersion,
    });
    return { data };
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.WAITER)
  @ApiOperation({ summary: 'Cancel an open, claimed or escalated service request' })
  async cancel(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('id') id: string,
    @Body() dto: ServiceRequestActionDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const data = await this.serviceRequests.cancel({
      tenantId: ctx.tenantId!,
      branchId,
      requestId: id,
      actorUserId: ctx.userId,
      actorRole: ctx.tenantRole as string,
      expectedVersion: dto.expectedVersion,
    });
    return { data };
  }
}
