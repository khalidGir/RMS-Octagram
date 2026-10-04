import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from './locale-provider';
import { ReceiptDialog } from './receipt-viewer';
import type { ReceiptData } from '@/lib/receipt';

const receipt: ReceiptData = {
  receiptNumber: 'RMS-42', restaurantName: 'Buna House', branchName: 'Bole Main', branchPhone: null,
  orderNumber: '42', orderType: 'DINE_IN', tableLabel: 'T4', currency: 'ETB', subtotalMinor: '10000',
  discountMinor: '0', taxMinor: '1500', serviceChargeMinor: '0', totalMinor: '11500', settledAt: '2026-10-04T10:00:00Z',
  payment: { method: 'CASH', status: 'APPROVED', amountMinor: '11500', currency: 'ETB', reference: null },
  lines: [{ itemName: 'Shiro', variantName: 'Regular', quantity: 1, unitPriceMinor: '10000', lineTotalMinor: '10000', modifiers: [{ name: 'Spicy', quantity: 1, unitPriceDeltaMinor: '0', totalDeltaMinor: '0' }] }],
};

describe('ReceiptDialog', () => {
  it('renders stored snapshots, payment method, and non-fiscal notice', () => {
    render(<LocaleProvider><ReceiptDialog receipt={receipt} onClose={vi.fn()} /></LocaleProvider>);
    expect(screen.getByText('Buna House')).toBeInTheDocument();
    expect(screen.getByText(/1 × Shiro \(Regular\)/)).toBeInTheDocument();
    expect(screen.getByText('+ Spicy')).toBeInTheDocument();
    expect(screen.getByText('Paid by CASH')).toBeInTheDocument();
    expect(screen.getByText(/not a fiscal-device receipt/i)).toBeInTheDocument();
  });
});
