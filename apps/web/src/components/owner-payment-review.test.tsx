import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as baseRender, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '@/components/locale-provider';
import { apiRequest } from '@/lib/api-client';
import type * as ApiClient from '@/lib/api-client';
import { OwnerPaymentReview } from './owner-payment-review';
import { BranchProvider, useBranch } from './shell/branch-provider';

vi.mock('@/lib/api-client', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof ApiClient;
  return { ...actual, apiRequest: vi.fn() };
});

vi.mock('@/components/auth-provider', () => ({
  useAuth: () => ({
    accessToken: 'test-token',
    csrfToken: 'csrf',
    loading: false,
    profile: {
      memberships: [
        {
          tenant: { id: 't1' },
          role: 'OWNER',
          branchAssignments: [
            { branchId: 'b1', branch: { id: 'b1', name: 'Main', slug: 'main', isActive: true } },
            { branchId: 'b2', branch: { id: 'b2', name: 'Bole', slug: 'bole', isActive: true } },
          ],
        },
      ],
    },
  }),
}));

const mockApiRequest = vi.mocked(apiRequest);

function paymentFixture(branch: string) {
  const orderNumber = branch === 'b2' ? 'ORD-2002' : 'ORD-1001';
  return {
    id: branch === 'b2' ? 'p2' : 'p1',
    method: 'CASH',
    status: 'PENDING_VERIFICATION',
    amountMinor: '10000',
    customerReference: null,
    submittedAt: '2024-01-01T10:00:00Z',
    createdAt: '2024-01-01T10:00:00Z',
    order: { orderNumber, totalMinor: '10000', customerName: null, status: 'PENDING_PAYMENT' },
    proofs: [{ scanStatus: 'PENDING', isCurrent: true }],
    reviewedAt: null,
    version: 1,
  };
}

function BranchSwitch() {
  const { setBranchId } = useBranch();
  return <button onClick={() => setBranchId('b2')}>switch-to-b2</button>;
}

function render(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return baseRender(
    <LocaleProvider>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </LocaleProvider>,
  );
}

describe('OwnerPaymentReview branch reactivity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.setItem('rms-branch-id', 'b1');
    mockApiRequest.mockImplementation((async (url: string) => {
      if (url.includes('/payments?status=')) {
        const branch = url.includes('/branches/b2/') ? 'b2' : 'b1';
        return { data: [paymentFixture(branch)] };
      }
      if (url.endsWith('/payments/p1')) return { data: paymentFixture('b1') };
      if (url.endsWith('/payments/p2')) return { data: paymentFixture('b2') };
      if (url.includes('proof-url')) return { data: { url: 'https://proof.example/x', expiresIn: 60 } };
      return { data: {} };
    }) as never);
  });

  it('loads the queue for the branch from the provider and auto-selects', async () => {
    render(
      <BranchProvider>
        <OwnerPaymentReview />
        <BranchSwitch />
      </BranchProvider>,
    );

    await waitFor(() => {
      const call = mockApiRequest.mock.calls.find(([url]) =>
        url.includes('/branches/b1/payments?status=PENDING_VERIFICATION&limit=50'),
      );
      expect(call).toBeDefined();
    });
    expect(await screen.findByText(/ORD-1001/)).toBeDefined();
    await waitFor(() => {
      const detailCall = mockApiRequest.mock.calls.find(
        ([url]) => url.endsWith('/branches/b1/payments/p1') && !url.includes('?'),
      );
      expect(detailCall).toBeDefined();
    });
  });

  it('switches the queue to the new branch and drops the previous selection', async () => {
    render(
      <BranchProvider>
        <OwnerPaymentReview />
        <BranchSwitch />
      </BranchProvider>,
    );
    expect(await screen.findByText(/ORD-1001/)).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'switch-to-b2' }));

    await waitFor(() => {
      const call = mockApiRequest.mock.calls.find(([url]) =>
        url.includes('/branches/b2/payments?status=PENDING_VERIFICATION&limit=50'),
      );
      expect(call).toBeDefined();
    });
    expect(await screen.findByText(/ORD-2002/)).toBeDefined();
    // The previous branch's payment must not survive the switch anywhere.
    await waitFor(() => {
      expect(screen.queryByText(/ORD-1001/)).toBeNull();
    });
    // Detail must be re-fetched under the new branch, not reused from b1.
    await waitFor(() => {
      const detailCall = mockApiRequest.mock.calls.find(
        ([url]) => url.endsWith('/branches/b2/payments/p2') && !url.includes('?'),
      );
      expect(detailCall).toBeDefined();
    });
    const staleDetail = mockApiRequest.mock.calls.find(([url]) => url.includes('/branches/b2/payments/p1'));
    expect(staleDetail).toBeUndefined();
  });
});
