import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useKdsSocket } from './use-kds-socket';
import { useFulfillmentLive } from './use-fulfillment-live';

const socket = vi.hoisted(() => ({ emit: vi.fn(), status: 'connected', reconnect: vi.fn() }));
vi.mock('./use-kds-socket', () => ({ useKdsSocket: vi.fn(() => socket) }));
vi.mock('@/components/auth-provider', () => ({ useAuth: () => ({ accessToken: 'token', profile: {
  id: 'waiter-1', memberships: [{ role: 'WAITER', tenant: { id: 'tenant-1' } }],
} }) }));
vi.mock('@/components/shell/branch-provider', () => ({ useBranch: () => ({ branchId: 'branch-1' }) }));
let queries: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queries}>{children}</QueryClientProvider>;
}
beforeEach(() => { vi.clearAllMocks(); queries = new QueryClient(); });
afterEach(cleanup);

describe('fulfillment authoritative reconciliation', () => {
  it('rejoins personal/service rooms and refetches only current tenant/branch queues', () => {
    const invalidate = vi.spyOn(queries, 'invalidateQueries');
    renderHook(() => useFulfillmentLive(true), { wrapper });
    const options = vi.mocked(useKdsSocket).mock.calls[0][0];
    act(() => options.onConnect?.());
    expect(socket.emit).toHaveBeenCalledWith('join:service', { branchId: 'branch-1' });
    expect(socket.emit).toHaveBeenCalledWith('join:waiter', { branchId: 'branch-1', userId: 'waiter-1' });
    for (const queue of ['expo-orders', 'service-board', 'service-notifications']) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: [queue, 'tenant-1', 'branch-1'] });
    }
    invalidate.mockClear();
    act(() => options.onOperationalChange?.('fulfillment:changed', { orderId: 'order-1' }));
    expect(invalidate).toHaveBeenCalledTimes(3);
  });
  it('does not open a branch subscription when the screen role is denied', () => {
    renderHook(() => useFulfillmentLive(false), { wrapper });
    expect(useKdsSocket).toHaveBeenCalledWith(expect.objectContaining({ branchId: '' }));
  });
});
