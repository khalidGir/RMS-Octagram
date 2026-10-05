import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchApi } from './mock-adapter';
import { useServiceBoard, useServiceNotifications } from './use-service-board';

vi.mock('./mock-adapter', () => ({ fetchApi: vi.fn() }));
vi.mock('@/components/auth-provider', () => ({ useAuth: () => ({ accessToken: 'token', csrfToken: 'csrf' }) }));
vi.mock('@/components/shell/branch-provider', () => ({ useBranch: () => ({ branchId: 'branch-1' }) }));
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
}
beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); });
afterEach(cleanup);

describe('service queue request fidelity', () => {
  it('does not request either queue before tenant context is ready', () => {
    renderHook(() => { useServiceBoard(); useServiceNotifications(); }, { wrapper });
    expect(fetchApi).not.toHaveBeenCalled();
  });
  it('preserves notification failures as errors, not a fabricated empty queue', async () => {
    sessionStorage.setItem('rms-tenant-id', 'tenant-1');
    const failure = new Error('Service unavailable');
    vi.mocked(fetchApi).mockRejectedValue(failure);
    const { result } = renderHook(() => useServiceNotifications(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(failure);
    expect(result.current.data).toBeUndefined();
  });
});
