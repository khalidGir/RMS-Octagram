import { Controller, Get, Post, Body, Param, Inject } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI requires value import for decorator metadata
import { PublicMenuService } from './public-menu.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PublicContextService } from './public-context.service';

class ResolveTableContextDto {
  @ApiProperty({ description: 'QR token from printed label' })
  @IsString()
  token!: string;
}

@ApiTags('Public Menu')
@Controller('public')
export class PublicMenuController {
  constructor(
    @Inject(PublicMenuService) private readonly publicMenu: PublicMenuService,
    @Inject(PublicContextService) private readonly publicContext: PublicContextService,
  ) {}

  // ─── Public Restaurant Slug ──────────────────────

  @Get('restaurants/:publicSlug')
  @ApiOperation({ summary: 'Resolve public restaurant slug to safe context' })
  async resolvePublicSlug(@Param('publicSlug') publicSlug: string) {
    return { data: await this.publicContext.resolvePublicSlug(publicSlug) };
  }

  @Get('restaurants/:publicSlug/menu')
  @ApiOperation({ summary: 'Get pickup-only menu for public slug' })
  async getPublicMenu(@Param('publicSlug') publicSlug: string) {
    const ctx = await this.publicContext.resolvePublicSlug(publicSlug);
    // Return menu scoped to the resolved branch, pickup-only
    const menu = await this.publicMenu.getBranchMenu(ctx.branch.id, ctx.tenant.id);
    return { data: { ...menu, context: ctx } };
  }

  // ─── Table QR Context ────────────────────────────

  @Post('table-context/resolve')
  @ApiOperation({ summary: 'Resolve QR token to table context (public, unauthenticated)' })
  async resolveTableContext(@Body() body: ResolveTableContextDto) {
    return { data: await this.publicContext.resolveQrToken(body.token) };
  }

  // ─── Legacy endpoints (backward compat) ──────────

  @Get('tenants/:tenantId/branches/:branchId/menu')
  @ApiOperation({ summary: 'Get branch menu (legacy path)' })
  async getMenu(@Param('tenantId') tenantId: string, @Param('branchId') branchId: string) {
    return { data: await this.publicMenu.getBranchMenu(branchId, tenantId) };
  }

  @Post('tenants/:tenantId/table-context')
  @ApiOperation({ summary: 'Resolve table context from QR token (legacy path)' })
  async getTableContext(@Param('tenantId') tenantId: string, @Body() body: ResolveTableContextDto) {
    return { data: await this.publicMenu.resolveTableContext(body.token, tenantId) };
  }
}
