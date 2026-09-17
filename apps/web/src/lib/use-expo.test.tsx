import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { fetchApi } from './mock-adapter';
import { useExpoOrders, useRecallExpoOrder, useReleaseOrder } from './use-expo';

vi.mock('./mock-adapter', () => ({ fetchApi: vi.fn() }));
vi.mock('@/components/auth-provider', () => ({
  useAuth: () => ({ accessToken: 'staff-token', csrfToken: 'csrf-token' }),
}));
vi.mock('@/components/shell/branch-provider', () => ({ useBranch: () => ({ branchId: 'branch-1' }) }));

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  sessionStorage.setItem('rms-tenant-id', 'tenant-1');
  vi.mocked(fetchApi).mockResolvedValue({ data: [] });
});

describe('Expo live request contracts', () => {
  it('sends release idempotency in a header, not the strict DTO body', async () => {
    const { result } = renderHook(() => useReleaseOrder(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ orderId: 'order-1', expectedVersion: 3 }); });
    expect(fetchApi).toHaveBeenCalledWith('/branches/branch-1/expo/orders/order-1/release', expect.objectContaining({
      accessToken: 'staff-token', tenantId: 'tenant-1', method: 'POST',
      headers: { 'Idempotency-Key': expect.any(String) }, body: { expectedVersion: 3 },
    }));
  });

  it('sends recall reason and version without extra body fields', async () => {
    const { result } = renderHook(() => useRecallExpoOrder(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ orderId: 'order-1', expectedVersion: 4, reason: 'Assembly correction' }); });
    expect(fetchApi).toHaveBeenCalledWith('/branches/branch-1/expo/orders/order-1/recall', expect.objectContaining({
      headers: { 'Idempotency-Key': expect.any(String) }, body: { expectedVersion: 4, reason: 'Assembly correction' },
    }));
  });

  it('does not request an operational queue before tenant context exists', () => {
    sessionStorage.clear();
    renderHook(() => useExpoOrders(), { wrapper });
    expect(fetchApi).not.toHaveBeenCalled();
  });
});
