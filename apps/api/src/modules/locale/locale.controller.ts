import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
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
import { LocaleService } from './locale.service';
import type { TenantContext } from '../auth/types';
import type { Request } from 'express';

@ApiTags('Locale & Translations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('locale')
export class LocaleController {
  constructor(@Inject(LocaleService) private readonly localeService: LocaleService) {}

  @Get('default')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Get tenant default locale' })
  async getDefaultLocale(@Req() req: Request) {
    const ctx = req.tenantContext as TenantContext;
    const locale = await this.localeService.getTenantDefaultLocale(ctx.tenantId!);
    return { data: { locale } };
  }

  @Post('default')
  @Roles(TenantRole.OWNER)
  @ApiOperation({ summary: 'Set tenant default locale (owner only)' })
  async setDefaultLocale(
    @Req() req: Request,
    @Body() body: { locale: string },
  ) {
    const ctx = req.tenantContext as TenantContext;
    await this.localeService.setTenantDefaultLocale(ctx.tenantId!, body.locale as any);
    return { data: { locale: body.locale } };
  }

  @Get('menu-translations/:menuItemId')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Get translations for a menu item' })
  async getMenuItemTranslations(
    @Req() req: Request,
    @Param('menuItemId') menuItemId: string,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const translations = await this.localeService.getMenuItemTranslations(ctx.tenantId!, menuItemId);
    return { data: translations };
  }

  @Post('menu-translations/:menuItemId')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Upsert a menu item translation' })
  async upsertTranslation(
    @Req() req: Request,
    @Param('menuItemId') menuItemId: string,
    @Body() body: { locale: string; name: string; description?: string },
  ) {
    const ctx = req.tenantContext as TenantContext;
    const translation = await this.localeService.upsertMenuItemTranslation({
      tenantId: ctx.tenantId!,
      menuItemId,
      locale: body.locale,
      name: body.name,
      description: body.description,
    });
    return { data: translation };
  }

  @Delete('menu-translations/:menuItemId/:locale')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a menu item translation' })
  async deleteTranslation(
    @Req() req: Request,
    @Param('menuItemId') menuItemId: string,
    @Param('locale') locale: string,
  ) {
    const ctx = req.tenantContext as TenantContext;
    await this.localeService.deleteMenuItemTranslation(ctx.tenantId!, menuItemId, locale);
  }
}
