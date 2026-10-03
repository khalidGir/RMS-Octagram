import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as baseRender, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '@/components/locale-provider';
import { apiRequest } from '@/lib/api-client';
import type * as ApiClient from '@/lib/api-client';
import { TablesManagement } from './tables-management';

const authState = vi.hoisted(() => ({ role: 'OWNER' as string | undefined }));

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

vi.mock('@/components/shell/branch-provider', () => ({
  useBranch: () => ({ branchId: 'b1' }),
}));

const mockApiRequest = vi.mocked(apiRequest);

function tableFixture() {
  return {
    tableId: 'tbl-1',
    label: 'T1',
    capacity: 4,
    isActive: true,
    sessionId: null,
    sessionStatus: null,
    openOrderCount: 0,
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

function mockLists() {
  return (async (url: string, options?: { method?: string }) => {
    if (url.includes('qr-token/rotate')) return { data: { raw: 'raw-abc123', version: 2 } };
    if (url.endsWith('/tables') && options?.method === 'POST') {
      return { data: { id: 'tbl-2', qrTokenRaw: 'raw-new456' } };
    }
    if (url.includes('table-operations')) return { data: [tableFixture()] };
    if (url.includes('dining-areas')) return { data: [] };
    if (url.includes('sessions')) return { data: [] };
    return { data: [] };
  }) as never;
}

describe('TablesManagement QR codes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.role = 'OWNER';
    mockApiRequest.mockImplementation(mockLists());
  });

  it('rotates the QR token from the card and shows the ordering URL', async () => {
    render(<TablesManagement />);
    const qrButton = await screen.findByRole('button', { name: 'QR code' });
    fireEvent.click(qrButton);

    const dialog = await screen.findByRole('dialog', { name: 'QR code for table T1' });
    expect(screen.getByText(/replaces the current one/)).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Generate QR code' }));

    await waitFor(() => {
      const call = mockApiRequest.mock.calls.find(
        ([url, options]) =>
          url === '/branches/b1/tables/tbl-1/qr-token/rotate' &&
          (options as { method?: string })?.method === 'POST',
      );
      expect(call).toBeDefined();
    });
    expect(await screen.findByText(/\/o\/raw-abc123/)).toBeDefined();
    // The dialog renders in a portal, so query the document, not the container.
    expect(document.querySelector('.qr-print-area svg')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'New QR code' })).toBeDefined();
    expect(dialog).toBeDefined();
  });

  it('opens the QR dialog with the raw token right after creating a table', async () => {
    render(<TablesManagement />);
    fireEvent.click(await screen.findByRole('button', { name: '+ Add table' }));

    const labelInput = await screen.findByPlaceholderText('e.g. T1');
    fireEvent.change(labelInput, { target: { value: 'T7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create table' }));

    expect(await screen.findByRole('dialog', { name: 'QR code for table T7' })).toBeDefined();
    expect(await screen.findByText(/\/o\/raw-new456/)).toBeDefined();
    await waitFor(() => {
      const call = mockApiRequest.mock.calls.find(
        ([url, options]) =>
          url === '/branches/b1/tables' && (options as { method?: string })?.method === 'POST',
      );
      expect(call).toBeDefined();
      expect((call![1] as { body?: { label?: string } }).body?.label).toBe('T7');
    });
  });

  it('hides QR and create actions from non-managers', async () => {
    authState.role = 'CASHIER';
    render(<TablesManagement />);
    expect(await screen.findByRole('heading', { name: 'Tables & sessions' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'QR code' })).toBeNull();
    expect(screen.queryByRole('button', { name: '+ Add table' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Manage' })).toBeNull();
  });
});
