import { vi, describe, it, expect, beforeEach } from 'vitest';
import { OrdersService } from './orders.service';
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { BranchOrderCounterService } from './branch-order-counter.service';
import type { IdempotencyService } from './idempotency.service';
import type { PriceCalculatorService } from './price-calculator.service';
import type { LineInput } from './price-calculator.service';
import type { FeatureResolver } from '../features/feature-resolver.service';

function createMockPrisma() {
  return {
    order: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn().mockResolvedValue({ id: 'order-1', orderNumber: 1n, status: 'DRAFT', version: 1, lines: [] }), create: vi.fn(), update: vi.fn() },
    orderLine: { create: vi.fn(), deleteMany: vi.fn() },
    orderLineModifier: { create: vi.fn(), deleteMany: vi.fn() },
    orderStatusHistory: { create: vi.fn() },
    outboxEvent: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    featureSetting: { findFirst: vi.fn() },
    branch: { findFirst: vi.fn() },
    restaurantTable: { findFirst: vi.fn() },
    $transaction: vi.fn(async (fn: any) => fn({
      order: { create: vi.fn().mockResolvedValue({ id: 'order-1', orderNumber: 1n, status: 'DRAFT', version: 1 }) },
      orderLine: { create: vi.fn().mockResolvedValue({ id: 'line-1' }) },
      orderLineModifier: { create: vi.fn() },
      orderStatusHistory: { create: vi.fn() },
      outboxEvent: { create: vi.fn() },
      auditLog: { create: vi.fn() },
    })),
  };
}

const baseTableOrderParams = {
  tenantId: 't1',
  branchId: 'b1',
  tableId: 'table-1',
  lines: [{ variantId: 'v1', quantity: 1 }] as LineInput[],
};

const basePosOrderParams = {
  tenantId: 't1',
  branchId: 'b1',
  lines: [{ variantId: 'v1', quantity: 1 }] as LineInput[],
  orderType: 'POS',
  createdByUserId: 'user-1',
};

describe('OrdersService', () => {
  let service: OrdersService;
  let prisma: ReturnType<typeof createMockPrisma>;
  let mockCounter: BranchOrderCounterService;
  let mockIdempotency: IdempotencyService;
  let mockPriceCalc: PriceCalculatorService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = createMockPrisma();

    mockCounter = {
      nextOrderNumber: vi.fn().mockResolvedValue(1n),
    } as unknown as BranchOrderCounterService;

    mockIdempotency = {
      withIdempotency: vi.fn().mockImplementation(async (params: any, handler: any) => {
        const result = await handler();
        return { result, reused: false };
      }),
    } as unknown as IdempotencyService;

    mockPriceCalc = {
      calculateCart: vi.fn().mockResolvedValue({
        lines: [{
          menuItemId: 'mi-1',
          variantId: 'v1',
          itemNameSnapshot: 'Burger',
          variantNameSnapshot: 'Regular',
          skuSnapshot: null,
          unitPriceMinor: 5000n,
          quantity: 1,
          lineTotalMinor: 5000n,
          modifiers: [],
        }],
        subtotalMinor: 5000n,
      }),
    } as unknown as PriceCalculatorService;

    service = new OrdersService(
      prisma as unknown as PrismaService,
      mockCounter,
      mockIdempotency,
      mockPriceCalc,
      {
        assertEffective: vi.fn().mockResolvedValue(undefined),
        resolve: vi.fn().mockResolvedValue({ effective: true }),
        resolveAll: vi.fn().mockResolvedValue({}),
        getCatalog: vi.fn().mockReturnValue([]),
      } as unknown as FeatureResolver,
    );
  });

  describe('line deduplication', () => {
    it('merges lines with same variant+modifiers+notes', async () => {
      prisma.branch.findFirst.mockResolvedValue({ id: 'b1', isActive: true });
      prisma.featureSetting.findFirst.mockResolvedValue(null);

      const lines: LineInput[] = [
        { variantId: 'v1', quantity: 2, notes: 'No onions' },
        { variantId: 'v1', quantity: 3, notes: 'No onions' },
      ];

      await service.createTableOrder({ ...baseTableOrderParams, lines });

      // Price calculator should receive deduplicated lines (1 line, qty=5)
      expect(mockPriceCalc.calculateCart).toHaveBeenCalledWith(
        't1', 'b1',
        expect.arrayContaining([
          expect.objectContaining({ variantId: 'v1', quantity: 5 }),
        ]),
      );
    });

    it('keeps lines with different notes separate', async () => {
      prisma.branch.findFirst.mockResolvedValue({ id: 'b1', isActive: true });
      prisma.featureSetting.findFirst.mockResolvedValue(null);

      const lines: LineInput[] = [
        { variantId: 'v1', quantity: 2, notes: 'No onions' },
        { variantId: 'v1', quantity: 3, notes: 'Extra cheese' },
      ];

      await service.createTableOrder({ ...baseTableOrderParams, lines });

      // Price calculator should receive 2 separate lines
      const calcLines = mockPriceCalc.calculateCart.mock.calls[0][2];
      expect(calcLines).toHaveLength(2);
    });

    it('merges lines without notes separately from lines with notes', async () => {
      prisma.branch.findFirst.mockResolvedValue({ id: 'b1', isActive: true });
      prisma.featureSetting.findFirst.mockResolvedValue(null);

      const lines: LineInput[] = [
        { variantId: 'v1', quantity: 1 },
        { variantId: 'v1', quantity: 1, notes: 'Special request' },
      ];

      await service.createTableOrder({ ...baseTableOrderParams, lines });

      const calcLines = mockPriceCalc.calculateCart.mock.calls[0][2];
      expect(calcLines).toHaveLength(2);
    });
  });

  describe('POS order validation', () => {
    it('rejects tableId for POS order type', async () => {
      prisma.branch.findFirst.mockResolvedValue({ id: 'b1', isActive: true });

      await expect(
        service.createPosOrder({ ...basePosOrderParams, tableId: 'table-1' }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects tableId for PICKUP order type', async () => {
      prisma.branch.findFirst.mockResolvedValue({ id: 'b1', isActive: true });

      await expect(
        service.createPosOrder({ ...basePosOrderParams, orderType: 'PICKUP', tableId: 'table-1' }),
      ).rejects.toThrow(ConflictException);
    });

    it('requires tableId for DINE_IN order type', async () => {
      prisma.branch.findFirst.mockResolvedValue({ id: 'b1', isActive: true });

      await expect(
        service.createPosOrder({ ...basePosOrderParams, orderType: 'DINE_IN' }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects inactive table for DINE_IN', async () => {
      prisma.branch.findFirst.mockResolvedValue({ id: 'b1', isActive: true });
      prisma.restaurantTable.findFirst.mockResolvedValue(null);

      await expect(
        service.createPosOrder({ ...basePosOrderParams, orderType: 'DINE_IN', tableId: 'inactive-table' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects table from wrong branch for DINE_IN', async () => {
      prisma.branch.findFirst.mockResolvedValue({ id: 'b1', isActive: true });
      // Table belongs to different branch — findFirst returns null
      prisma.restaurantTable.findFirst.mockResolvedValue(null);

      await expect(
        service.createPosOrder({ ...basePosOrderParams, orderType: 'DINE_IN', tableId: 'wrong-branch-table' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
