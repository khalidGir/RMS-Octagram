import {
  Controller, Get, Post, Patch, Body, Param, Inject, UseGuards, Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { TenantRole } from '@rms/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { TablesService } from './tables.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { DiningSessionService } from './dining-session.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { BranchScopeGuard } from '../auth/branch-scope.guard';
import { Roles, BranchScoped, type TenantContext } from '../auth/types';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- DTOs must be value imports for class-validator decorator metadata
import {
  CreateDiningAreaDto,
  UpdateDiningAreaDto,
  CreateTableDto,
  UpdateTableDto,
  RotateQrTokenDto,
  ClearSessionDto,
} from './dto';

@ApiTags('Tables')
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard, BranchScopeGuard)
@ApiCookieAuth()
export class TablesController {
  constructor(
    @Inject(TablesService) private readonly tables: TablesService,
    @Inject(DiningSessionService) private readonly sessions: DiningSessionService,
  ) {}

  // ─── Dining Areas ──────────────────────────

  @Get('branches/:branchId/dining-areas')
  @BranchScoped()
  @ApiOperation({ summary: 'List dining areas' })
  async listAreas(@Req() req: Request, @Param('branchId') branchId: string) {
    const ctx = req.tenantContext as TenantContext;
    return { data: await this.tables.listDiningAreas(ctx.tenantId!, branchId) };
  }

  @Post('branches/:branchId/dining-areas')
  @BranchScoped()
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Create dining area' })
  async createArea(@Req() req: Request, @Param('branchId') branchId: string, @Body() body: CreateDiningAreaDto) {
    const ctx = req.tenantContext as TenantContext;
    return { data: await this.tables.createDiningArea(ctx.tenantId!, branchId, body) };
  }

  @Patch('branches/:branchId/dining-areas/:areaId')
  @BranchScoped()
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Update dining area' })
  async updateArea(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('areaId') areaId: string,
    @Body() body: UpdateDiningAreaDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    return { data: await this.tables.updateDiningArea(areaId, ctx.tenantId!, branchId, body) };
  }

  // ─── Tables ────────────────────────────────

  @Get('branches/:branchId/tables')
  @BranchScoped()
  @ApiOperation({ summary: 'List tables' })
  async listTables(@Req() req: Request, @Param('branchId') branchId: string) {
    const ctx = req.tenantContext as TenantContext;
    const diningAreaId = (req.query.diningAreaId as string) || undefined;
    return { data: await this.tables.listTables(ctx.tenantId!, branchId, diningAreaId) };
  }

  @Get('branches/:branchId/tables/:tableId')
  @BranchScoped()
  @ApiOperation({ summary: 'Get table details' })
  async getTable(@Req() req: Request, @Param('branchId') branchId: string, @Param('tableId') tableId: string) {
    const ctx = req.tenantContext as TenantContext;
    return { data: await this.tables.getTable(tableId, ctx.tenantId!, branchId) };
  }

  @Post('branches/:branchId/tables')
  @BranchScoped()
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Create table' })
  async createTable(@Req() req: Request, @Param('branchId') branchId: string, @Body() body: CreateTableDto) {
    const ctx = req.tenantContext as TenantContext;
    return { data: await this.tables.createTable(ctx.tenantId!, branchId, body) };
  }

  @Patch('branches/:branchId/tables/:tableId')
  @BranchScoped()
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Update table' })
  async updateTable(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('tableId') tableId: string,
    @Body() body: UpdateTableDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    return { data: await this.tables.updateTable(tableId, ctx.tenantId!, branchId, body) };
  }

  // ─── QR Token ──────────────────────────────

  @Get('branches/:branchId/tables/:tableId/qr-token')
  @BranchScoped()
  @ApiOperation({ summary: 'Get active QR token (metadata only, no hash)' })
  async getQrToken(@Req() req: Request, @Param('branchId') branchId: string, @Param('tableId') tableId: string) {
    const ctx = req.tenantContext as TenantContext;
    return { data: await this.tables.getActiveToken(tableId, ctx.tenantId!, branchId) };
  }

  @Post('branches/:branchId/tables/:tableId/qr-token/rotate')
  @BranchScoped()
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Rotate QR token (revoke previous)' })
  async rotateQrToken(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('tableId') tableId: string,
    @Body() body: RotateQrTokenDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    return { data: await this.tables.generateQrToken(tableId, ctx.tenantId!, branchId, body.reason, ctx.userId) };
  }

  @Get('branches/:branchId/tables/:tableId/qr-token/history')
  @BranchScoped()
  @ApiOperation({ summary: 'List QR token versions (no hashes)' })
  async listTokenHistory(@Req() req: Request, @Param('branchId') branchId: string, @Param('tableId') tableId: string) {
    const ctx = req.tenantContext as TenantContext;
    return { data: await this.tables.listTokens(tableId, ctx.tenantId!, branchId) };
  }

  // ─── Table Operations & Sessions ──────────

  @Get('branches/:branchId/table-operations')
  @BranchScoped()
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.CASHIER, TenantRole.WAITER)
  @ApiOperation({ summary: 'Table occupancy and ready-order projection' })
  async getTableOperations(@Req() req: Request, @Param('branchId') branchId: string) {
    const ctx = req.tenantContext as TenantContext;
    const occupancy = await this.sessions.getTableOccupancy({ tenantId: ctx.tenantId!, branchId });
    return { data: occupancy };
  }

  @Get('branches/:branchId/sessions')
  @BranchScoped()
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.CASHIER, TenantRole.WAITER)
  @ApiOperation({ summary: 'List open dining sessions' })
  async listSessions(@Req() req: Request, @Param('branchId') branchId: string) {
    const ctx = req.tenantContext as TenantContext;
    return { data: await this.sessions.listOpenSessions({ tenantId: ctx.tenantId!, branchId }) };
  }

  @Get('branches/:branchId/sessions/:sessionId')
  @BranchScoped()
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.CASHIER, TenantRole.WAITER)
  @ApiOperation({ summary: 'Get session details with linked orders' })
  async getSession(@Req() req: Request, @Param('branchId') branchId: string, @Param('sessionId') sessionId: string) {
    const ctx = req.tenantContext as TenantContext;
    return { data: await this.sessions.getSession({ tenantId: ctx.tenantId!, branchId, sessionId }) };
  }

  @Post('branches/:branchId/sessions/:sessionId/clear')
  @BranchScoped()
  @Roles(TenantRole.OWNER, TenantRole.WAITER)
  @ApiOperation({ summary: 'Clear a dining session (all orders must be terminal)' })
  async clearSession(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('sessionId') sessionId: string,
    @Body() body: ClearSessionDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const result = await this.sessions.clearSession({
      tenantId: ctx.tenantId!,
      branchId,
      sessionId,
      actorUserId: ctx.userId!,
      clearReason: body.clearReason,
      expectedVersion: body.expectedVersion,
    });
    return { data: result };
  }

  @Post('orders/:orderId/complete')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.CASHIER, TenantRole.WAITER)
  @ApiOperation({ summary: 'Complete a READY order (serve/deliver)' })
  async completeOrder(
    @Req() req: Request,
    @Param('orderId') orderId: string,
  ) {
    const ctx = req.tenantContext as TenantContext;
    // Delegate to orders service for status transition
    // This will be implemented when we wire up the order completion flow
    return { data: { orderId, status: 'COMPLETED', completedBy: ctx.userId } };
  }
}
