import { Controller, Get, Post, Patch, Delete, Body, Param, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { BranchScopeGuard } from '../auth/branch-scope.guard';
import { Roles, BranchScoped, type TenantContext } from '../auth/types'; // eslint-disable-line @typescript-eslint/consistent-type-imports
import { TenantRole } from '@rms/contracts';
import { KitchensService } from './kitchens.service'; // eslint-disable-line @typescript-eslint/consistent-type-imports
import { CreateKitchenDto, UpdateKitchenDto } from './dto'; // eslint-disable-line @typescript-eslint/consistent-type-imports

@ApiTags('Kitchen Configuration')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, BranchScopeGuard)
@Controller('branches/:branchId/kitchens')
export class KitchensController {
  constructor(private readonly kitchensService: KitchensService) {}

  @Get()
  @BranchScoped()
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.CASHIER, TenantRole.KITCHEN_STAFF)
  @ApiOperation({ summary: 'List kitchens for a branch' })
  async listKitchens(@Req() req: Request, @Param('branchId') branchId: string) {
    const ctx = req.tenantContext as TenantContext;
    const kitchens = await this.kitchensService.listKitchens(ctx.tenantId!, branchId);
    return { data: kitchens };
  }

  @Post()
  @BranchScoped()
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Create a kitchen' })
  async createKitchen(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Body() body: CreateKitchenDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const kitchen = await this.kitchensService.createKitchen({
      tenantId: ctx.tenantId!,
      branchId,
      name: body.name,
      description: body.description,
      collectionLabel: body.collectionLabel,
      displayOrder: body.displayOrder,
      actorUserId: ctx.userId,
    });
    return { data: kitchen };
  }

  @Patch(':kitchenId')
  @BranchScoped()
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Update a kitchen' })
  async updateKitchen(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('kitchenId') kitchenId: string,
    @Body() body: UpdateKitchenDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const kitchen = await this.kitchensService.updateKitchen({
      tenantId: ctx.tenantId!,
      branchId,
      kitchenId,
      name: body.name,
      description: body.description,
      collectionLabel: body.collectionLabel,
      displayOrder: body.displayOrder,
      isActive: body.isActive,
      actorUserId: ctx.userId,
    });
    return { data: kitchen };
  }

  @Delete(':kitchenId')
  @BranchScoped()
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Soft-delete a kitchen' })
  async deleteKitchen(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('kitchenId') kitchenId: string,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const result = await this.kitchensService.deleteKitchen({
      tenantId: ctx.tenantId!,
      branchId,
      kitchenId,
      actorUserId: ctx.userId,
    });
    return { data: result };
  }
}
