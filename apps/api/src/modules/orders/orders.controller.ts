import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Req,
  Query,
  Inject,
  BadRequestException,
  NotImplementedException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import { UseGuards } from '@nestjs/common';
import { TenantRole } from '@rms/contracts';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { BranchScopeGuard } from '../auth/branch-scope.guard';
import { Roles, BranchScoped } from '../auth/types';
import type { TenantContext } from '../auth/types';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { OrdersService } from './orders.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import {
  CreatePosOrderDto,
  EditOrderDto,
  CancelOrderDto,
  ConfirmOrderDto,
  ListOrdersDto,
} from './dto';

@ApiTags('Orders')
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard, BranchScopeGuard)
@ApiCookieAuth()
export class OrdersController {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}

  // ─── CREATE POS ORDER ───────────────────────

  @Post('branches/:branchId/orders')
  @BranchScoped()
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.CASHIER)
  @ApiOperation({ summary: 'Create POS order' })
  async createPosOrder(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Body() dto: CreatePosOrderDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const result = await this.orders.createPosOrder({
      tenantId: ctx.tenantId!,
      branchId,
      lines: dto.lines,
      notes: dto.notes,
      orderType: dto.orderType,
      tableId: dto.tableId,
      createdByUserId: ctx.userId,
      idempotencyKey: dto.idempotencyKey,
      quotedTotal: dto.quotedTotal,
    });
    return { data: result };
  }

  // ─── LIST ORDERS ────────────────────────────

  @Get('branches/:branchId/orders')
  @BranchScoped()
  @ApiOperation({ summary: 'List orders' })
  async listOrders(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Query() dto: ListOrdersDto,
  ) {
    const ctx = req.tenantContext as TenantContext;

    const parseDate = (value: string, field: string): Date => {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) {
        throw new BadRequestException(`Invalid date for "${field}"`);
      }
      return d;
    };

    const result = await this.orders.listOrders({
      tenantId: ctx.tenantId!,
      branchId,
      status: dto.status,
      orderType: dto.orderType,
      from: dto.from ? parseDate(dto.from, 'from') : undefined,
      to: dto.to ? parseDate(dto.to, 'to') : undefined,
      limit: Math.min(dto.limit ?? 50, 100),
      after: dto.after,
    });
    return { data: result };
  }

  // ─── GET ORDER DETAIL ───────────────────────

  @Get('orders/:orderId')
  @ApiOperation({ summary: 'Get order detail' })
  async getOrder(@Req() req: Request, @Param('orderId') orderId: string) {
    const ctx = req.tenantContext as TenantContext;
    const result = await this.orders.getOrder({
      orderId,
      tenantId: ctx.tenantId!,
      callerBranchIds: ctx.branchIds ?? [],
      callerIsOwner: ctx.tenantRole === TenantRole.OWNER,
    });
    return { data: result };
  }

  // ─── EDIT ORDER ─────────────────────────────

  @Patch('orders/:orderId')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.CASHIER)
  @ApiOperation({ summary: 'Edit draft/unconfirmed order' })
  async editOrder(
    @Req() req: Request,
    @Param('orderId') orderId: string,
    @Body() dto: EditOrderDto,
  ) {
    const ctx = req.tenantContext as TenantContext;

    // Load order to determine branch for service-level auth
    const order = await this.orders.getOrder({
      orderId,
      tenantId: ctx.tenantId!,
      callerBranchIds: ctx.branchIds ?? [],
      callerIsOwner: ctx.tenantRole === TenantRole.OWNER,
    });

    const result = await this.orders.editOrder({
      orderId,
      tenantId: ctx.tenantId!,
      branchId: (order as any).branchId,
      lines: dto.lines,
      notes: dto.notes,
      expectedVersion: dto.expectedVersion,
      actorUserId: ctx.userId,
      idempotencyKey: dto.idempotencyKey,
      quotedTotal: dto.quotedTotal,
    });
    return { data: result };
  }

  // ─── CONFIRM ORDER (Disabled in 3A) ─────────

  @Post('orders/:orderId/confirm')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.CASHIER)
  @ApiOperation({ summary: 'Confirm order (deferred to Phase 3C)' })
  async confirmOrder(@Body() _dto: ConfirmOrderDto) {
    throw new NotImplementedException(
      'Order confirmation workflow is not yet available. Orders will be confirmed automatically when payment is processed.',
    );
  }

  // ─── CANCEL ORDER ───────────────────────────

  @Post('orders/:orderId/cancel')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.CASHIER)
  @ApiOperation({ summary: 'Cancel order before confirmation' })
  async cancelOrder(
    @Req() req: Request,
    @Param('orderId') orderId: string,
    @Body() dto: CancelOrderDto,
  ) {
    const ctx = req.tenantContext as TenantContext;

    // Load order to determine branch for service-level auth
    const order = await this.orders.getOrder({
      orderId,
      tenantId: ctx.tenantId!,
      callerBranchIds: ctx.branchIds ?? [],
      callerIsOwner: ctx.tenantRole === TenantRole.OWNER,
    });

    const result = await this.orders.cancelOrder({
      orderId,
      tenantId: ctx.tenantId!,
      branchId: (order as any).branchId,
      actorUserId: ctx.userId,
      reason: dto.reason,
      expectedVersion: dto.expectedVersion,
    });
    return { data: result };
  }
}
