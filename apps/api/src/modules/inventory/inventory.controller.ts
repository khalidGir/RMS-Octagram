import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { FeatureEnabledGuard } from '../features/feature-enabled.guard';
import { FeatureEnabled } from '../features/feature-enabled.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { BranchScopeGuard } from '../auth/branch-scope.guard';
import { BranchScoped, Roles } from '../auth/types';
import { TenantRole, FeatureKey } from '@rms/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { InventoryItemsService } from './inventory-items.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { InventoryBatchesService } from './inventory-batches.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { InventoryMovementsService } from './inventory-movements.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { InventoryDeductionService } from './inventory-deduction.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import {
  CreateInventoryItemDto,
  UpdateInventoryItemDto,
  ReceiveBatchDto,
  CreateAdjustmentDto,
  CreateWasteDto,
  MovementQueryDto,
  AlertsQueryDto,
  InventoryItemsQueryDto,
} from './dto';
import type { Request } from 'express';
import { Req } from '@nestjs/common';

@ApiTags('Inventory')
@ApiCookieAuth()
@UseGuards(JwtAuthGuard, RolesGuard, BranchScopeGuard, FeatureEnabledGuard)
@Controller('branches/:branchId/inventory')
@BranchScoped()
export class InventoryController {
  constructor(
    @Inject(InventoryItemsService)
    private readonly itemsService: InventoryItemsService,
    @Inject(InventoryBatchesService)
    private readonly batchesService: InventoryBatchesService,
    @Inject(InventoryMovementsService)
    private readonly movementsService: InventoryMovementsService,
    @Inject(InventoryDeductionService)
    private readonly deductionService: InventoryDeductionService,
  ) {}

  // ─── Inventory Items ──────────────────────

  @Post('items')
  @FeatureEnabled(FeatureKey.INVENTORY)
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an inventory item' })
  async createItem(
    @Param('branchId') branchId: string,
    @Body() dto: CreateInventoryItemDto,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantContext?.tenantId;
    const actorUserId = (req as any).user?.id;
    return this.itemsService.createItem({
      tenantId,
      branchId,
      ...dto,
      actorUserId,
    });
  }

  @Get('items')
  @FeatureEnabled(FeatureKey.INVENTORY)
  @ApiOperation({ summary: 'List inventory items' })
  async listItems(
    @Param('branchId') branchId: string,
    @Query() query: InventoryItemsQueryDto,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantContext?.tenantId;
    return this.itemsService.listItems({
      tenantId,
      branchId,
      ...query,
    });
  }

  @Patch('items/:itemId')
  @FeatureEnabled(FeatureKey.INVENTORY)
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Update an inventory item' })
  async updateItem(
    @Param('branchId') branchId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateInventoryItemDto,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantContext?.tenantId;
    const actorUserId = (req as any).user?.id;
    return this.itemsService.updateItem({
      tenantId,
      branchId,
      itemId,
      ...dto,
      actorUserId,
    });
  }

  // ─── Batch Receiving ──────────────────────

  @Post('items/:itemId/batches')
  @FeatureEnabled(FeatureKey.BATCH_INVENTORY)
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Receive a batch for an inventory item' })
  async receiveBatch(
    @Param('branchId') branchId: string,
    @Param('itemId') itemId: string,
    @Body() dto: ReceiveBatchDto,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantContext?.tenantId;
    const actorUserId = (req as any).user?.id;
    return this.batchesService.receiveBatch({
      tenantId,
      branchId,
      inventoryItemId: itemId,
      ...dto,
      actorUserId,
    });
  }

  // ─── Movement Ledger ──────────────────────

  @Get('items/:itemId/movements')
  @FeatureEnabled(FeatureKey.INVENTORY)
  @ApiOperation({ summary: 'List inventory movements' })
  async listMovements(
    @Param('branchId') branchId: string,
    @Param('itemId') itemId: string,
    @Query() query: MovementQueryDto,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantContext?.tenantId;
    return this.movementsService.listMovements({
      tenantId,
      branchId,
      inventoryItemId: itemId,
      ...query,
    });
  }

  // ─── Adjustments ──────────────────────────

  @Post('items/:itemId/adjustments')
  @FeatureEnabled(FeatureKey.INVENTORY)
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record a stock adjustment' })
  async createAdjustment(
    @Param('branchId') branchId: string,
    @Param('itemId') itemId: string,
    @Body() dto: CreateAdjustmentDto,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantContext?.tenantId;
    const actorUserId = (req as any).user?.id;
    return this.deductionService.adjustWithTransaction({
      tenantId,
      branchId,
      inventoryItemId: itemId,
      ...dto,
      actorUserId,
    });
  }

  // ─── Waste ────────────────────────────────

  @Post('items/:itemId/waste')
  @FeatureEnabled(FeatureKey.INVENTORY)
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record waste' })
  async createWaste(
    @Param('branchId') branchId: string,
    @Param('itemId') itemId: string,
    @Body() dto: CreateWasteDto,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantContext?.tenantId;
    const actorUserId = (req as any).user?.id;
    return this.deductionService.wasteWithTransaction({
      tenantId,
      branchId,
      inventoryItemId: itemId,
      ...dto,
      actorUserId,
    });
  }

  // ─── Low-Stock Alerts ────────────────────

  @Get('alerts')
  @FeatureEnabled(FeatureKey.INVENTORY)
  @ApiOperation({ summary: 'Get low-stock alerts' })
  async getAlerts(
    @Param('branchId') branchId: string,
    @Query() query: AlertsQueryDto,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantContext?.tenantId;
    return this.itemsService.getLowStockAlerts({
      tenantId,
      branchId,
      ...query,
    });
  }
}
