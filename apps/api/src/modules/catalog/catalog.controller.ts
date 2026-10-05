import {
  Controller, Get, Post, Patch, Delete, Put, Body, Param, Inject, UseGuards, Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { TenantRole } from '@rms/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { CatalogService } from './catalog.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { BranchScopeGuard } from '../auth/branch-scope.guard';
import { Roles, BranchScoped, type TenantContext } from '../auth/types';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- DTOs must be value imports for class-validator decorator metadata
import {
  CreateCategoryDto,
  UpdateCategoryDto,
  CreateItemDto,
  UpdateItemDto,
  CreateVariantDto,
  UpdateVariantDto,
  CreateModifierGroupDto,
  CreateModifierOptionDto,
  SetBranchAvailabilityDto,
  LinkModifierGroupDto,
} from './dto';

@ApiTags('Catalog')
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard, BranchScopeGuard)
@ApiCookieAuth()
export class CatalogController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}

  // ─── Categories ────────────────────────────

  @Get('categories')
  @ApiOperation({ summary: 'List categories' })
  async listCategories(@Req() req: Request) {
    const ctx = req.tenantContext as TenantContext;
    return { data: await this.catalog.listCategories(ctx.tenantId!) };
  }

  @Post('categories')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Create category' })
  async createCategory(@Req() req: Request, @Body() body: CreateCategoryDto) {
    const ctx = req.tenantContext as TenantContext;
    return { data: await this.catalog.createCategory(ctx.tenantId!, body, ctx.userId) };
  }

  @Patch('categories/:categoryId')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Update category' })
  async updateCategory(@Req() req: Request, @Param('categoryId') categoryId: string, @Body() body: UpdateCategoryDto) {
    const ctx = req.tenantContext as TenantContext;
    return { data: await this.catalog.updateCategory(categoryId, ctx.tenantId!, body, ctx.userId) };
  }

  @Delete('categories/:categoryId')
  @Roles(TenantRole.OWNER)
  @ApiOperation({ summary: 'Delete category' })
  async deleteCategory(@Req() req: Request, @Param('categoryId') categoryId: string) {
    const ctx = req.tenantContext as TenantContext;
    await this.catalog.deleteCategory(categoryId, ctx.tenantId!, ctx.userId);
    return { data: { success: true } };
  }

  // ─── Items ─────────────────────────────────

  @Get('items')
  @ApiOperation({ summary: 'List items' })
  async listItems(@Req() req: Request) {
    const ctx = req.tenantContext as TenantContext;
    const categoryId = (req.query.categoryId as string) || undefined;
    return { data: await this.catalog.listItems(ctx.tenantId!, categoryId) };
  }

  @Get('items/:itemId')
  @ApiOperation({ summary: 'Get item details' })
  async getItem(@Req() req: Request, @Param('itemId') itemId: string) {
    const ctx = req.tenantContext as TenantContext;
    return { data: await this.catalog.getItem(itemId, ctx.tenantId!) };
  }

  @Post('items')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Create item' })
  async createItem(@Req() req: Request, @Body() body: CreateItemDto) {
    const ctx = req.tenantContext as TenantContext;
    return { data: await this.catalog.createItem(ctx.tenantId!, body, ctx.userId) };
  }

  @Patch('items/:itemId')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Update item' })
  async updateItem(@Req() req: Request, @Param('itemId') itemId: string, @Body() body: UpdateItemDto) {
    const ctx = req.tenantContext as TenantContext;
    return { data: await this.catalog.updateItem(itemId, ctx.tenantId!, body, ctx.userId) };
  }

  @Delete('items/:itemId')
  @Roles(TenantRole.OWNER)
  @ApiOperation({ summary: 'Soft-delete item' })
  async deleteItem(@Req() req: Request, @Param('itemId') itemId: string) {
    const ctx = req.tenantContext as TenantContext;
    await this.catalog.deleteItem(itemId, ctx.tenantId!, ctx.userId);
    return { data: { success: true } };
  }

  // ─── Variants ──────────────────────────────

  @Get('items/:itemId/variants')
  @ApiOperation({ summary: 'List variants' })
  async listVariants(@Req() req: Request, @Param('itemId') itemId: string) {
    const ctx = req.tenantContext as TenantContext;
    return { data: await this.catalog.listVariants(itemId, ctx.tenantId!) };
  }

  @Post('items/:itemId/variants')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Create variant' })
  async createVariant(@Req() req: Request, @Param('itemId') itemId: string, @Body() body: CreateVariantDto) {
    const ctx = req.tenantContext as TenantContext;
    return { data: await this.catalog.createVariant(itemId, ctx.tenantId!, body, ctx.userId) };
  }

  @Patch('variants/:variantId')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Update variant' })
  async updateVariant(@Req() req: Request, @Param('variantId') variantId: string, @Body() body: UpdateVariantDto) {
    const ctx = req.tenantContext as TenantContext;
    return { data: await this.catalog.updateVariant(variantId, ctx.tenantId!, body, ctx.userId) };
  }

  @Delete('variants/:variantId')
  @Roles(TenantRole.OWNER)
  @ApiOperation({ summary: 'Delete variant' })
  async deleteVariant(@Req() req: Request, @Param('variantId') variantId: string) {
    const ctx = req.tenantContext as TenantContext;
    await this.catalog.deleteVariant(variantId, ctx.tenantId!, ctx.userId);
    return { data: { success: true } };
  }

  // ─── Modifier Groups ───────────────────────

  @Get('modifier-groups')
  @ApiOperation({ summary: 'List modifier groups' })
  async listModifierGroups(@Req() req: Request) {
    const ctx = req.tenantContext as TenantContext;
    return { data: await this.catalog.listModifierGroups(ctx.tenantId!) };
  }

  @Post('modifier-groups')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Create modifier group' })
  async createModifierGroup(@Req() req: Request, @Body() body: CreateModifierGroupDto) {
    const ctx = req.tenantContext as TenantContext;
    return { data: await this.catalog.createModifierGroup(ctx.tenantId!, body, ctx.userId) };
  }

  @Patch('modifier-groups/:groupId')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Update modifier group' })
  async updateModifierGroup(@Req() req: Request, @Param('groupId') groupId: string, @Body() body: CreateModifierGroupDto) {
    const ctx = req.tenantContext as TenantContext;
    return { data: await this.catalog.updateModifierGroup(groupId, ctx.tenantId!, body, ctx.userId) };
  }

  @Post('modifier-groups/:groupId/options')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Add modifier option' })
  async addModifierOption(@Req() req: Request, @Param('groupId') groupId: string, @Body() body: CreateModifierOptionDto) {
    const ctx = req.tenantContext as TenantContext;
    return { data: await this.catalog.addModifierOption(groupId, ctx.tenantId!, body, ctx.userId) };
  }

  @Patch('modifier-options/:optionId')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Update modifier option' })
  async updateModifierOption(@Req() req: Request, @Param('optionId') optionId: string, @Body() body: CreateModifierOptionDto) {
    const ctx = req.tenantContext as TenantContext;
    return { data: await this.catalog.updateModifierOption(optionId, ctx.tenantId!, body, ctx.userId) };
  }

  @Post('items/:itemId/modifier-groups')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Link modifier group to item' })
  async linkModifierGroup(@Req() req: Request, @Param('itemId') itemId: string, @Body() body: LinkModifierGroupDto) {
    const ctx = req.tenantContext as TenantContext;
    return { data: await this.catalog.linkModifierGroupToItem(itemId, ctx.tenantId!, body.modifierGroupId, body.sortOrder, ctx.userId) };
  }

  // ─── Branch Availability ───────────────────

  @Put('items/:itemId/branches/:branchId/availability')
  @BranchScoped()
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Set branch availability for item' })
  async setAvailability(
    @Req() req: Request,
    @Param('itemId') itemId: string,
    @Param('branchId') branchId: string,
    @Body() body: SetBranchAvailabilityDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    return { data: await this.catalog.setBranchAvailability(itemId, branchId, ctx.tenantId!, body, ctx.userId) };
  }

  @Get('branches/:branchId/menu')
  @BranchScoped()
  @ApiOperation({ summary: 'List branch available items' })
  async listBranchMenu(@Req() req: Request, @Param('branchId') branchId: string) {
    const ctx = req.tenantContext as TenantContext;
    return { data: await this.catalog.listBranchAvailability(branchId, ctx.tenantId!) };
  }
}
