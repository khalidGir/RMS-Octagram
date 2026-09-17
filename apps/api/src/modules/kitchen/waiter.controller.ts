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
import { WaiterService } from './waiter.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { BranchScopeGuard } from '../auth/branch-scope.guard';
import { Roles, BranchScoped, type TenantContext } from '../auth/types';
import { TenantRole } from '@rms/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS needs runtime DTO classes for validation metadata.
import { AssignWaiterDto, CollectOrderDto, ServeOrderDto, ServeLinesDto, ServiceBoardQueryDto } from './dto';

@ApiTags('Waiter Fulfillment')
@ApiCookieAuth()
@UseGuards(JwtAuthGuard, RolesGuard, BranchScopeGuard)
@Controller('branches/:branchId')
@BranchScoped()
export class WaiterController {
  constructor(
    @Inject(WaiterService)
    private readonly waiterService: WaiterService,
  ) {}

  @Get('service-board')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.CASHIER, TenantRole.WAITER)
  @ApiOperation({ summary: 'Get the waiter service board' })
  async getServiceBoard(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Query() query: ServiceBoardQueryDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const board = await this.waiterService.getServiceBoard({
      tenantId: ctx.tenantId!,
      branchId,
      waiterUserId: ctx.userId,
      scope: query.scope ?? 'mine',
      status: query.status,
      updatedAfter: query.updatedAfter,
      limit: query.limit,
      after: query.after,
    });
    return { data: board };
  }

  @Post('orders/:orderId/assign-waiter')
  @HttpCode(HttpStatus.OK)
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Assign a waiter to an order' })
  async assignWaiter(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('orderId') orderId: string,
    @Body() dto: AssignWaiterDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const result = await this.waiterService.assignWaiter({
      tenantId: ctx.tenantId!,
      branchId,
      orderId,
      waiterUserId: dto.waiterUserId,
      actorUserId: ctx.userId,
      tenantRole: ctx.tenantRole!,
    });
    return { data: result };
  }

  @Post('orders/:orderId/claim')
  @HttpCode(HttpStatus.OK)
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.WAITER)
  @ApiOperation({ summary: 'Claim an unassigned order (waiter self-claim)' })
  async claimOrder(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('orderId') orderId: string,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const result = await this.waiterService.claimOrder({
      tenantId: ctx.tenantId!,
      branchId,
      orderId,
      actorUserId: ctx.userId,
      tenantRole: ctx.tenantRole!,
    });
    return { data: result };
  }

  @Post('orders/:orderId/collect')
  @HttpCode(HttpStatus.OK)
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.CASHIER, TenantRole.WAITER)
  @ApiOperation({ summary: 'Collect ready work for an order' })
  async collectOrder(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('orderId') orderId: string,
    @Body() body: CollectOrderDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const result = await this.waiterService.collectOrder({
      tenantId: ctx.tenantId!,
      branchId,
      orderId,
      actorUserId: ctx.userId,
      expectedVersion: body.expectedVersion,
    });
    return { data: result };
  }

  @Post('orders/:orderId/serve')
  @HttpCode(HttpStatus.OK)
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.CASHIER, TenantRole.WAITER)
  @ApiOperation({ summary: 'Mark an order as served' })
  async serveOrder(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('orderId') orderId: string,
    @Body() dto: ServeOrderDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const result = await this.waiterService.serveOrder({
      tenantId: ctx.tenantId!,
      branchId,
      orderId,
      actorUserId: ctx.userId,
      expectedVersion: dto.expectedVersion,
    });
    return { data: result };
  }

  @Post('orders/:orderId/serve-lines')
  @HttpCode(HttpStatus.OK)
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.CASHIER, TenantRole.WAITER)
  @ApiOperation({ summary: 'Serve specific lines of an order (partial service)' })
  async serveLines(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('orderId') orderId: string,
    @Body() dto: ServeLinesDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const result = await this.waiterService.serveLines({
      tenantId: ctx.tenantId!,
      branchId,
      orderId,
      lineIds: dto.lineIds,
      actorUserId: ctx.userId,
      expectedVersion: dto.expectedVersion,
    });
    return { data: result };
  }
}
