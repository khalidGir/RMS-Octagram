import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fetchApi } from '@/lib/mock-adapter';
import { useStations, useCreateStation, useUpdateStation, useDeleteStation } from './use-kitchen-config';

vi.mock('@/lib/mock-adapter', () => ({
  fetchApi: vi.fn(),
  shouldUseMocks: () => false,
}));

vi.mock('@/components/auth-provider', () => ({
  useAuth: vi.fn(() => ({ accessToken: 'test-token', csrfToken: 'csrf' })),
}));

vi.mock('@/components/shell/branch-provider', () => ({
  useBranch: vi.fn(() => ({ branchId: 'b-1' })),
}));

const mockedFetch = vi.mocked(fetchApi);

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('use-kitchen-config station endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.setItem('rms-tenant-id', 't-1');
    mockedFetch.mockResolvedValue({ data: [] } as never);
  });

  afterEach(() => {
    cleanup();
    sessionStorage.removeItem('rms-tenant-id');
  });

  it('useStations calls kitchen-stations with the kitchenId query', async () => {
    const { result } = renderHook(() => useStations('k-bar'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockedFetch).toHaveBeenCalledWith(
      '/branches/b-1/kitchen-stations?kitchenId=k-bar',
      expect.objectContaining({ accessToken: 'test-token', tenantId: 't-1' }),
    );
  });

  it('useStations omits the query when no kitchen is selected', async () => {
    const { result } = renderHook(() => useStations(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockedFetch).toHaveBeenCalledWith(
      '/branches/b-1/kitchen-stations',
      expect.objectContaining({ accessToken: 'test-token', tenantId: 't-1' }),
    );
  });

  it('station mutations target the kitchen-stations endpoints', async () => {
    const { result } = renderHook(
      () => ({
        create: useCreateStation(),
        update: useUpdateStation(),
        remove: useDeleteStation(),
      }),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      await result.current.create.mutateAsync({
        kitchenId: 'k-1', name: 'Grill', code: 'GRILL',
      });
    });
    expect(mockedFetch).toHaveBeenCalledWith(
      '/branches/b-1/kitchen-stations',
      expect.objectContaining({ method: 'POST' }),
    );

    await act(async () => {
      await result.current.update.mutateAsync({ id: 's-1', name: 'Grill 2' });
    });
    expect(mockedFetch).toHaveBeenCalledWith(
      '/branches/b-1/kitchen-stations/s-1',
      expect.objectContaining({ method: 'PATCH' }),
    );

    await act(async () => {
      await result.current.remove.mutateAsync('s-1');
    });
    expect(mockedFetch).toHaveBeenCalledWith(
      '/branches/b-1/kitchen-stations/s-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
