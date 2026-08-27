import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  UseGuards,
  Inject,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TenantRole } from '@rms/contracts';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/types';
import { TaxConfigService } from './tax-config.service';
import type { TenantContext } from '../auth/types';
import type { Request } from 'express';

@ApiTags('Tax Configuration')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('tax-config')
export class TaxConfigController {
  constructor(@Inject(TaxConfigService) private readonly taxConfigService: TaxConfigService) {}

  @Get()
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Get active tax configuration for current tenant' })
  async getActiveConfig(@Req() req: Request) {
    const ctx = req.tenantContext as TenantContext;
    const config = await this.taxConfigService.getActiveConfig(ctx.tenantId!);
    return { data: config };
  }

  @Get('history')
  @Roles(TenantRole.OWNER)
  @ApiOperation({ summary: 'Get tax configuration history for current tenant' })
  async getConfigHistory(@Req() req: Request) {
    const ctx = req.tenantContext as TenantContext;
    const configs = await this.taxConfigService.getConfigHistory(ctx.tenantId!);
    return { data: configs };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(TenantRole.OWNER)
  @ApiOperation({ summary: 'Create a new tax configuration (owner only, current tenant)' })
  async createConfig(
    @Req() req: Request,
    @Body() body: {
      vatApplicable: boolean;
      vatRate: number;
      roundingMode?: string;
      effectiveFrom: string;
      effectiveUntil?: string;
      confirmedBy?: string;
      confirmationNote?: string;
    },
  ) {
    const ctx = req.tenantContext as TenantContext;
    const config = await this.taxConfigService.createConfig({
      tenantId: ctx.tenantId!,
      vatApplicable: body.vatApplicable,
      vatRate: body.vatRate,
      roundingMode: body.roundingMode,
      effectiveFrom: new Date(body.effectiveFrom),
      effectiveUntil: body.effectiveUntil ? new Date(body.effectiveUntil) : undefined,
      confirmedBy: body.confirmedBy,
      confirmationNote: body.confirmationNote,
      createdByUserId: ctx.userId!,
    });
    return { data: config };
  }
}
