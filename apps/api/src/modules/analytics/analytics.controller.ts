import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
  Inject,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { TenantRole } from '@rms/contracts';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { FeatureEnabledGuard } from '../features/feature-enabled.guard';
import { FeatureEnabled } from '../features/feature-enabled.decorator';
import { Roles } from '../auth/types';
import type { TenantContext } from '../auth/types';
import { FeatureKey } from '@rms/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- DTOs need runtime import for ValidationPipe
import {
  ReportQueryDto,
  BestSellersQueryDto,
  InventoryConsumptionQueryDto,
} from './dto';

@ApiTags('Analytics')
@ApiCookieAuth()
@UseGuards(JwtAuthGuard, RolesGuard, FeatureEnabledGuard)
@Controller('reports')
export class AnalyticsController {
  constructor(
    @Inject(AnalyticsService) private readonly analytics: AnalyticsService,
  ) {}

  private ctx(req: Request): TenantContext {
    return req.tenantContext as TenantContext;
  }

  @Get('revenue')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @FeatureEnabled(FeatureKey.ANALYTICS)
  @ApiOperation({ summary: 'Revenue summary by day' })
  async revenue(@Req() req: Request, @Query() query: ReportQueryDto) {
    const c = this.ctx(req);
    const data = await this.analytics.revenueSummary(
      c.tenantId!,
      c.tenantRole,
      c.branchIds,
      query,
    );
    return { data };
  }

  @Get('revenue-by-method')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @FeatureEnabled(FeatureKey.ANALYTICS)
  @ApiOperation({ summary: 'Revenue breakdown by payment method' })
  async revenueByMethod(@Req() req: Request, @Query() query: ReportQueryDto) {
    const c = this.ctx(req);
    const data = await this.analytics.revenueByPaymentMethod(
      c.tenantId!,
      c.tenantRole,
      c.branchIds,
      query,
    );
    return { data };
  }

  @Get('orders')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @FeatureEnabled(FeatureKey.ANALYTICS)
  @ApiOperation({ summary: 'Order count, averages, cancellations, voids' })
  async orderStats(@Req() req: Request, @Query() query: ReportQueryDto) {
    const c = this.ctx(req);
    const data = await this.analytics.orderStats(
      c.tenantId!,
      c.tenantRole,
      c.branchIds,
      query,
    );
    return { data };
  }

  @Get('best-sellers')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @FeatureEnabled(FeatureKey.ANALYTICS)
  @ApiOperation({ summary: 'Best-selling menu items and variants' })
  async bestSellers(@Req() req: Request, @Query() query: BestSellersQueryDto) {
    const c = this.ctx(req);
    const data = await this.analytics.bestSellers(
      c.tenantId!,
      c.tenantRole,
      c.branchIds,
      query,
    );
    return { data };
  }

  @Get('peak-hours')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @FeatureEnabled(FeatureKey.ANALYTICS)
  @ApiOperation({ summary: 'Peak operational hours by order volume and revenue' })
  async peakHours(@Req() req: Request, @Query() query: ReportQueryDto) {
    const c = this.ctx(req);
    const data = await this.analytics.peakHours(
      c.tenantId!,
      c.tenantRole,
      c.branchIds,
      query,
    );
    return { data };
  }

  @Get('inventory-consumption')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @FeatureEnabled(FeatureKey.ANALYTICS)
  @ApiOperation({ summary: 'Inventory consumption by item and movement type' })
  async inventoryConsumption(
    @Req() req: Request,
    @Query() query: InventoryConsumptionQueryDto,
  ) {
    const c = this.ctx(req);
    const data = await this.analytics.inventoryConsumption(
      c.tenantId!,
      c.tenantRole,
      c.branchIds,
      query,
    );
    return { data };
  }

  @Get('low-stock')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @FeatureEnabled(FeatureKey.ANALYTICS)
  @ApiOperation({ summary: 'Low-stock item snapshot' })
  async lowStock(@Req() req: Request, @Query() query: ReportQueryDto) {
    const c = this.ctx(req);
    const data = await this.analytics.lowStockSnapshot(
      c.tenantId!,
      c.tenantRole,
      c.branchIds,
      query,
    );
    return { data };
  }
}
