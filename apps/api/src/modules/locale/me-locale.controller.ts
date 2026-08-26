import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  UseGuards,
  Inject,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TenantRole } from '@rms/contracts';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/types';
import { LocaleService } from './locale.service';
import type { TenantContext } from '../auth/types';
import type { Request } from 'express';

@ApiTags('User Preferences')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('me')
export class MeLocaleController {
  constructor(@Inject(LocaleService) private readonly localeService: LocaleService) {}

  @Get('preferences/locale')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.CASHIER, TenantRole.KITCHEN_STAFF, TenantRole.WAITER)
  @ApiOperation({ summary: 'Get current user preferred locale' })
  async getLocalePreference(@Req() req: Request) {
    const ctx = req.tenantContext as TenantContext;
    const locale = await this.localeService.getUserPreferredLocale(ctx.tenantId!, ctx.userId!);
    return { data: { locale } };
  }

  @Post('preferences/locale')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.CASHIER, TenantRole.KITCHEN_STAFF, TenantRole.WAITER)
  @ApiOperation({ summary: 'Set current user preferred locale' })
  async setLocalePreference(
    @Req() req: Request,
    @Body() body: { locale: string | null },
  ) {
    const ctx = req.tenantContext as TenantContext;
    await this.localeService.setUserPreferredLocale(ctx.tenantId!, ctx.userId!, body.locale as any);
    return { data: { locale: body.locale } };
  }
}
