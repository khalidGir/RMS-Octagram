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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import type { Request } from 'express';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { KitchenTicketsService } from './kitchen-tickets.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { BranchScopeGuard } from '../auth/branch-scope.guard';
import { Roles, BranchScoped, type TenantContext } from '../auth/types';
import { TenantRole } from '@rms/contracts';
import { TicketQueryDto, BumpTicketDto, RecallTicketDto } from './dto';

@ApiTags('Kitchen Tickets')
@ApiCookieAuth()
@UseGuards(JwtAuthGuard, RolesGuard, BranchScopeGuard)
@Controller('branches/:branchId/kitchen-tickets')
@BranchScoped()
export class KitchenTicketsController {
  constructor(
    @Inject(KitchenTicketsService)
    private readonly ticketsService: KitchenTicketsService,
  ) {}

  @Get()
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.CASHIER, TenantRole.KITCHEN_STAFF)
  @ApiOperation({ summary: 'List kitchen tickets (KDS queue)' })
  async listTickets(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Query() query: TicketQueryDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const tickets = await this.ticketsService.listTickets({
      tenantId: ctx.tenantId!,
      branchId,
      stationId: query.stationId,
      status: query.status,
      limit: query.limit,
      after: query.after,
    });
    return { data: tickets };
  }

  @Get(':ticketId')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.CASHIER, TenantRole.KITCHEN_STAFF)
  @ApiOperation({ summary: 'Get a kitchen ticket with details' })
  async getTicket(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('ticketId') ticketId: string,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const ticket = await this.ticketsService.getTicket({
      tenantId: ctx.tenantId!,
      branchId,
      ticketId,
    });
    return { data: ticket };
  }

  @Post(':ticketId/bump')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.CASHIER, TenantRole.KITCHEN_STAFF)
  @ApiOperation({ summary: 'Bump ticket forward (QUEUED→IN_PROGRESS→READY)' })
  async bumpTicket(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('ticketId') ticketId: string,
    @Body() dto: BumpTicketDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const ticket = await this.ticketsService.bumpTicket({
      tenantId: ctx.tenantId!,
      branchId,
      ticketId,
      actorUserId: ctx.userId,
      reason: dto.reason,
      expectedVersion: dto.expectedVersion,
    });
    return { data: ticket };
  }

  @Post(':ticketId/recall')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.CASHIER, TenantRole.KITCHEN_STAFF)
  @ApiOperation({ summary: 'Recall a READY ticket back to IN_PROGRESS' })
  async recallTicket(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('ticketId') ticketId: string,
    @Body() dto: RecallTicketDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const ticket = await this.ticketsService.recallTicket({
      tenantId: ctx.tenantId!,
      branchId,
      ticketId,
      actorUserId: ctx.userId,
      reason: dto.reason,
      expectedVersion: dto.expectedVersion,
    });
    return { data: ticket };
  }

  @Post(':ticketId/complete')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.CASHIER, TenantRole.KITCHEN_STAFF)
  @ApiOperation({ summary: 'Mark ticket COMPLETED' })
  async completeTicket(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('ticketId') ticketId: string,
    @Body() body: { expectedVersion: number },
  ) {
    const ctx = req.tenantContext as TenantContext;
    const ticket = await this.ticketsService.completeTicket({
      tenantId: ctx.tenantId!,
      branchId,
      ticketId,
      actorUserId: ctx.userId,
      expectedVersion: body.expectedVersion,
    });
    return { data: ticket };
  }

  @Post(':ticketId/cancel')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Cancel a kitchen ticket' })
  async cancelTicket(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('ticketId') ticketId: string,
    @Body() body: { expectedVersion: number; reason?: string },
  ) {
    const ctx = req.tenantContext as TenantContext;
    const ticket = await this.ticketsService.cancelTicket({
      tenantId: ctx.tenantId!,
      branchId,
      ticketId,
      actorUserId: ctx.userId,
      reason: body.reason,
      expectedVersion: body.expectedVersion,
    });
    return { data: ticket };
  }
}
