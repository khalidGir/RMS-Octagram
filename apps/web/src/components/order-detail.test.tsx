import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as baseRender, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '@/components/locale-provider';
import { apiRequest, ApiError } from '@/lib/api-client';
import type * as ApiClient from '@/lib/api-client';
import { OrderDetail } from './order-detail';

const authState = vi.hoisted(() => ({ role: 'CASHIER' as string | undefined }));

vi.mock('@/lib/api-client', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof ApiClient;
  return { ...actual, apiRequest: vi.fn() };
});

vi.mock('@/components/auth-provider', () => ({
  useAuth: () => ({
    accessToken: 'test-token',
    csrfToken: 'csrf',
    profile: { memberships: [{ tenant: { id: 't1' }, role: authState.role }] },
  }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const mockApiRequest = vi.mocked(apiRequest);

function orderFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'o-1',
    orderNumber: 'ORD-1001',
    orderType: 'POS',
    status: 'PENDING_PAYMENT',
    customerName: null,
    customerPhone: null,
    tableId: null,
    currency: 'ETB',
    subtotalMinor: '50000',
    discountMinor: '0',
    taxMinor: '7500',
    serviceChargeMinor: '0',
    totalMinor: '57500',
    notes: null,
    source: 'POS',
    confirmedAt: null,
    completedAt: null,
    cancelledAt: null,
    version: 3,
    createdAt: '2024-01-01T10:00:00Z',
    updatedAt: '2024-01-01T10:00:00Z',
    lines: [
      {
        id: 'l-1',
        itemNameSnapshot: 'Special Tibs',
        variantNameSnapshot: 'Regular',
        unitPriceMinor: '25000',
        quantity: 2,
        lineTotalMinor: '50000',
        notes: null,
        modifiers: [],
      },
    ],
    statusHistory: [],
    ...overrides,
  };
}

function receiptFixture() {
  return {
    receiptNumber: 'RMS-1001',
    restaurantName: 'Demo Coffee House',
    branchName: 'Main Branch',
    branchPhone: null,
    orderNumber: 'ORD-1001',
    orderType: 'POS',
    tableLabel: null,
    currency: 'ETB',
    subtotalMinor: '50000',
    discountMinor: '0',
    taxMinor: '7500',
    serviceChargeMinor: '0',
    totalMinor: '57500',
    settledAt: '2024-01-01T10:05:00Z',
    payment: { method: 'CASH', status: 'APPROVED', amountMinor: '57500', currency: 'ETB', reference: null },
    lines: [
      { itemName: 'Special Tibs', variantName: 'Regular', quantity: 2, unitPriceMinor: '25000', lineTotalMinor: '50000', modifiers: [] },
    ],
  };
}

function render(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return baseRender(
    <LocaleProvider>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </LocaleProvider>,
  );
}

describe('OrderDetail edit and cancel actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.role = 'CASHIER';
    mockApiRequest.mockImplementation((async (url: string, options?: { method?: string }) => {
      if (options?.method === 'POST') return { data: {} };
      if (url.includes('kitchen-tickets')) return { data: [] };
      return { data: orderFixture() };
    }) as never);
  });

  it('shows edit and cancel actions for a cashier on an editable order', async () => {
    render(<OrderDetail orderId="o-1" />);
    await waitFor(() => {
      const actions = screen.getByTestId('order-actions');
      const editLink = screen.getByRole('link', { name: 'Edit order' });
      expect(editLink.getAttribute('href')).toBe('/pos?edit=o-1');
      expect(actions).toBeDefined();
      expect(screen.getByRole('button', { name: 'Cancel order' })).toBeDefined();
    });
  });

  it('hides actions for a non-manage role', async () => {
    authState.role = 'WAITER';
    render(<OrderDetail orderId="o-1" />);
    await waitFor(() => {
      expect(screen.getByText(/ORD-1001/)).toBeDefined();
    });
    expect(screen.queryByTestId('order-actions')).toBeNull();
  });

  it('hides actions once the order is confirmed', async () => {
    mockApiRequest.mockImplementation((async (url: string, options?: { method?: string }) => {
      if (options?.method === 'POST') return { data: {} };
      if (url.includes('kitchen-tickets')) return { data: [] };
      return { data: orderFixture({ status: 'CONFIRMED' }) };
    }) as never);
    render(<OrderDetail orderId="o-1" />);
    await waitFor(() => {
      expect(screen.getByText(/ORD-1001/)).toBeDefined();
    });
    expect(screen.queryByTestId('order-actions')).toBeNull();
  });

  it('cancels the order with its expected version', async () => {
    render(<OrderDetail orderId="o-1" />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cancel order' })).toBeDefined();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel order' }));
    const dialog = await screen.findByRole('dialog', { name: 'Cancel this order?' });
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Customer left' } });
    fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel order' }));

    await waitFor(() => {
      const postCall = mockApiRequest.mock.calls.find(
        ([url, options]) => url === '/orders/o-1/cancel' && (options as { method?: string })?.method === 'POST',
      );
      expect(postCall).toBeDefined();
      expect((postCall![1] as { body?: unknown }).body).toEqual({
        reason: 'Customer left',
        expectedVersion: 3,
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(dialog).toBeDefined();
  });

  it('opens the staff receipt with print and download actions', async () => {
    mockApiRequest.mockImplementation((async (url: string, options?: { method?: string }) => {
      if (options?.method === 'POST') return { data: {} };
      if (url.includes('kitchen-tickets')) return { data: [] };
      if (url.includes('/receipt')) return { data: receiptFixture() };
      return { data: orderFixture() };
    }) as never);
    render(<OrderDetail orderId="o-1" />);
    await waitFor(() => {
      expect(screen.getByText(/ORD-1001/)).toBeDefined();
    });

    fireEvent.click(screen.getByRole('button', { name: 'View receipt' }));
    const dialog = await screen.findByRole('dialog', { name: 'Receipt' });
    expect(dialog.textContent).toContain('not a fiscal-device receipt');
    expect(dialog.textContent).toContain('RMS-1001');
    expect(screen.getByRole('button', { name: 'Print receipt' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Download receipt' })).toBeDefined();
  });

  it('shows a version-conflict message and refetches on a 409 cancel', async () => {
    mockApiRequest.mockImplementation((async (url: string, options?: { method?: string }) => {
      if (options?.method === 'POST') {
        throw new ApiError(409, 'version conflict', undefined, { code: 'VERSION_CONFLICT' });
      }
      if (url.includes('kitchen-tickets')) return { data: [] };
      return { data: orderFixture() };
    }) as never);
    render(<OrderDetail orderId="o-1" />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cancel order' })).toBeDefined();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel order' }));
    await screen.findByRole('dialog', { name: 'Cancel this order?' });
    fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel order' }));

    await waitFor(() => {
      expect(
        screen.getByText('The order changed. It has been refreshed — please try again.'),
      ).toBeDefined();
    });
  });
});
