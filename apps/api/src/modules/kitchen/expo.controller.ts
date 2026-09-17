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
import { ExpoService } from './expo.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { BranchScopeGuard } from '../auth/branch-scope.guard';
import { Roles, BranchScoped, type TenantContext } from '../auth/types';
import { TenantRole } from '@rms/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS needs runtime DTO classes for validation metadata.
import { CollectOrderDto, ExpoOrdersQueryDto, ReleaseExpoDto, RecallExpoDto } from './dto';

@ApiTags('Expo')
@ApiCookieAuth()
@UseGuards(JwtAuthGuard, RolesGuard, BranchScopeGuard)
@Controller('branches/:branchId/expo')
@BranchScoped()
export class ExpoController {
  constructor(
    @Inject(ExpoService)
    private readonly expoService: ExpoService,
  ) {}

  @Get('orders')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.CASHIER, TenantRole.KITCHEN_STAFF, TenantRole.WAITER)
  @ApiOperation({ summary: 'List orders on the expo screen' })
  async listExpoOrders(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Query() query: ExpoOrdersQueryDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const orders = await this.expoService.listExpoOrders({
      tenantId: ctx.tenantId!,
      branchId,
      updatedAfter: query.updatedAfter,
      limit: query.limit,
      after: query.after,
    });
    return { data: orders };
  }

  @Get('orders/:orderId')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.CASHIER, TenantRole.KITCHEN_STAFF, TenantRole.WAITER)
  @ApiOperation({ summary: 'Get expo detail for a specific order' })
  async getExpoOrderDetail(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('orderId') orderId: string,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const detail = await this.expoService.getExpoOrderDetail({
      tenantId: ctx.tenantId!,
      branchId,
      orderId,
    });
    return { data: detail };
  }

  @Post('orders/:orderId/release')
  @HttpCode(HttpStatus.OK)
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.KITCHEN_STAFF)
  @ApiOperation({ summary: 'Release an order from expo to waiters' })
  async releaseOrder(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('orderId') orderId: string,
    @Body() dto: ReleaseExpoDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const result = await this.expoService.releaseOrder({
      tenantId: ctx.tenantId!,
      branchId,
      orderId,
      actorUserId: ctx.userId,
      expectedVersion: dto.expectedVersion,
    });
    return { data: result };
  }

  @Post('orders/:orderId/recall')
  @HttpCode(HttpStatus.OK)
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Recall an order from expo (undo release)' })
  async recallOrder(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('orderId') orderId: string,
    @Body() dto: RecallExpoDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const result = await this.expoService.recallOrder({
      tenantId: ctx.tenantId!,
      branchId,
      orderId,
      actorUserId: ctx.userId,
      reason: dto.reason,
      expectedVersion: dto.expectedVersion,
    });
    return { data: result };
  }

  @Post('orders/:orderId/collect')
  @HttpCode(HttpStatus.OK)
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.CASHIER, TenantRole.KITCHEN_STAFF)
  @ApiOperation({ summary: 'Collect order at expo station' })
  async collectOrder(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('orderId') orderId: string,
    @Body() body: CollectOrderDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const result = await this.expoService.collectOrder({
      tenantId: ctx.tenantId!,
      branchId,
      orderId,
      actorUserId: ctx.userId,
      expectedVersion: body.expectedVersion,
    });
    return { data: result };
  }
}
