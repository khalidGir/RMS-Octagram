import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@/lib/api-client';
import { useKdsSocket } from './use-kds-socket';
import { useKdsTickets, type KdsTicket } from './use-kds-tickets';

vi.mock('@/lib/api-client', () => ({ apiRequest: vi.fn() }));

vi.mock('@/components/auth-provider', () => ({
  useAuth: vi.fn(() => ({
    accessToken: 'test-token',
    profile: { memberships: [{ tenant: { id: 'tenant-1' } }] },
  })),
}));

vi.mock('./use-kds-socket', () => ({
  useKdsSocket: vi.fn(() => ({ status: 'connected', reconnect: vi.fn() })),
}));

const mockedApi = vi.mocked(apiRequest);
const mockedSocket = vi.mocked(useKdsSocket);

function makeTicket(id: string, kitchenId: string | null): KdsTicket {
  return {
    id,
    orderId: 'o-1',
    stationId: 's-1',
    kitchenId,
    ticketNumber: '1',
    status: 'QUEUED',
    priority: 0,
    estimatedReadyAt: null,
    startedAt: null,
    readyAt: null,
    completedAt: null,
    version: 1,
    createdAt: new Date().toISOString(),
  };
}

const ticketMain = makeTicket('t-main', 'k-main');
const ticketBar = makeTicket('t-bar', 'k-bar');

function ticketRequestPath(): string {
  const call = mockedApi.mock.calls.find(([path]) => String(path).includes('kitchen-tickets'));
  return String(call?.[0] ?? '');
}

describe('useKdsTickets kitchen filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSocket.mockReturnValue({ status: 'connected', reconnect: vi.fn() } as never);
    mockedApi.mockImplementation(async (path: string) => {
      if (path.includes('kitchen-tickets')) return { data: [ticketMain, ticketBar] } as never;
      return { data: [] } as never;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('requests only the selected kitchen and returns only its tickets', async () => {
    const { result } = renderHook(() =>
      useKdsTickets({ branchId: 'b-1', kitchenId: 'k-bar' }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(ticketRequestPath()).toContain('kitchenId=k-bar');
    expect(result.current.tickets.map((t) => t.id)).toEqual(['t-bar']);
  });

  it('returns every ticket without a kitchen param when no kitchen is selected', async () => {
    const { result } = renderHook(() => useKdsTickets({ branchId: 'b-1' }));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(ticketRequestPath()).not.toContain('kitchenId');
    expect(result.current.tickets).toHaveLength(2);
  });

  it('keeps live socket tickets for the selected kitchen and drops other kitchens', async () => {
    const { result } = renderHook(() =>
      useKdsTickets({ branchId: 'b-1', kitchenId: 'k-bar' }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    const options = mockedSocket.mock.calls.at(-1)?.[0];
    expect(options).toBeDefined();

    act(() => {
      options?.onTicketCreated?.(makeTicket('t-new-main', 'k-main'));
    });
    expect(result.current.tickets.some((t) => t.id === 't-new-main')).toBe(false);

    act(() => {
      options?.onTicketCreated?.(makeTicket('t-new-bar', 'k-bar'));
    });
    expect(result.current.tickets.some((t) => t.id === 't-new-bar')).toBe(true);
  });
});
