import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnalyticsService } from './analytics.service';

const mockPrisma = {
  branch: { findFirst: vi.fn(), findMany: vi.fn() },
  $queryRaw: vi.fn(),
};

const mockFeatureResolver = {
  assertEffective: vi.fn(),
  resolve: vi.fn().mockResolvedValue({ effective: true }),
};

describe('AnalyticsService', () => {
  let service: AnalyticsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AnalyticsService(
      mockPrisma as any,
      mockFeatureResolver as any,
    );
  });

  describe('resolveDateRange', () => {
    it('throws on date range exceeding 366 days', async () => {
      mockPrisma.branch.findMany.mockResolvedValue([{ id: 'b1', timezone: 'Africa/Addis_Ababa' }]);
      mockPrisma.$queryRaw.mockResolvedValue([]);
      await expect(
        service.revenueSummary('t1', 'OWNER', [], {
          fromLocalDate: '2025-01-01',
          toLocalDate: '2026-06-01',
        }),
      ).rejects.toThrow('Date range exceeds maximum');
    });

    it('throws when from > to', async () => {
      mockPrisma.branch.findMany.mockResolvedValue([{ id: 'b1', timezone: 'Africa/Addis_Ababa' }]);
      mockPrisma.$queryRaw.mockResolvedValue([]);
      await expect(
        service.revenueSummary('t1', 'OWNER', [], {
          fromLocalDate: '2026-06-01',
          toLocalDate: '2026-01-01',
        }),
      ).rejects.toThrow('fromLocalDate must be before toLocalDate');
    });
  });

  describe('revenueSummary', () => {
    it('returns empty when no branches', async () => {
      mockPrisma.branch.findMany.mockResolvedValue([]);
      const result = await service.revenueSummary('t1', 'OWNER', [], {});
      expect(result.days).toEqual([]);
    });

    it('calls assertEffective with ANALYTICS', async () => {
      mockPrisma.branch.findFirst.mockResolvedValue({ id: 'b1', timezone: 'Africa/Addis_Ababa' });
      mockPrisma.$queryRaw.mockResolvedValue([]);
      await service.revenueSummary('t1', 'OWNER', [], { branchId: 'b1' });
      expect(mockFeatureResolver.assertEffective).toHaveBeenCalledWith(
        't1',
        'ANALYTICS',
        'b1',
      );
    });

    it('queries revenue data when branches exist', async () => {
      mockPrisma.branch.findFirst.mockResolvedValue({ id: 'b1', timezone: 'Africa/Addis_Ababa' });
      mockPrisma.$queryRaw.mockResolvedValue([
        { day: '2026-08-20', revenue_minor: '5000', order_count: '3', avg_order_minor: '1666' },
      ]);
      const result = await service.revenueSummary('t1', 'OWNER', [], {
        branchId: 'b1',
        fromLocalDate: '2026-08-20',
        toLocalDate: '2026-08-20',
      });
      expect(result.days).toHaveLength(1);
      expect(result.days[0].revenueMinor).toBe('5000');
      expect(result.days[0].orderCount).toBe(3);
    });
  });

  describe('revenueByPaymentMethod', () => {
    it('returns empty methods when no branches', async () => {
      mockPrisma.branch.findMany.mockResolvedValue([]);
      const result = await service.revenueByPaymentMethod('t1', 'OWNER', [], {});
      expect(result.methods).toEqual([]);
    });

    it('queries payment method data when branches exist', async () => {
      mockPrisma.branch.findFirst.mockResolvedValue({ id: 'b1', timezone: 'Africa/Addis_Ababa' });
      mockPrisma.$queryRaw.mockResolvedValue([
        { method: 'CASH', total_minor: '3000', payment_count: '2', avg_minor: '1500' },
        { method: 'MOBILE_MONEY', total_minor: '2000', payment_count: '1', avg_minor: '2000' },
      ]);
      const result = await service.revenueByPaymentMethod('t1', 'OWNER', [], {
        branchId: 'b1',
        fromLocalDate: '2026-08-20',
        toLocalDate: '2026-08-20',
      });
      expect(result.methods).toHaveLength(2);
      expect(result.methods[0].method).toBe('CASH');
    });
  });

  describe('orderStats', () => {
    it('returns zeroed stats when no branches', async () => {
      mockPrisma.branch.findMany.mockResolvedValue([]);
      const result = await service.orderStats('t1', 'OWNER', [], {});
      expect(result.stats.totalOrders).toBe(0);
      expect(result.stats.cancelledOrders).toBe(0);
      expect(result.stats.voidedOrders).toBe(0);
    });

    it('queries order stats when branches exist', async () => {
      mockPrisma.branch.findFirst.mockResolvedValue({ id: 'b1', timezone: 'Africa/Addis_Ababa' });
      mockPrisma.$queryRaw.mockResolvedValue([{
        total_orders: '10',
        completed_orders: '8',
        cancelled_orders: '1',
        voided_orders: '1',
        avg_order_minor: '2500',
        total_revenue_minor: '20000',
      }]);
      const result = await service.orderStats('t1', 'OWNER', [], {
        branchId: 'b1',
        fromLocalDate: '2026-08-20',
        toLocalDate: '2026-08-20',
      });
      expect(result.stats.totalOrders).toBe(10);
      expect(result.stats.completedOrders).toBe(8);
    });
  });

  describe('bestSellers', () => {
    it('returns empty items when no branches', async () => {
      mockPrisma.branch.findMany.mockResolvedValue([]);
      const result = await service.bestSellers('t1', 'OWNER', [], {});
      expect(result.items).toEqual([]);
    });

    it('queries best sellers when branches exist', async () => {
      mockPrisma.branch.findFirst.mockResolvedValue({ id: 'b1', timezone: 'Africa/Addis_Ababa' });
      mockPrisma.$queryRaw.mockResolvedValue([{
        variant_id: 'v1',
        item_name: 'Burger',
        variant_name: 'Regular',
        total_quantity: '25',
        total_revenue: '12500',
        order_count: '15',
      }]);
      const result = await service.bestSellers('t1', 'OWNER', [], {
        branchId: 'b1',
        fromLocalDate: '2026-08-20',
        toLocalDate: '2026-08-20',
        limit: 10,
      });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].itemName).toBe('Burger');
      expect(result.items[0].totalQuantity).toBe(25);
    });
  });

  describe('peakHours', () => {
    it('returns empty hours when no branches', async () => {
      mockPrisma.branch.findMany.mockResolvedValue([]);
      const result = await service.peakHours('t1', 'OWNER', [], {});
      expect(result.hours).toEqual([]);
    });

    it('returns all 24 hours when branches exist', async () => {
      mockPrisma.branch.findFirst.mockResolvedValue({ id: 'b1', timezone: 'Africa/Addis_Ababa' });
      mockPrisma.$queryRaw.mockResolvedValue([
        { hour: '8', order_count: '5', revenue_minor: '3000' },
        { hour: '12', order_count: '12', revenue_minor: '8000' },
      ]);
      const result = await service.peakHours('t1', 'OWNER', [], {
        branchId: 'b1',
        fromLocalDate: '2026-08-20',
        toLocalDate: '2026-08-20',
      });
      expect(result.hours).toHaveLength(24);
      expect(result.hours[8].orderCount).toBe(5);
      expect(result.hours[12].orderCount).toBe(12);
      expect(result.hours[0].orderCount).toBe(0);
    });
  });

  describe('inventoryConsumption', () => {
    it('returns empty items when no branches', async () => {
      mockPrisma.branch.findMany.mockResolvedValue([]);
      const result = await service.inventoryConsumption('t1', 'OWNER', [], {});
      expect(result.items).toEqual([]);
    });
  });

  describe('lowStockSnapshot', () => {
    it('returns empty items when no branches', async () => {
      mockPrisma.branch.findMany.mockResolvedValue([]);
      const result = await service.lowStockSnapshot('t1', 'OWNER', [], {});
      expect(result.items).toEqual([]);
    });

    it('queries low stock items when branches exist', async () => {
      mockPrisma.branch.findFirst.mockResolvedValue({ id: 'b1', timezone: 'Africa/Addis_Ababa' });
      mockPrisma.$queryRaw.mockResolvedValue([{
        inventory_item_id: 'ii1',
        item_name: 'Flour',
        base_unit: 'kg',
        current_stock: '2',
        threshold: '10',
        is_low: true,
        branch_id: 'b1',
        branch_name: 'Main Branch',
      }]);
      const result = await service.lowStockSnapshot('t1', 'OWNER', [], { branchId: 'b1' });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].isLow).toBe(true);
      expect(result.items[0].itemName).toBe('Flour');
    });
  });

  describe('scope enforcement', () => {
    it('throws ForbiddenException for cashier role on tenant-wide', async () => {
      await expect(
        service.revenueSummary('t1', 'CASHIER', [], {}),
      ).rejects.toThrow('Insufficient permissions');
    });

    it('throws ForbiddenException for manager with no branches', async () => {
      await expect(
        service.revenueSummary('t1', 'MANAGER', [], {}),
      ).rejects.toThrow('Insufficient permissions');
    });

    it('allows manager with assigned branches', async () => {
      mockPrisma.branch.findMany.mockResolvedValue([{ id: 'b1', timezone: 'Africa/Addis_Ababa' }]);
      mockPrisma.$queryRaw.mockResolvedValue([]);
      const result = await service.revenueSummary('t1', 'MANAGER', ['b1'], {});
      expect(result.days).toEqual([]);
    });

    it('throws for unknown branch', async () => {
      mockPrisma.branch.findFirst.mockResolvedValue(null);
      await expect(
        service.revenueSummary('t1', 'OWNER', [], { branchId: 'nonexistent' }),
      ).rejects.toThrow('Branch not found');
    });
  });
});
