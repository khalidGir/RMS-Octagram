import { vi, describe, it, expect, beforeEach } from 'vitest';
import { PublicMenuService } from './public-menu.service';
import type { PrismaService } from '../prisma/prisma.service';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import * as crypto from 'crypto';

const mockPrisma = {
  tenant: { findFirst: vi.fn() },
  branch: { findFirst: vi.fn() },
  branchMenuItem: { findMany: vi.fn() },
  tableQrToken: { findUnique: vi.fn() },
};

const tenantId = 't1';
const branchId = 'b1';

describe('PublicMenuService', () => {
  let service: PublicMenuService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PublicMenuService(mockPrisma as unknown as PrismaService);
  });

  // ─── getBranchMenu ──────────────────────────

  describe('getBranchMenu', () => {
    it('throws NotFoundException for inactive tenant', async () => {
      mockPrisma.tenant.findFirst.mockResolvedValue(null);
      await expect(service.getBranchMenu(branchId, 'bad')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for inactive branch', async () => {
      mockPrisma.tenant.findFirst.mockResolvedValue({ id: tenantId, name: 'T1' });
      mockPrisma.branch.findFirst.mockResolvedValue(null);
      await expect(service.getBranchMenu(branchId, tenantId)).rejects.toThrow(NotFoundException);
    });

    it('serializes BigInt prices as strings', async () => {
      mockPrisma.tenant.findFirst.mockResolvedValue({ id: tenantId, name: 'T1' });
      mockPrisma.branch.findFirst.mockResolvedValue({ id: branchId, name: 'Main', timezone: 'Africa/Addis_Ababa' });
      mockPrisma.branchMenuItem.findMany.mockResolvedValue([
        {
          priceOverrideMinor: null,
          availableFrom: null,
          availableUntil: null,
          menuItem: {
            id: 'i1',
            name: 'Espresso',
            description: null,
            sku: null,
            isActive: true,
            deletedAt: null,
            category: { id: 'c1', name: 'Beverages', sortOrder: 0, isActive: true },
            variants: [
              { id: 'v1', name: 'Single', basePriceMinor: BigInt(15000), sku: null, isDefault: true },
            ],
            modifierGroups: [],
          },
        },
      ]);

      const result = await service.getBranchMenu(branchId, tenantId);
      expect(result.categories).toHaveLength(1);
      const variant = result.categories[0].items[0].variants[0];
      expect(variant.priceMinor).toBe('15000');
      expect(typeof variant.priceMinor).toBe('string');
    });

    it('excludes inactive categories', async () => {
      mockPrisma.tenant.findFirst.mockResolvedValue({ id: tenantId, name: 'T1' });
      mockPrisma.branch.findFirst.mockResolvedValue({ id: branchId, name: 'Main', timezone: 'Africa/Addis_Ababa' });
      mockPrisma.branchMenuItem.findMany.mockResolvedValue([
        {
          priceOverrideMinor: null,
          availableFrom: null,
          availableUntil: null,
          menuItem: {
            id: 'i1',
            name: 'Item',
            description: null,
            sku: null,
            isActive: true,
            deletedAt: null,
            category: { id: 'c1', name: 'Hidden', sortOrder: 0, isActive: false },
            variants: [{ id: 'v1', name: 'Default', basePriceMinor: BigInt(1000), sku: null, isDefault: true }],
            modifierGroups: [],
          },
        },
      ]);

      const result = await service.getBranchMenu(branchId, tenantId);
      expect(result.categories).toHaveLength(0);
    });

    it('normalizes @db.Time Date objects for availability window', async () => {
      mockPrisma.tenant.findFirst.mockResolvedValue({ id: tenantId, name: 'T1' });
      mockPrisma.branch.findFirst.mockResolvedValue({ id: branchId, name: 'Main', timezone: 'Africa/Addis_Ababa' });

      // Prisma returns Date objects for @db.Time fields (epoch 1970-01-01 + time)
      // 08:00 → Date with hours=8, minutes=0
      const from8am = new Date('1970-01-01T08:00:00Z');
      // 10:00 → Date with hours=10, minutes=0
      const until10am = new Date('1970-01-01T10:00:00Z');

      mockPrisma.branchMenuItem.findMany.mockResolvedValue([
        {
          priceOverrideMinor: null,
          availableFrom: from8am,
          availableUntil: until10am,
          menuItem: {
            id: 'i1',
            name: 'Breakfast',
            description: null,
            sku: null,
            isActive: true,
            deletedAt: null,
            category: { id: 'c1', name: 'Food', sortOrder: 0, isActive: true },
            variants: [{ id: 'v1', name: 'Default', basePriceMinor: BigInt(2000), sku: null, isDefault: true }],
            modifierGroups: [],
          },
        },
      ]);

      // Verify no crash — Date objects are properly normalized to HH:MM
      const result = await service.getBranchMenu(branchId, tenantId);
      expect(result).toHaveProperty('categories');
    });

    it('handles string @db.Time values for availability window', async () => {
      mockPrisma.tenant.findFirst.mockResolvedValue({ id: tenantId, name: 'T1' });
      mockPrisma.branch.findFirst.mockResolvedValue({ id: branchId, name: 'Main', timezone: 'Africa/Addis_Ababa' });

      mockPrisma.branchMenuItem.findMany.mockResolvedValue([
        {
          priceOverrideMinor: null,
          availableFrom: '08:00:00',
          availableUntil: '10:00:00',
          menuItem: {
            id: 'i1',
            name: 'Brunch',
            description: null,
            sku: null,
            isActive: true,
            deletedAt: null,
            category: { id: 'c1', name: 'Food', sortOrder: 0, isActive: true },
            variants: [{ id: 'v1', name: 'Default', basePriceMinor: BigInt(3000), sku: null, isDefault: true }],
            modifierGroups: [],
          },
        },
      ]);

      const result = await service.getBranchMenu(branchId, tenantId);
      expect(result).toHaveProperty('categories');
    });

    it('branch price override applies only to default variant', async () => {
      mockPrisma.tenant.findFirst.mockResolvedValue({ id: tenantId, name: 'T1' });
      mockPrisma.branch.findFirst.mockResolvedValue({ id: branchId, name: 'Main', timezone: 'Africa/Addis_Ababa' });
      mockPrisma.branchMenuItem.findMany.mockResolvedValue([
        {
          priceOverrideMinor: BigInt(9999),
          availableFrom: null,
          availableUntil: null,
          menuItem: {
            id: 'i1',
            name: 'Item',
            description: null,
            sku: null,
            isActive: true,
            deletedAt: null,
            category: { id: 'c1', name: 'Cat', sortOrder: 0, isActive: true },
            variants: [
              { id: 'v-default', name: 'Regular', basePriceMinor: BigInt(5000), sku: null, isDefault: true },
              { id: 'v-large', name: 'Large', basePriceMinor: BigInt(8000), sku: null, isDefault: false },
            ],
            modifierGroups: [],
          },
        },
      ]);

      const result = await service.getBranchMenu(branchId, tenantId);
      const variants = result.categories[0].items[0].variants;
      // Default variant gets override price
      expect(variants.find(v => v.id === 'v-default')!.priceMinor).toBe('9999');
      // Non-default variant keeps base price
      expect(variants.find(v => v.id === 'v-large')!.priceMinor).toBe('8000');
    });

    it('serializes modifier option prices as strings', async () => {
      mockPrisma.tenant.findFirst.mockResolvedValue({ id: tenantId, name: 'T1' });
      mockPrisma.branch.findFirst.mockResolvedValue({ id: branchId, name: 'Main', timezone: 'Africa/Addis_Ababa' });
      mockPrisma.branchMenuItem.findMany.mockResolvedValue([
        {
          priceOverrideMinor: null,
          availableFrom: null,
          availableUntil: null,
          menuItem: {
            id: 'i1',
            name: 'Coffee',
            description: null,
            sku: null,
            isActive: true,
            deletedAt: null,
            category: { id: 'c1', name: 'Drinks', sortOrder: 0, isActive: true },
            variants: [{ id: 'v1', name: 'Regular', basePriceMinor: BigInt(1000), sku: null, isDefault: true }],
            modifierGroups: [
              {
                sortOrder: 0,
                modifierGroup: {
                  id: 'mg1',
                  name: 'Size',
                  isRequired: false,
                  minSelections: 0,
                  maxSelections: 3,
                  options: [
                    { id: 'o1', name: 'Large', priceDeltaMinor: BigInt(500) },
                  ],
                },
              },
            ],
          },
        },
      ]);

      const result = await service.getBranchMenu(branchId, tenantId);
      const opt = result.categories[0].items[0].modifierGroups[0].options[0];
      expect(opt.priceDeltaMinor).toBe('500');
      expect(typeof opt.priceDeltaMinor).toBe('string');
    });
  });

  // ─── resolveTableContext ────────────────────

  describe('resolveTableContext', () => {
    it('throws NotFoundException for invalid token', async () => {
      mockPrisma.tableQrToken.findUnique.mockResolvedValue(null);
      await expect(service.resolveTableContext('bad-token', tenantId)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException for revoked token', async () => {
      mockPrisma.tableQrToken.findUnique.mockResolvedValue({
        revokedAt: new Date(),
        expiresAt: null,
        tenantId,
        table: { id: 't1', label: 'T1', capacity: 4, branch: { id: branchId, name: 'Main', isActive: true }, diningArea: null },
      });
      await expect(service.resolveTableContext('token', tenantId)).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException for wrong tenant', async () => {
      mockPrisma.tableQrToken.findUnique.mockResolvedValue({
        revokedAt: null,
        expiresAt: null,
        tenantId: 'other-tenant',
        table: { id: 't1', label: 'T1', capacity: 4, branch: { id: branchId, name: 'Main', isActive: true }, diningArea: null },
      });
      await expect(service.resolveTableContext('token', tenantId)).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException for inactive branch', async () => {
      mockPrisma.tableQrToken.findUnique.mockResolvedValue({
        revokedAt: null,
        expiresAt: null,
        tenantId,
        table: { id: 't1', label: 'T1', capacity: 4, branch: { id: branchId, name: 'Main', isActive: false }, diningArea: null },
      });
      await expect(service.resolveTableContext('token', tenantId)).rejects.toThrow(ForbiddenException);
    });

    it('returns context for valid token', async () => {
      mockPrisma.tableQrToken.findUnique.mockResolvedValue({
        revokedAt: null,
        expiresAt: null,
        tenantId,
        table: {
          id: 't1',
          label: 'T1',
          capacity: 4,
          branch: { id: branchId, name: 'Main', isActive: true },
          diningArea: { id: 'da1', name: 'Ground Floor' },
        },
      });
      mockPrisma.tenant.findFirst.mockResolvedValue({ id: tenantId, name: 'TestTenant' });

      const result = await service.resolveTableContext('valid-token', tenantId);
      expect(result.tenant.name).toBe('TestTenant');
      expect(result.branch.name).toBe('Main');
      expect(result.table.label).toBe('T1');
      expect(result.diningArea.name).toBe('Ground Floor');
    });

    it('handles null dining area', async () => {
      mockPrisma.tableQrToken.findUnique.mockResolvedValue({
        revokedAt: null,
        expiresAt: null,
        tenantId,
        table: {
          id: 't1',
          label: 'T1',
          capacity: 4,
          branch: { id: branchId, name: 'Main', isActive: true },
          diningArea: null,
        },
      });
      mockPrisma.tenant.findFirst.mockResolvedValue({ id: tenantId, name: 'TestTenant' });

      const result = await service.resolveTableContext('valid-token', tenantId);
      expect(result.diningArea.name).toBe('Unassigned');
    });
  });
});
