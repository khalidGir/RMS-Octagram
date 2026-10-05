import { vi, describe, it, expect, beforeEach } from 'vitest';
import { PriceCalculatorService } from './price-calculator.service';
import type { LineInput } from './price-calculator.service';
import type { PrismaService } from '../prisma/prisma.service';

function createMockPrisma() {
  return {
    menuItemVariant: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    branchMenuItem: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    branch: {
      findFirst: vi.fn().mockResolvedValue({ timezone: 'Africa/Addis_Ababa' }),
    },
    menuItemModifierGroup: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    modifierOption: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    tenantTaxConfiguration: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  };
}

describe('PriceCalculatorService — VAT', () => {
  let service: PriceCalculatorService;
  let prisma: ReturnType<typeof createMockPrisma>;

  const baseLines: LineInput[] = [
    { variantId: 'v1', quantity: 2 },
    { variantId: 'v2', quantity: 1 },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = createMockPrisma();
    service = new PriceCalculatorService(
      prisma as unknown as PrismaService,
    );
  });

  it('returns zero VAT when no tax config exists', async () => {
    prisma.menuItemVariant.findMany.mockResolvedValue([
      { id: 'v1', name: 'Regular', basePriceMinor: 5000n, isDefault: true, menuItem: { id: 'mi-1', name: 'Burger', sku: null } },
      { id: 'v2', name: 'Small', basePriceMinor: 2500n, isDefault: true, menuItem: { id: 'mi-2', name: 'Fries', sku: null } },
    ]);
    prisma.tenantTaxConfiguration.findFirst.mockResolvedValue(null);

    const result = await service.calculateCart('t1', 'b1', baseLines);

    expect(result.vatApplicable).toBe(false);
    expect(result.vatRateBps).toBe(0);
    expect(result.vatMinor).toBe(0n);
    expect(result.serviceChargeMinor).toBe(0n);
    expect(result.totalMinor).toBe(result.subtotalMinor);
    expect(result.taxConfigVersionId).toBeNull();
    expect(result.roundingMode).toBeNull();
  });

  it('applies 15% VAT correctly with DOWN rounding', async () => {
    prisma.menuItemVariant.findMany.mockResolvedValue([
      { id: 'v1', name: 'Regular', basePriceMinor: 5000n, isDefault: true, menuItem: { id: 'mi-1', name: 'Burger', sku: null } },
    ]);
    prisma.tenantTaxConfiguration.findFirst.mockResolvedValue({
      id: 'tax-1',
      vatApplicable: true,
      vatRate: 0.15,
      confirmedBy: 'owner-user-id',
      roundingMode: 'DOWN',
    });

    const lines: LineInput[] = [{ variantId: 'v1', quantity: 2 }];
    const result = await service.calculateCart('t1', 'b1', lines);

    // subtotal = 5000 * 2 = 10000
    // DOWN: 10000 * 1500 / 10000 = 1500
    expect(result.subtotalMinor).toBe(10000n);
    expect(result.vatApplicable).toBe(true);
    expect(result.vatRateBps).toBe(1500);
    expect(result.vatMinor).toBe(1500n);
    expect(result.serviceChargeMinor).toBe(0n);
    expect(result.totalMinor).toBe(11500n);
    expect(result.taxConfigVersionId).toBe('tax-1');
    expect(result.roundingMode).toBe('DOWN');
  });

  it('applies 15% VAT correctly with HALF_UP rounding', async () => {
    prisma.menuItemVariant.findMany.mockResolvedValue([
      { id: 'v1', name: 'Regular', basePriceMinor: 5000n, isDefault: true, menuItem: { id: 'mi-1', name: 'Burger', sku: null } },
    ]);
    prisma.tenantTaxConfiguration.findFirst.mockResolvedValue({
      id: 'tax-1',
      vatApplicable: true,
      vatRate: 0.15,
      confirmedBy: 'owner-user-id',
      roundingMode: 'HALF_UP',
    });

    const lines: LineInput[] = [{ variantId: 'v1', quantity: 2 }];
    const result = await service.calculateCart('t1', 'b1', lines);

    // subtotal = 10000, HALF_UP: 10000 * 1500 + 5000 / 10000 = 1500
    expect(result.subtotalMinor).toBe(10000n);
    expect(result.vatMinor).toBe(1500n);
    expect(result.totalMinor).toBe(11500n);
    expect(result.roundingMode).toBe('HALF_UP');
  });

  it('fractional VAT differs between DOWN and HALF_UP', async () => {
    prisma.menuItemVariant.findMany.mockResolvedValue([
      { id: 'v1', name: 'X', basePriceMinor: 333n, isDefault: true, menuItem: { id: 'mi-1', name: 'Item', sku: null } },
    ]);

    // DOWN rounding
    prisma.tenantTaxConfiguration.findFirst.mockResolvedValue({
      id: 'tax-down',
      vatApplicable: true,
      vatRate: 0.15,
      confirmedBy: 'owner-user-id',
      roundingMode: 'DOWN',
    });
    const downResult = await service.calculateCart('t1', 'b1', [{ variantId: 'v1', quantity: 1 }]);

    // subtotal = 333, DOWN: 333 * 1500 / 10000 = 499500 / 10000 = 49 (truncates)
    expect(downResult.subtotalMinor).toBe(333n);
    expect(downResult.vatMinor).toBe(49n);
    expect(downResult.totalMinor).toBe(382n);

    // HALF_UP rounding
    prisma.tenantTaxConfiguration.findFirst.mockResolvedValue({
      id: 'tax-halfup',
      vatApplicable: true,
      vatRate: 0.15,
      confirmedBy: 'owner-user-id',
      roundingMode: 'HALF_UP',
    });
    const halfUpResult = await service.calculateCart('t1', 'b1', [{ variantId: 'v1', quantity: 1 }]);

    // subtotal = 333, HALF_UP: (333 * 1500 + 5000) / 10000 = (499500 + 5000) / 10000 = 504500 / 10000 = 50
    expect(halfUpResult.subtotalMinor).toBe(333n);
    expect(halfUpResult.vatMinor).toBe(50n);
    expect(halfUpResult.totalMinor).toBe(383n);
  });

  it('handles very large subtotals beyond Number.MAX_SAFE_INTEGER', async () => {
    // Number.MAX_SAFE_INTEGER = 9007199254740991
    // Use a subtotal larger than that
    const largeSubtotal = 10000000000000000n; // 10^16 — larger than MAX_SAFE_INTEGER
    prisma.menuItemVariant.findMany.mockResolvedValue([
      { id: 'v1', name: 'Expensive', basePriceMinor: largeSubtotal, isDefault: true, menuItem: { id: 'mi-1', name: 'Premium Item', sku: null } },
    ]);
    prisma.tenantTaxConfiguration.findFirst.mockResolvedValue({
      id: 'tax-large',
      vatApplicable: true,
      vatRate: 0.15,
      confirmedBy: 'owner-user-id',
      roundingMode: 'DOWN',
    });

    const result = await service.calculateCart('t1', 'b1', [{ variantId: 'v1', quantity: 1 }]);

    // Pure BigInt arithmetic: 10000000000000000 * 1500 / 10000 = 1500000000000000
    expect(result.subtotalMinor).toBe(10000000000000000n);
    expect(result.vatMinor).toBe(1500000000000000n);
    expect(result.totalMinor).toBe(11500000000000000n);

    // HALF_UP with large value
    prisma.tenantTaxConfiguration.findFirst.mockResolvedValue({
      id: 'tax-large-hu',
      vatApplicable: true,
      vatRate: 0.15,
      confirmedBy: 'owner-user-id',
      roundingMode: 'HALF_UP',
    });
    const halfUpResult = await service.calculateCart('t1', 'b1', [{ variantId: 'v1', quantity: 1 }]);
    expect(halfUpResult.vatMinor).toBe(1500000000000000n);
  });

  it('returns zero VAT when config is unconfirmed (confirmation gate)', async () => {
    prisma.menuItemVariant.findMany.mockResolvedValue([
      { id: 'v1', name: 'Regular', basePriceMinor: 5000n, isDefault: true, menuItem: { id: 'mi-1', name: 'Burger', sku: null } },
    ]);
    prisma.tenantTaxConfiguration.findFirst.mockResolvedValue({
      id: 'tax-unconfirmed',
      vatApplicable: true,
      vatRate: 0.15,
      confirmedBy: null,
      roundingMode: 'DOWN',
    });

    const lines: LineInput[] = [{ variantId: 'v1', quantity: 1 }];
    const result = await service.calculateCart('t1', 'b1', lines);

    expect(result.vatApplicable).toBe(true);
    expect(result.vatMinor).toBe(0n);
    expect(result.totalMinor).toBe(result.subtotalMinor);
    expect(result.taxConfigVersionId).toBe('tax-unconfirmed');
    expect(result.roundingMode).toBeNull();
  });

  it('returns zero VAT when vatApplicable is false', async () => {
    prisma.menuItemVariant.findMany.mockResolvedValue([
      { id: 'v1', name: 'Regular', basePriceMinor: 5000n, isDefault: true, menuItem: { id: 'mi-1', name: 'Burger', sku: null } },
    ]);
    prisma.tenantTaxConfiguration.findFirst.mockResolvedValue({
      id: 'tax-3',
      vatApplicable: false,
      vatRate: 0,
      roundingMode: 'DOWN',
    });

    const lines: LineInput[] = [{ variantId: 'v1', quantity: 1 }];
    const result = await service.calculateCart('t1', 'b1', lines);

    expect(result.vatApplicable).toBe(false);
    expect(result.vatMinor).toBe(0n);
    expect(result.totalMinor).toBe(result.subtotalMinor);
    expect(result.roundingMode).toBeNull();
  });

  it('returns zero VAT for zero subtotal', async () => {
    prisma.menuItemVariant.findMany.mockResolvedValue([
      { id: 'v1', name: 'Free', basePriceMinor: 0n, isDefault: true, menuItem: { id: 'mi-1', name: 'Free Item', sku: null } },
    ]);
    prisma.tenantTaxConfiguration.findFirst.mockResolvedValue({
      id: 'tax-zero',
      vatApplicable: true,
      vatRate: 0.15,
      confirmedBy: 'owner-user-id',
      roundingMode: 'DOWN',
    });

    const result = await service.calculateCart('t1', 'b1', [{ variantId: 'v1', quantity: 1 }]);

    expect(result.subtotalMinor).toBe(0n);
    expect(result.vatMinor).toBe(0n);
    expect(result.totalMinor).toBe(0n);
  });

  it('returns zero totals for empty cart', async () => {
    const result = await service.calculateCart('t1', 'b1', []);

    expect(result.lines).toHaveLength(0);
    expect(result.subtotalMinor).toBe(0n);
    expect(result.vatMinor).toBe(0n);
    expect(result.serviceChargeMinor).toBe(0n);
    expect(result.totalMinor).toBe(0n);
    expect(result.taxConfigVersionId).toBeNull();
    expect(result.roundingMode).toBeNull();
  });

  it('service charge is always zero regardless of VAT config', async () => {
    prisma.menuItemVariant.findMany.mockResolvedValue([
      { id: 'v1', name: 'Regular', basePriceMinor: 5000n, isDefault: true, menuItem: { id: 'mi-1', name: 'Burger', sku: null } },
    ]);
    prisma.tenantTaxConfiguration.findFirst.mockResolvedValue({
      id: 'tax-4',
      vatApplicable: true,
      vatRate: 0.15,
      confirmedBy: 'owner-user-id',
      roundingMode: 'DOWN',
    });

    const lines: LineInput[] = [{ variantId: 'v1', quantity: 1 }];
    const result = await service.calculateCart('t1', 'b1', lines);

    expect(result.serviceChargeMinor).toBe(0n);
  });

  it('taxConfigVersionId is preserved even when roundingMode is null (VAT disabled)', async () => {
    prisma.menuItemVariant.findMany.mockResolvedValue([
      { id: 'v1', name: 'Regular', basePriceMinor: 5000n, isDefault: true, menuItem: { id: 'mi-1', name: 'Burger', sku: null } },
    ]);
    prisma.tenantTaxConfiguration.findFirst.mockResolvedValue({
      id: 'tax-preserved',
      vatApplicable: false,
      vatRate: 0,
      confirmedBy: null,
      roundingMode: 'DOWN',
    });

    const result = await service.calculateCart('t1', 'b1', [{ variantId: 'v1', quantity: 1 }]);

    // taxConfigVersionId should be set even when VAT is not applied
    expect(result.taxConfigVersionId).toBe('tax-preserved');
    expect(result.vatMinor).toBe(0n);
  });

  it('throws when roundingMode is missing but VAT is applicable and confirmed', async () => {
    prisma.menuItemVariant.findMany.mockResolvedValue([
      { id: 'v1', name: 'Regular', basePriceMinor: 5000n, isDefault: true, menuItem: { id: 'mi-1', name: 'Burger', sku: null } },
    ]);
    prisma.tenantTaxConfiguration.findFirst.mockResolvedValue({
      id: 'tax-nomode',
      vatApplicable: true,
      vatRate: 0.15,
      confirmedBy: 'owner-user-id',
      roundingMode: null,
    });

    await expect(
      service.calculateCart('t1', 'b1', [{ variantId: 'v1', quantity: 1 }]),
    ).rejects.toThrow('missing roundingMode');
  });

  it('throws when roundingMode is unsupported', async () => {
    prisma.menuItemVariant.findMany.mockResolvedValue([
      { id: 'v1', name: 'Regular', basePriceMinor: 5000n, isDefault: true, menuItem: { id: 'mi-1', name: 'Burger', sku: null } },
    ]);
    prisma.tenantTaxConfiguration.findFirst.mockResolvedValue({
      id: 'tax-badmode',
      vatApplicable: true,
      vatRate: 0.15,
      confirmedBy: 'owner-user-id',
      roundingMode: 'CEILING',
    });

    await expect(
      service.calculateCart('t1', 'b1', [{ variantId: 'v1', quantity: 1 }]),
    ).rejects.toThrow('Unsupported rounding mode');
  });

  it('taxConfigVersionId changes across config versions without affecting old calculations', async () => {
    prisma.menuItemVariant.findMany.mockResolvedValue([
      { id: 'v1', name: 'Regular', basePriceMinor: 5000n, isDefault: true, menuItem: { id: 'mi-1', name: 'Burger', sku: null } },
    ]);

    // Config v1
    prisma.tenantTaxConfiguration.findFirst.mockResolvedValue({
      id: 'tax-v1',
      vatApplicable: true,
      vatRate: 0.15,
      confirmedBy: 'owner-user-id',
      roundingMode: 'DOWN',
    });
    const v1 = await service.calculateCart('t1', 'b1', [{ variantId: 'v1', quantity: 1 }]);
    expect(v1.taxConfigVersionId).toBe('tax-v1');
    expect(v1.vatMinor).toBe(750n);

    // Config v2 with different rate
    prisma.tenantTaxConfiguration.findFirst.mockResolvedValue({
      id: 'tax-v2',
      vatApplicable: true,
      vatRate: 0.10,
      confirmedBy: 'owner-user-id',
      roundingMode: 'HALF_UP',
    });
    const v2 = await service.calculateCart('t1', 'b1', [{ variantId: 'v1', quantity: 1 }]);
    expect(v2.taxConfigVersionId).toBe('tax-v2');
    expect(v2.vatMinor).toBe(500n);
    expect(v2.roundingMode).toBe('HALF_UP');
  });

  // ─── Regression: exact Decimal(9,6) parsing (no floating-point) ──────

  it('preserves >4 decimal place VAT rate precision (Decimal(9,6) exact parsing)', async () => {
    prisma.menuItemVariant.findMany.mockResolvedValue([
      { id: 'v1', name: 'Item', basePriceMinor: 100000n, isDefault: true, menuItem: { id: 'mi-1', name: 'Item', sku: null } },
    ]);
    // Rate 0.005555 (0.5555%) — Math.round(Number(0.005555) * 10000) = 56 (wrong!)
    // Our code: numerator=5555, scale=6 → exact BigInt arithmetic
    prisma.tenantTaxConfiguration.findFirst.mockResolvedValue({
      id: 'tax-precise',
      vatApplicable: true,
      vatRate: '0.005555',
      confirmedBy: 'owner-user-id',
      roundingMode: 'DOWN',
    });

    const result = await service.calculateCart('t1', 'b1', [{ variantId: 'v1', quantity: 1 }]);

    // subtotal=100000, DOWN: 100000 * 5555 / 10^6 = 555500000 / 1000000 = 555
    expect(result.subtotalMinor).toBe(100000n);
    expect(result.vatMinor).toBe(555n);
    expect(result.totalMinor).toBe(100555n);
    // Old code would give 560n (Math.round(55.55)=56 → 100000*56/10000=560)
    // New code gives 555n (exact)
  });

  it('VAT that rounds to zero still snapshots roundingMode', async () => {
    prisma.menuItemVariant.findMany.mockResolvedValue([
      { id: 'v1', name: 'Tiny', basePriceMinor: 1n, isDefault: true, menuItem: { id: 'mi-1', name: 'Tiny', sku: null } },
    ]);
    // Rate 0.000100 (0.01%): subtotal=1 → product=1*100=100, divisor=10^6=1000000
    // 100 / 1000000 = 0n (rounds to zero)
    prisma.tenantTaxConfiguration.findFirst.mockResolvedValue({
      id: 'tax-rounds-zero',
      vatApplicable: true,
      vatRate: '0.000100',
      confirmedBy: 'owner-user-id',
      roundingMode: 'DOWN',
    });

    const result = await service.calculateCart('t1', 'b1', [{ variantId: 'v1', quantity: 1 }]);

    expect(result.subtotalMinor).toBe(1n);
    expect(result.vatMinor).toBe(0n);
    expect(result.totalMinor).toBe(1n);
    // roundingMode MUST be snapshot even when VAT rounds to zero
    expect(result.roundingMode).toBe('DOWN');
    expect(result.taxConfigVersionId).toBe('tax-rounds-zero');
  });

  it('exact BigInt computation — no floating-point drift on 6.75% rate', async () => {
    prisma.menuItemVariant.findMany.mockResolvedValue([
      { id: 'v1', name: 'Item', basePriceMinor: 5000n, isDefault: true, menuItem: { id: 'mi-1', name: 'Item', sku: null } },
    ]);
    // Rate 0.067500 (6.75%): numerator=67500, scale=6
    prisma.tenantTaxConfiguration.findFirst.mockResolvedValue({
      id: 'tax-675',
      vatApplicable: true,
      vatRate: '0.067500',
      confirmedBy: 'owner-user-id',
      roundingMode: 'DOWN',
    });

    const lines: LineInput[] = [{ variantId: 'v1', quantity: 3 }];
    const result = await service.calculateCart('t1', 'b1', lines);

    // subtotal = 5000 * 3 = 15000
    // DOWN: 15000 * 67500 / 10^6 = 1012500000 / 1000000 = 1012
    expect(result.subtotalMinor).toBe(15000n);
    expect(result.vatRateBps).toBe(675);
    expect(result.vatMinor).toBe(1012n);
    expect(result.totalMinor).toBe(16012n);

    // HALF_UP: (15000 * 67500 + 500000) / 1000000 = (1012500000 + 500000) / 1000000 = 1013
    prisma.tenantTaxConfiguration.findFirst.mockResolvedValue({
      id: 'tax-675-hu',
      vatApplicable: true,
      vatRate: '0.067500',
      confirmedBy: 'owner-user-id',
      roundingMode: 'HALF_UP',
    });
    const halfUpResult = await service.calculateCart('t1', 'b1', lines);
    expect(halfUpResult.vatMinor).toBe(1013n);
    expect(halfUpResult.totalMinor).toBe(16013n);
  });
});
