import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ShiftHistory } from './shift-history';
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

const report = {
  id: 'rep-1',
  cashShiftId: 'shift-1',
  openingCashMinor: '50000',
  approvedCashMinor: '120000',
  expectedCashMinor: '170000',
  countedCashMinor: '168000',
  varianceMinor: '-2000',
  varianceReason: 'Customer change dispute',
  orderCount: 14,
  paymentCount: 12,
  localOpenedAt: '2026-09-30T15:00:00.000Z',
  localClosedAt: '2026-09-30T21:30:00.000Z',
  localBusinessDate: '2026-09-30T00:00:00.000Z',
};

const mockedApiRequest = vi.mocked(apiRequest);

function renderHistory() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ShiftHistory />
    </QueryClientProvider>,
  );
}

describe('ShiftHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.role = 'OWNER';
  });

  it('lists closed shift reports for owner', async () => {
    mockedApiRequest.mockResolvedValue({ data: [report] } as never);
    renderHistory();
    expect(await screen.findByText('Past shifts')).toBeDefined();
    expect(await screen.findByText('2026-09-30')).toBeDefined();
    expect(screen.getByText('ETB 1,680')).toBeDefined();
    expect(screen.getByText('\u2212ETB 20')).toBeDefined();
    expect(screen.getByText('reason given')).toBeDefined();
    expect(screen.getByText('14')).toBeDefined();
    expect(mockedApiRequest).toHaveBeenCalledWith(
      '/branches/branch-1/shifts/reports',
      expect.objectContaining({ accessToken: 'test-token', tenantId: 'tenant-1' }),
    );
  });

  it('shows empty state when nothing is closed yet', async () => {
    mockedApiRequest.mockResolvedValue({ data: [] } as never);
    renderHistory();
    expect(await screen.findByText(/No closed shifts yet/)).toBeDefined();
  });

  it('renders nothing for cashier', () => {
    authState.role = 'CASHIER';
    const { container } = renderHistory();
    expect(container.innerHTML).toBe('');
    expect(mockedApiRequest).not.toHaveBeenCalled();
  });

  it('shows retry on load failure', async () => {
    mockedApiRequest.mockRejectedValue(new Error('network down'));
    renderHistory();
    expect(await screen.findByText('Could not load past shifts.')).toBeDefined();
    mockedApiRequest.mockResolvedValue({ data: [report] } as never);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('2026-09-30')).toBeDefined();
  });
});
