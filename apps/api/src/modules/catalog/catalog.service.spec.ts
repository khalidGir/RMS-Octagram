import { vi, describe, it, expect, beforeEach } from 'vitest';
import { CatalogService } from './catalog.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { NotFoundException, ConflictException } from '@nestjs/common';

const mockPrisma = {
  menuCategory: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  menuItem: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  menuItemVariant: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn() },
  modifierGroup: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  modifierOption: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  menuItemModifierGroup: { upsert: vi.fn() },
  branchMenuItem: { upsert: vi.fn(), findMany: vi.fn() },
  branch: { findFirst: vi.fn() },
};

const mockAudit = { log: vi.fn() };

const tenantId = 't1';
const branchId = 'b1';
const userId = 'u1';

describe('CatalogService', () => {
  let service: CatalogService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new CatalogService(mockPrisma as unknown as PrismaService, mockAudit as unknown as AuditService);
  });

  // ─── Categories ──────────────────────────────

  describe('listCategories', () => {
    it('returns categories for tenant', async () => {
      mockPrisma.menuCategory.findMany.mockResolvedValue([{ id: 'c1', name: 'Beverages' }]);
      const result = await service.listCategories(tenantId);
      expect(result).toHaveLength(1);
      expect(mockPrisma.menuCategory.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId } }));
    });
  });

  describe('createCategory', () => {
    it('creates category and audits with actorUserId', async () => {
      mockPrisma.menuCategory.create.mockResolvedValue({ id: 'c1', name: 'Food' });
      const result = await service.createCategory(tenantId, { name: 'Food' }, userId);
      expect(result.id).toBe('c1');
      expect(mockAudit.log).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: userId }));
    });
  });

  describe('updateCategory', () => {
    it('throws NotFoundException if not found', async () => {
      mockPrisma.menuCategory.findFirst.mockResolvedValue(null);
      await expect(service.updateCategory('bad', tenantId, { name: 'X' })).rejects.toThrow(NotFoundException);
    });

    it('updates and audits', async () => {
      mockPrisma.menuCategory.findFirst.mockResolvedValue({ id: 'c1', name: 'Old' });
      mockPrisma.menuCategory.update.mockResolvedValue({ id: 'c1', name: 'Updated' });
      await service.updateCategory('c1', tenantId, { name: 'Updated' }, userId);
      expect(mockAudit.log).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: userId, action: 'CATEGORY_UPDATE' }));
    });
  });

  describe('deleteCategory', () => {
    it('throws NotFoundException if not found', async () => {
      mockPrisma.menuCategory.findFirst.mockResolvedValue(null);
      await expect(service.deleteCategory('bad', tenantId)).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException if has items', async () => {
      mockPrisma.menuCategory.findFirst.mockResolvedValue({ id: 'c1', items: [{ id: 'i1' }] });
      await expect(service.deleteCategory('c1', tenantId)).rejects.toThrow(ConflictException);
    });

    it('deletes and audits', async () => {
      mockPrisma.menuCategory.findFirst.mockResolvedValue({ id: 'c1', name: 'Empty', items: [] });
      mockPrisma.menuCategory.delete.mockResolvedValue({});
      await service.deleteCategory('c1', tenantId, userId);
      expect(mockAudit.log).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: userId, action: 'CATEGORY_DELETE' }));
    });
  });

  // ─── Items ───────────────────────────────────

  describe('createItem', () => {
    it('throws NotFoundException if categoryId not in tenant', async () => {
      mockPrisma.menuCategory.findFirst.mockResolvedValue(null);
      await expect(service.createItem(tenantId, { name: 'X', categoryId: 'bad' })).rejects.toThrow(NotFoundException);
    });

    it('creates item when categoryId valid or absent', async () => {
      mockPrisma.menuCategory.findFirst.mockResolvedValue({ id: 'c1' });
      mockPrisma.menuItem.create.mockResolvedValue({ id: 'i1', name: 'Espresso' });
      const result = await service.createItem(tenantId, { name: 'Espresso', categoryId: 'c1' }, userId);
      expect(result.id).toBe('i1');
      expect(mockAudit.log).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: userId }));
    });
  });

  describe('updateItem', () => {
    it('throws NotFoundException if item not found', async () => {
      mockPrisma.menuItem.findFirst.mockResolvedValue(null);
      await expect(service.updateItem('bad', tenantId, { name: 'X' })).rejects.toThrow(NotFoundException);
    });

    it('validates categoryId on update', async () => {
      mockPrisma.menuItem.findFirst.mockResolvedValueOnce({ id: 'i1' });
      mockPrisma.menuCategory.findFirst.mockResolvedValue(null);
      await expect(service.updateItem('i1', tenantId, { categoryId: 'bad' })).rejects.toThrow(NotFoundException);
    });

    it('updates and audits', async () => {
      mockPrisma.menuItem.findFirst.mockResolvedValueOnce({ id: 'i1', name: 'Old', categoryId: null });
      mockPrisma.menuCategory.findFirst.mockResolvedValue({ id: 'c1' });
      mockPrisma.menuItem.update.mockResolvedValue({ id: 'i1', name: 'New' });
      await service.updateItem('i1', tenantId, { name: 'New', categoryId: 'c1' }, userId);
      expect(mockAudit.log).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: userId, action: 'ITEM_UPDATE' }));
    });
  });

  describe('deleteItem', () => {
    it('soft-deletes and audits', async () => {
      mockPrisma.menuItem.findFirst.mockResolvedValue({ id: 'i1', name: 'Test' });
      mockPrisma.menuItem.update.mockResolvedValue({ id: 'i1', deletedAt: new Date() });
      await service.deleteItem('i1', tenantId, userId);
      expect(mockPrisma.menuItem.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ deletedAt: expect.any(Date), isActive: false }),
      }));
      expect(mockAudit.log).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: userId, action: 'ITEM_SOFT_DELETE' }));
    });
  });

  // ─── Variants ────────────────────────────────

  describe('createVariant', () => {
    it('throws NotFoundException if item not found', async () => {
      mockPrisma.menuItem.findFirst.mockResolvedValue(null);
      await expect(service.createVariant('bad', tenantId, { name: 'Regular', basePriceMinor: 1000 })).rejects.toThrow(NotFoundException);
    });

    it('creates variant and audits', async () => {
      mockPrisma.menuItem.findFirst.mockResolvedValue({ id: 'i1' });
      mockPrisma.menuItemVariant.updateMany.mockResolvedValue({});
      mockPrisma.menuItemVariant.create.mockResolvedValue({ id: 'v1', name: 'Large' });
      await service.createVariant('i1', tenantId, { name: 'Large', basePriceMinor: 2000, isDefault: true }, userId);
      expect(mockAudit.log).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: userId, action: 'VARIANT_CREATE' }));
    });
  });

  // ─── Modifier Groups ─────────────────────────

  describe('addModifierOption', () => {
    it('throws NotFoundException if group not found', async () => {
      mockPrisma.modifierGroup.findFirst.mockResolvedValue(null);
      await expect(service.addModifierOption('bad', tenantId, { name: 'Large', priceDeltaMinor: 500 })).rejects.toThrow(NotFoundException);
    });

    it('adds option and audits', async () => {
      mockPrisma.modifierGroup.findFirst.mockResolvedValue({ id: 'mg1' });
      mockPrisma.modifierOption.create.mockResolvedValue({ id: 'mo1', name: 'Large' });
      await service.addModifierOption('mg1', tenantId, { name: 'Large', priceDeltaMinor: 500 }, userId);
      expect(mockAudit.log).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: userId, action: 'MODIFIER_OPTION_CREATE' }));
    });
  });

  // ─── Branch Availability ─────────────────────

  describe('setBranchAvailability', () => {
    it('throws NotFoundException if item not found', async () => {
      mockPrisma.menuItem.findFirst.mockResolvedValue(null);
      await expect(service.setBranchAvailability('bad', branchId, tenantId, { isAvailable: true })).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException if branch not found', async () => {
      mockPrisma.menuItem.findFirst.mockResolvedValue({ id: 'i1' });
      mockPrisma.branch.findFirst.mockResolvedValue(null);
      await expect(service.setBranchAvailability('i1', branchId, tenantId, { isAvailable: true })).rejects.toThrow(NotFoundException);
    });

    it('upserts and audits', async () => {
      mockPrisma.menuItem.findFirst.mockResolvedValue({ id: 'i1' });
      mockPrisma.branch.findFirst.mockResolvedValue({ id: 'b1' });
      mockPrisma.branchMenuItem.upsert.mockResolvedValue({ isAvailable: true });
      await service.setBranchAvailability('i1', branchId, tenantId, { isAvailable: true, priceOverrideMinor: 15000 }, userId);
      expect(mockAudit.log).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: userId, action: 'BRANCH_AVAILABILITY_SET' }));
    });
  });
});
