import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { io } from 'socket.io-client';
import { useKdsSocket } from './use-kds-socket';

const fake = vi.hoisted(() => {
  const events: Record<string, (...args: unknown[]) => void> = {};
  const managerEvents: Record<string, (...args: unknown[]) => void> = {};
  return { events, managerEvents, socket: {
    on: vi.fn((event: string, callback: (...args: unknown[]) => void) => { events[event] = callback; }),
    emit: vi.fn(), disconnect: vi.fn(), removeAllListeners: vi.fn(),
    io: { on: vi.fn((event: string, callback: (...args: unknown[]) => void) => { managerEvents[event] = callback; }), removeAllListeners: vi.fn() },
  } };
});
vi.mock('socket.io-client', () => ({ io: vi.fn(() => fake.socket) }));
beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);
const options = { branchId: 'branch-1', tenantId: 'tenant-1', accessToken: 'token-1', stationId: 'station-1' };

describe('KDS transport recovery', () => {
  it('uses bounded Socket.IO recovery and rejoins rooms/refetches on every connection', () => {
    const onConnect = vi.fn();
    const { result } = renderHook(() => useKdsSocket({ ...options, onConnect }));
    expect(io).toHaveBeenCalledWith(expect.stringContaining('/kds'), expect.objectContaining({
      reconnection: true, reconnectionAttempts: 10, reconnectionDelay: 1000, reconnectionDelayMax: 16000,
      auth: { token: 'token-1', tenantId: 'tenant-1' },
    }));
    act(() => fake.events.connect());
    expect(result.current.status).toBe('connected');
    act(() => fake.events.disconnect('transport close'));
    expect(result.current.status).toBe('disconnected');
    act(() => fake.managerEvents.reconnect_attempt());
    expect(result.current.status).toBe('connecting');
    act(() => fake.events.connect());
    expect(onConnect).toHaveBeenCalledTimes(2);
    expect(fake.socket.emit).toHaveBeenCalledWith('join:branch', { branchId: 'branch-1' });
    expect(fake.socket.emit).toHaveBeenCalledWith('join:station', { branchId: 'branch-1', stationId: 'station-1' });
  });

  it('reports exhausted recovery and room errors instead of hiding them', () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useKdsSocket({ ...options, onError }));
    act(() => fake.managerEvents.reconnect_failed());
    expect(result.current.status).toBe('error');
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    act(() => fake.events.error({ message: 'Branch access denied' }));
    expect(onError).toHaveBeenLastCalledWith(new Error('Branch access denied'));
    act(() => fake.events.exception({ message: 'Forbidden resource' }));
    expect(result.current.status).toBe('error');
    expect(onError).toHaveBeenLastCalledWith(new Error('Forbidden resource'));
  });

  it('forwards committed fulfillment and Expo invalidations to the reconciler', () => {
    const onOperationalChange = vi.fn();
    renderHook(() => useKdsSocket({ ...options, onOperationalChange }));
    act(() => fake.events['fulfillment:changed']({ orderId: 'order-1' }));
    act(() => fake.events['expo:released']({ orderId: 'order-1' }));
    act(() => fake.events['ticket:invalidated']({ orderId: 'order-1', ticketId: 'ticket-1', version: 3 }));
    expect(onOperationalChange).toHaveBeenCalledWith('fulfillment:changed', { orderId: 'order-1' });
    expect(onOperationalChange).toHaveBeenCalledWith('expo:released', { orderId: 'order-1' });
    expect(onOperationalChange).toHaveBeenCalledWith('ticket:invalidated', { orderId: 'order-1', ticketId: 'ticket-1', version: 3 });
  });

  it('disconnects the old context and both listener sets when credentials disappear', () => {
    const { result, rerender } = renderHook(({ accessToken }: { accessToken: string | null }) => useKdsSocket({ ...options, accessToken }), {
      initialProps: { accessToken: 'token-1' as string | null },
    });
    act(() => fake.events.connect());
    rerender({ accessToken: null });
    expect(fake.socket.disconnect).toHaveBeenCalledTimes(1);
    expect(fake.socket.removeAllListeners).toHaveBeenCalledTimes(1);
    expect(fake.socket.io.removeAllListeners).toHaveBeenCalledTimes(1);
    expect(io).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('disconnected');
  });
});
