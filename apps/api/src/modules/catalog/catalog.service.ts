import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ─── Categories ────────────────────────────

  async listCategories(tenantId: string) {
    return this.prisma.menuCategory.findMany({
      where: { tenantId },
      orderBy: { sortOrder: 'asc' },
      include: { _count: { select: { items: true } } },
    });
  }

  async createCategory(tenantId: string, data: { name: string; description?: string; sortOrder?: number }, actorUserId?: string) {
    const cat = await this.prisma.menuCategory.create({
      data: { tenantId, name: data.name, description: data.description, sortOrder: data.sortOrder ?? 0 },
    });
    await this.audit.log({ actorUserId: actorUserId ?? null as any, tenantId, action: 'CATEGORY_CREATE', entityType: 'MenuCategory', entityId: cat.id, after: data });
    return cat;
  }

  async updateCategory(categoryId: string, tenantId: string, data: { name?: string; description?: string; sortOrder?: number; isActive?: boolean }, actorUserId?: string) {
    const cat = await this.prisma.menuCategory.findFirst({ where: { id: categoryId, tenantId } });
    if (!cat) throw new NotFoundException('Category not found');
    const before = { name: cat.name, sortOrder: cat.sortOrder };
    const updated = await this.prisma.menuCategory.update({ where: { id: categoryId }, data });
    await this.audit.log({ actorUserId: actorUserId ?? null as any, tenantId, action: 'CATEGORY_UPDATE', entityType: 'MenuCategory', entityId: categoryId, before, after: data });
    return updated;
  }

  async deleteCategory(categoryId: string, tenantId: string, actorUserId?: string) {
    const cat = await this.prisma.menuCategory.findFirst({ where: { id: categoryId, tenantId }, include: { items: true } });
    if (!cat) throw new NotFoundException('Category not found');
    if (cat.items.length > 0) throw new ConflictException('Category has items; reassign or delete them first');
    await this.prisma.menuCategory.delete({ where: { id: categoryId } });
    await this.audit.log({ actorUserId: actorUserId ?? null as any, tenantId, action: 'CATEGORY_DELETE', entityType: 'MenuCategory', entityId: categoryId, before: { name: cat.name } });
  }

  // ─── Items ─────────────────────────────────

  async listItems(tenantId: string, categoryId?: string) {
    const where: any = { tenantId };
    if (categoryId) where.categoryId = categoryId;
    return this.prisma.menuItem.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        category: { select: { id: true, name: true } },
        variants: { where: { isActive: true }, orderBy: { isDefault: 'desc' } },
        modifierGroups: { include: { modifierGroup: true } },
      },
    });
  }

  async getItem(itemId: string, tenantId: string) {
    const item = await this.prisma.menuItem.findFirst({
      where: { id: itemId, tenantId },
      include: {
        category: { select: { id: true, name: true } },
        variants: { orderBy: { isDefault: 'desc' } },
        modifierGroups: { include: { modifierGroup: { include: { options: true } } } },
      },
    });
    if (!item) throw new NotFoundException('Item not found');
    return item;
  }

  async createItem(tenantId: string, data: { name: string; description?: string; categoryId?: string; sku?: string }, actorUserId?: string) {
    if (data.categoryId) {
      const cat = await this.prisma.menuCategory.findFirst({ where: { id: data.categoryId, tenantId } });
      if (!cat) throw new NotFoundException('Category not found in this tenant');
    }
    const item = await this.prisma.menuItem.create({
      data: { tenantId, name: data.name, description: data.description, categoryId: data.categoryId, sku: data.sku },
    });
    await this.audit.log({ actorUserId: actorUserId ?? null as any, tenantId, action: 'ITEM_CREATE', entityType: 'MenuItem', entityId: item.id, after: data });
    return item;
  }

  async updateItem(itemId: string, tenantId: string, data: { name?: string; description?: string; categoryId?: string; sku?: string; isActive?: boolean }, actorUserId?: string) {
    const item = await this.prisma.menuItem.findFirst({ where: { id: itemId, tenantId } });
    if (!item) throw new NotFoundException('Item not found');
    if (data.categoryId) {
      const cat = await this.prisma.menuCategory.findFirst({ where: { id: data.categoryId, tenantId } });
      if (!cat) throw new NotFoundException('Category not found in this tenant');
    }
    const before = { name: item.name, categoryId: item.categoryId };
    const updated = await this.prisma.menuItem.update({ where: { id: itemId }, data });
    await this.audit.log({ actorUserId: actorUserId ?? null as any, tenantId, action: 'ITEM_UPDATE', entityType: 'MenuItem', entityId: itemId, before, after: data });
    return updated;
  }

  async deleteItem(itemId: string, tenantId: string, actorUserId?: string) {
    const item = await this.prisma.menuItem.findFirst({ where: { id: itemId, tenantId } });
    if (!item) throw new NotFoundException('Item not found');
    const updated = await this.prisma.menuItem.update({ where: { id: itemId }, data: { deletedAt: new Date(), isActive: false } });
    await this.audit.log({ actorUserId: actorUserId ?? null as any, tenantId, action: 'ITEM_SOFT_DELETE', entityType: 'MenuItem', entityId: itemId, before: { name: item.name } });
    return updated;
  }

  // ─── Variants ──────────────────────────────

  async listVariants(itemId: string, tenantId: string) {
    const item = await this.prisma.menuItem.findFirst({ where: { id: itemId, tenantId } });
    if (!item) throw new NotFoundException('Item not found');
    return this.prisma.menuItemVariant.findMany({ where: { menuItemId: itemId }, orderBy: { isDefault: 'desc' } });
  }

  async createVariant(itemId: string, tenantId: string, data: { name: string; basePriceMinor: number; sku?: string; isDefault?: boolean }, actorUserId?: string) {
    const item = await this.prisma.menuItem.findFirst({ where: { id: itemId, tenantId } });
    if (!item) throw new NotFoundException('Item not found');

    if (data.isDefault) {
      await this.prisma.menuItemVariant.updateMany({ where: { menuItemId: itemId, isDefault: true }, data: { isDefault: false } });
    }

    const variant = await this.prisma.menuItemVariant.create({
      data: { tenantId, menuItemId: itemId, name: data.name, basePriceMinor: data.basePriceMinor, sku: data.sku, isDefault: data.isDefault ?? false },
    });
    await this.audit.log({ actorUserId: actorUserId ?? null as any, tenantId, action: 'VARIANT_CREATE', entityType: 'MenuItemVariant', entityId: variant.id, after: data });
    return variant;
  }

  async updateVariant(variantId: string, tenantId: string, data: { name?: string; basePriceMinor?: number; sku?: string; isDefault?: boolean; isActive?: boolean }, actorUserId?: string) {
    const variant = await this.prisma.menuItemVariant.findFirst({ where: { id: variantId, tenantId } });
    if (!variant) throw new NotFoundException('Variant not found');

    if (data.isDefault) {
      await this.prisma.menuItemVariant.updateMany({ where: { menuItemId: variant.menuItemId, isDefault: true }, data: { isDefault: false } });
    }

    const before = { name: variant.name, basePriceMinor: variant.basePriceMinor };
    const updated = await this.prisma.menuItemVariant.update({ where: { id: variantId }, data });
    await this.audit.log({ actorUserId: actorUserId ?? null as any, tenantId, action: 'VARIANT_UPDATE', entityType: 'MenuItemVariant', entityId: variantId, before, after: data });
    return updated;
  }

  async deleteVariant(variantId: string, tenantId: string, actorUserId?: string) {
    const variant = await this.prisma.menuItemVariant.findFirst({ where: { id: variantId, tenantId } });
    if (!variant) throw new NotFoundException('Variant not found');
    await this.prisma.menuItemVariant.delete({ where: { id: variantId } });
    await this.audit.log({ actorUserId: actorUserId ?? null as any, tenantId, action: 'VARIANT_DELETE', entityType: 'MenuItemVariant', entityId: variantId, before: { name: variant.name } });
  }

  // ─── Modifier Groups ───────────────────────

  async listModifierGroups(tenantId: string) {
    return this.prisma.modifierGroup.findMany({
      where: { tenantId },
      include: { options: { where: { isActive: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async createModifierGroup(tenantId: string, data: { name: string; minSelections?: number; maxSelections?: number; isRequired?: boolean }, actorUserId?: string) {
    const group = await this.prisma.modifierGroup.create({
      data: { tenantId, name: data.name, minSelections: data.minSelections ?? 0, maxSelections: data.maxSelections, isRequired: data.isRequired ?? false },
    });
    await this.audit.log({ actorUserId: actorUserId ?? null as any, tenantId, action: 'MODIFIER_GROUP_CREATE', entityType: 'ModifierGroup', entityId: group.id, after: data });
    return group;
  }

  async updateModifierGroup(groupId: string, tenantId: string, data: { name?: string; minSelections?: number; maxSelections?: number; isRequired?: boolean }, actorUserId?: string) {
    const group = await this.prisma.modifierGroup.findFirst({ where: { id: groupId, tenantId } });
    if (!group) throw new NotFoundException('Modifier group not found');
    const before = { name: group.name };
    const updated = await this.prisma.modifierGroup.update({ where: { id: groupId }, data });
    await this.audit.log({ actorUserId: actorUserId ?? null as any, tenantId, action: 'MODIFIER_GROUP_UPDATE', entityType: 'ModifierGroup', entityId: groupId, before, after: data });
    return updated;
  }

  async addModifierOption(groupId: string, tenantId: string, data: { name: string; priceDeltaMinor: number }, actorUserId?: string) {
    const group = await this.prisma.modifierGroup.findFirst({ where: { id: groupId, tenantId } });
    if (!group) throw new NotFoundException('Modifier group not found');
    const option = await this.prisma.modifierOption.create({
      data: { tenantId, modifierGroupId: groupId, name: data.name, priceDeltaMinor: data.priceDeltaMinor },
    });
    await this.audit.log({ actorUserId: actorUserId ?? null as any, tenantId, action: 'MODIFIER_OPTION_CREATE', entityType: 'ModifierOption', entityId: option.id, after: data });
    return option;
  }

  async updateModifierOption(optionId: string, tenantId: string, data: { name?: string; priceDeltaMinor?: number; isActive?: boolean }, actorUserId?: string) {
    const opt = await this.prisma.modifierOption.findFirst({ where: { id: optionId, tenantId } });
    if (!opt) throw new NotFoundException('Modifier option not found');
    const before = { name: opt.name, priceDeltaMinor: opt.priceDeltaMinor };
    const updated = await this.prisma.modifierOption.update({ where: { id: optionId }, data });
    await this.audit.log({ actorUserId: actorUserId ?? null as any, tenantId, action: 'MODIFIER_OPTION_UPDATE', entityType: 'ModifierOption', entityId: optionId, before, after: data });
    return updated;
  }

  async linkModifierGroupToItem(itemId: string, tenantId: string, modifierGroupId: string, sortOrder: number = 0, actorUserId?: string) {
    const item = await this.prisma.menuItem.findFirst({ where: { id: itemId, tenantId } });
    if (!item) throw new NotFoundException('Item not found');
    const group = await this.prisma.modifierGroup.findFirst({ where: { id: modifierGroupId, tenantId } });
    if (!group) throw new NotFoundException('Modifier group not found');

    const link = await this.prisma.menuItemModifierGroup.upsert({
      where: { menuItemId_modifierGroupId: { menuItemId: itemId, modifierGroupId } },
      update: { sortOrder },
      create: { tenantId, menuItemId: itemId, modifierGroupId, sortOrder },
    });
    await this.audit.log({ actorUserId: actorUserId ?? null as any, tenantId, action: 'ITEM_MODIFIER_LINK', entityType: 'MenuItemModifierGroup', entityId: `${itemId}:${modifierGroupId}`, after: { itemId, modifierGroupId, sortOrder } });
    return link;
  }

  // ─── Branch Availability ───────────────────

  async setBranchAvailability(itemId: string, branchId: string, tenantId: string, data: {
    isAvailable: boolean;
    priceOverrideMinor?: number;
    availableFrom?: string;
    availableUntil?: string;
  }, actorUserId?: string) {
    const item = await this.prisma.menuItem.findFirst({ where: { id: itemId, tenantId } });
    if (!item) throw new NotFoundException('Item not found');
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, tenantId } });
    if (!branch) throw new NotFoundException('Branch not found');

    const updateData: any = { isAvailable: data.isAvailable };
    if (data.priceOverrideMinor !== undefined) updateData.priceOverrideMinor = data.priceOverrideMinor;
    if (data.availableFrom) updateData.availableFrom = data.availableFrom;
    if (data.availableUntil) updateData.availableUntil = data.availableUntil;

    const result = await this.prisma.branchMenuItem.upsert({
      where: { branchId_menuItemId: { branchId, menuItemId: itemId } },
      update: updateData,
      create: { tenantId, branchId, menuItemId: itemId, ...updateData },
    });
    await this.audit.log({ actorUserId: actorUserId ?? null as any, tenantId, branchId, action: 'BRANCH_AVAILABILITY_SET', entityType: 'BranchMenuItem', entityId: `${branchId}:${itemId}`, after: { isAvailable: data.isAvailable, priceOverrideMinor: data.priceOverrideMinor } });
    return result;
  }

  async listBranchAvailability(branchId: string, tenantId: string) {
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, tenantId } });
    if (!branch) throw new NotFoundException('Branch not found');

    return this.prisma.branchMenuItem.findMany({
      where: { branchId, isAvailable: true },
      include: {
        menuItem: {
          include: {
            variants: { where: { isActive: true } },
            modifierGroups: { include: { modifierGroup: true } },
          },
        },
      },
    });
  }
}
