import { Controller, Get, Post, Body, Param, Req, HttpCode, HttpStatus, Inject, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { IsString, IsBoolean, IsOptional, MinLength, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Roles } from '../auth/types';
import type { TenantContext } from '../auth/types';
import { TenantRole } from '@rms/contracts';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { BusinessDayService } from './business-day.service';

class CloseBusinessDayDto {
  @ApiPropertyOptional({ description: 'Close with exception (bypasses blockers)' })
  @IsOptional()
  @IsBoolean()
  closedWithException?: boolean;

  @ApiPropertyOptional({ description: 'Reason (required for exception close, 500 chars max)' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason?: string;
}

class ReopenBusinessDayDto {
  @ApiProperty({ description: 'Reason for reopening (required, 500 chars max)' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

@ApiTags('Business Day')
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class BusinessDayController {
  constructor(@Inject(BusinessDayService) private readonly businessDayService: BusinessDayService) {}

  @Get('branches/:branchId/day-close/preview')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Preview business day reconciliation' })
  async preview(
    @Req() req: Request,
    @Param('branchId') branchId: string,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const localBusinessDate = (req.query.localBusinessDate as string) || undefined;
    const data = await this.businessDayService.preview({
      tenantId: ctx.tenantId!,
      branchId,
      localBusinessDate,
    });
    return { data };
  }

  @Post('branches/:branchId/day-close/close')
  @Roles(TenantRole.OWNER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Close business day (Owner only)' })
  async close(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Body() dto: CloseBusinessDayDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const localBusinessDate = (req.query.localBusinessDate as string) || undefined;

    // Get branch to compute current business date if not specified
    const preview = await this.businessDayService.preview({
      tenantId: ctx.tenantId!,
      branchId,
      localBusinessDate,
    });

    const result = await this.businessDayService.close({
      tenantId: ctx.tenantId!,
      branchId,
      localBusinessDate: preview.localBusinessDate,
      closedWithException: dto.closedWithException,
      reason: dto.reason,
      actorUserId: ctx.userId,
    });

    return result;
  }

  @Post('branches/:branchId/day-close/reopen')
  @Roles(TenantRole.OWNER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reopen closed business day (Owner only)' })
  async reopen(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Body() dto: ReopenBusinessDayDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const localBusinessDate = (req.query.localBusinessDate as string) || undefined;

    const preview = await this.businessDayService.preview({
      tenantId: ctx.tenantId!,
      branchId,
      localBusinessDate,
    });

    const result = await this.businessDayService.reopen({
      tenantId: ctx.tenantId!,
      branchId,
      localBusinessDate: preview.localBusinessDate,
      reason: dto.reason,
      actorUserId: ctx.userId,
    });

    return result;
  }

  @Get('branches/:branchId/day-close/report')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Get printable business day report data' })
  async report(
    @Req() req: Request,
    @Param('branchId') branchId: string,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const localBusinessDate = (req.query.localBusinessDate as string) || undefined;

    const preview = await this.businessDayService.preview({
      tenantId: ctx.tenantId!,
      branchId,
      localBusinessDate,
    });

    const snapshot = await this.businessDayService.getReport({
      tenantId: ctx.tenantId!,
      branchId,
      localBusinessDate: preview.localBusinessDate,
    });

    return { data: snapshot };
  }

  @Get('branches/:branchId/day-close/current')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Get current close record for business day' })
  async current(
    @Req() req: Request,
    @Param('branchId') branchId: string,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const localBusinessDate = (req.query.localBusinessDate as string) || undefined;

    const preview = await this.businessDayService.preview({
      tenantId: ctx.tenantId!,
      branchId,
      localBusinessDate,
    });

    const result = await this.businessDayService.getClose({
      tenantId: ctx.tenantId!,
      branchId,
      localBusinessDate: preview.localBusinessDate,
    });

    return { data: result };
  }
}
