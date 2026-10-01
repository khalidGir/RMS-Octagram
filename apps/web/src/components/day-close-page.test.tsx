import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DayClosePage } from './day-close-page';
import { apiRequest } from '@/lib/api-client';
import type * as ApiClient from '@/lib/api-client';

vi.mock('@/lib/api-client', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof ApiClient;
  return { ...actual, apiRequest: vi.fn() };
});

const authState = vi.hoisted(() => ({ role: 'OWNER' as string }));

vi.mock('@/components/auth-provider', () => ({
  useAuth: () => ({
    accessToken: 'test-token',
    csrfToken: 'test-csrf',
    profile: {
      memberships: [
        {
          role: authState.role,
          tenant: { id: 'tenant-1' },
          branchAssignments: [{ branch: { id: 'branch-1', name: 'Main', slug: 'main', isActive: true } }],
        },
      ],
    },
  }),
}));

vi.mock('@/components/shell/branch-provider', () => ({
  useBranch: () => ({ branchId: 'branch-1', branches: [], setBranchId: vi.fn() }),
}));

const emptyPayments = {
  cash: { approvedMinor: 0, pendingMinor: 0, count: 0 },
  bankTransfer: { approvedMinor: 0, pendingMinor: 0, count: 0 },
  telebirr: { approvedMinor: 0, pendingMinor: 0, count: 0 },
  manualTransfer: { pendingVerificationMinor: 0, count: 0 },
};
const emptyOrders = {
  confirmed: { count: 0, totalMinor: 0 },
  cancelled: { count: 0, totalMinor: 0 },
  voided: { count: 0, totalMinor: 0 },
  pendingPayment: { count: 0, totalMinor: 0 },
};

function previewOf(overrides: Record<string, unknown> = {}) {
  return {
    localBusinessDate: '2026-10-01',
    branchTimezone: 'Africa/Addis_Ababa',
    businessDayCutoffLocal: '06:00',
    utcStart: '2026-09-30T03:00:00.000Z',
    utcEnd: '2026-10-01T03:00:00.000Z',
    shiftReports: [],
    openShifts: [],
    paymentTotals: emptyPayments,
    orderTotals: emptyOrders,
    blockers: [],
    status: 'READY',
    ...overrides,
  };
}

function closedRecord() {
  return {
    close: {
      id: 'close-1',
      status: 'CLOSED',
      closedWithException: false,
      reason: null,
      closedAt: '2026-10-01T18:00:00.000Z',
      reopenedAt: null,
      reopenReason: null,
      version: 1,
    },
    snapshot: {
      localBusinessDate: '2026-10-01',
      branchTimezone: 'Africa/Addis_Ababa',
      businessDayCutoffLocal: '06:00',
      closedAt: '2026-10-01T18:00:00.000Z',
      closedWithException: true,
      reason: 'Power cut, closing early',
      reopenedAt: null,
      reopenReason: null,
      expectedCashMinor: 100000,
      countedCashMinor: 98000,
      cashVarianceMinor: -2000,
      bankTransferTotalMinor: 50000,
      bankTransferCount: 2,
      telebirrTotalMinor: 0,
      telebirrCount: 0,
      recognizedSalesMinor: 250000,
      recognizedSalesCount: 9,
      cancelledTotalMinor: 0,
      cancelledCount: 0,
      voidedTotalMinor: 0,
      voidedCount: 0,
      pendingPaymentTotalMinor: 0,
      pendingPaymentCount: 0,
      pendingManualTransferMinor: 0,
      pendingManualTransferCount: 0,
      inventoryExceptions: [],
    },
  };
}

const mockedApiRequest = vi.mocked(apiRequest);

function mockEndpoints({ preview, current }: { preview: unknown; current: unknown }) {
  mockedApiRequest.mockImplementation(async (path: string) => {
    if (path.includes('/day-close/preview')) return { data: preview } as never;
    if (path.includes('/day-close/current')) return { data: current } as never;
    throw new Error(`Unexpected path: ${path}`);
  });
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DayClosePage />
    </QueryClientProvider>,
  );
}

describe('DayClosePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.role = 'OWNER';
  });

  it('shows ready status and close button for owner on a clean day', async () => {
    mockEndpoints({ preview: previewOf(), current: null });
    renderPage();
    expect(await screen.findByText('Ready to close')).toBeDefined();
    expect(screen.getByText('Day close')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Close business day' })).toBeDefined();
    expect(screen.queryByText('Must be resolved before a normal close')).toBeNull();
  });

  it('blocks normal close, lists blockers and gates exception close behind a reason', async () => {
    mockEndpoints({
      preview: previewOf({
        status: 'BLOCKED',
        blockers: ['2 open cashier shift(s) must be closed first'],
      }),
      current: null,
    });
    renderPage();
    expect(await screen.findByText('Blocked')).toBeDefined();
    expect(screen.getByText('2 open cashier shift(s) must be closed first')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Close business day' })).toBeNull();

    fireEvent.click(screen.getByLabelText('Close with exception anyway (blockers stay documented in the snapshot)'));
    const exceptionButton = await screen.findByRole('button', { name: 'Close with exception' });
    expect(exceptionButton).toHaveProperty('disabled', true);

    fireEvent.change(screen.getByPlaceholderText('Required, up to 500 characters'), {
      target: { value: 'Closing early due to emergency' },
    });
    expect(screen.getByRole('button', { name: 'Close with exception' })).toHaveProperty('disabled', false);
  });

  it('lets owner close a ready day with a normal close', async () => {
    mockEndpoints({ preview: previewOf(), current: null });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Close business day' }));
    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        '/branches/branch-1/day-close/close',
        expect.objectContaining({ method: 'POST', body: {} }),
      );
    });
  });

  it('shows read-only view to manager', async () => {
    authState.role = 'MANAGER';
    mockEndpoints({
      preview: previewOf({ status: 'BLOCKED', blockers: ['1 manual transfer(s) pending verification'] }),
      current: null,
    });
    renderPage();
    expect(await screen.findByText('Blocked')).toBeDefined();
    expect(screen.getByText(/Only the Owner can close or reopen the business day/)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Close business day' })).toBeNull();
    expect(screen.queryByLabelText('Close with exception anyway (blockers stay documented in the snapshot)')).toBeNull();
  });

  it('renders immutable snapshot for a closed day with reopen action for owner', async () => {
    mockEndpoints({ preview: previewOf({ status: 'ALREADY_CLOSED' }), current: closedRecord() });
    renderPage();
    expect(await screen.findByText('Business day closed')).toBeDefined();
    expect(screen.getByText('Closed with exception')).toBeDefined();
    expect(screen.getByText('Power cut, closing early')).toBeDefined();
    expect(screen.getByText('Recognised sales')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Reopen day' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Close business day' })).toBeNull();
  });

  it('denies non staff roles', async () => {
    authState.role = 'CASHIER';
    mockEndpoints({ preview: previewOf(), current: null });
    renderPage();
    expect(await screen.findByText('Permission denied')).toBeDefined();
    expect(mockedApiRequest).not.toHaveBeenCalled();
  });
});
