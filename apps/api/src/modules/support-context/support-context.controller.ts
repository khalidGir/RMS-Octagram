import { Controller, Get, Post, Body, Query, Req, HttpCode, HttpStatus, Inject, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Roles, type TenantContext } from '../auth/types';
import { PlatformRole } from '@rms/contracts';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { SupportContextService } from './support-context.service';

class EnterSupportDto {
  @ApiProperty({ description: 'Tenant ID to support' })
  @IsString()
  tenantId!: string;

  @ApiProperty({ description: 'Reason for support access (500 chars max)' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

class ExitSupportDto {
  @ApiProperty({ description: 'Tenant ID to exit support for' })
  @IsString()
  tenantId!: string;
}

@ApiTags('Support Context')
@Controller('platform/support')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(PlatformRole.SUPER_ADMIN)
export class SupportContextController {
  constructor(
    @Inject(SupportContextService) private readonly supportContextService: SupportContextService,
  ) {}

  @Post('enter')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enter support mode for a tenant (menu-only, 30-min time-bound)' })
  async enterSupport(
    @Req() req: Request,
    @Body() dto: EnterSupportDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const session = await this.supportContextService.enterSupport({
      adminUserId: ctx.userId,
      tenantId: dto.tenantId,
      reason: dto.reason,
    });
    return { data: session };
  }

  @Post('exit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exit support mode' })
  async exitSupport(
    @Req() req: Request,
    @Body() dto: ExitSupportDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const session = await this.supportContextService.exitSupport({
      adminUserId: ctx.userId,
      tenantId: dto.tenantId,
    });
    return { data: session };
  }

  @Get('active')
  @ApiOperation({ summary: 'Check if current admin has an active support session for a tenant' })
  async getActiveSession(
    @Req() req: Request,
    @Query('tenantId') tenantId: string,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const session = await this.supportContextService.getActiveSession({
      adminUserId: ctx.userId,
      tenantId,
    });
    return { data: session };
  }
}
