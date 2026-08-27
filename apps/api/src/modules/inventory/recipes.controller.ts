import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
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
import { RecipesService } from './recipes.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { UpsertRecipeDto } from './dto';
import type { Request } from 'express';
import { Req } from '@nestjs/common';

@ApiTags('Recipes')
@ApiCookieAuth()
@UseGuards(JwtAuthGuard, RolesGuard, BranchScopeGuard, FeatureEnabledGuard)
@Controller('branches/:branchId/catalog/variants/:variantId')
@BranchScoped()
export class RecipesController {
  constructor(
    @Inject(RecipesService)
    private readonly recipesService: RecipesService,
  ) {}

  @Get('recipe')
  @FeatureEnabled(FeatureKey.INVENTORY)
  @ApiOperation({ summary: 'Get recipe for a menu item variant' })
  async getRecipe(
    @Param('branchId') branchId: string,
    @Param('variantId') variantId: string,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantContext?.tenantId;
    return this.recipesService.getRecipe({ tenantId, branchId, variantId });
  }

  @Patch('recipe')
  @FeatureEnabled(FeatureKey.INVENTORY)
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Create or update recipe for a menu item variant' })
  async upsertRecipe(
    @Param('branchId') branchId: string,
    @Param('variantId') variantId: string,
    @Body() dto: UpsertRecipeDto,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantContext?.tenantId;
    const actorUserId = (req as any).user?.id;
    return this.recipesService.upsertRecipe({
      tenantId,
      branchId,
      variantId,
      ...dto,
      actorUserId,
    });
  }
}
