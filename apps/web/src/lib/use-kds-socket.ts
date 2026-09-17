'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { WS_URL } from './config';
import type { KdsSocketStatus, KdsTicketEvent } from './kds-types';

export type { KdsSocketStatus };

interface UseKdsSocketOptions {
  branchId: string;
  accessToken: string | null;
  tenantId: string | null;
  stationId?: string | null;
  onTicketCreated?: (ticket: KdsTicketEvent) => void;
  onTicketUpdated?: (ticket: KdsTicketEvent) => void;
  onOrderConfirmed?: (order: Record<string, unknown>) => void;
  onOperationalChange?: (event: string, data: Record<string, unknown>) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
}

const MAX_RECONNECT_ATTEMPTS = 10;

export function useKdsSocket({
  branchId,
  accessToken,
  tenantId,
  stationId,
  onTicketCreated,
  onTicketUpdated,
  onOrderConfirmed,
  onOperationalChange,
  onConnect,
  onDisconnect,
  onError,
}: UseKdsSocketOptions) {
  const [status, setStatus] = useState<KdsSocketStatus>('disconnected');
  const socketRef = useRef<Socket | null>(null);
  const callbacksRef = useRef({ onTicketCreated, onTicketUpdated, onOrderConfirmed, onOperationalChange, onConnect, onDisconnect, onError });
  callbacksRef.current = { onTicketCreated, onTicketUpdated, onOrderConfirmed, onOperationalChange, onConnect, onDisconnect, onError };

  const cleanup = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.io.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    cleanup();
    if (!branchId || !accessToken || !tenantId) {
      setStatus('disconnected');
      return;
    }

    const socket = io(`${WS_URL}/kds`, {
      auth: { token: accessToken, tenantId },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: MAX_RECONNECT_ATTEMPTS,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 16000,
      timeout: 10000,
      forceNew: true,
    });

    socketRef.current = socket;
    setStatus('connecting');

    socket.on('connect', () => {
      setStatus('connected');

      socket.emit('join:branch', { branchId });
      if (stationId) {
        socket.emit('join:station', { branchId, stationId });
      }

      callbacksRef.current.onConnect?.();
    });

    socket.on('disconnect', (reason) => {
      setStatus('disconnected');
      callbacksRef.current.onDisconnect?.();

      // Socket.IO reconnects transport failures. A deliberate server disconnect
      // (for example revoked access) requires an explicit user/auth retry.
      if (reason === 'io server disconnect') setStatus('error');
    });

    socket.on('connect_error', () => {
      setStatus('error');
      callbacksRef.current.onError?.(new Error('Connection failed'));
    });

    socket.on('ticket:created', (data: KdsTicketEvent) => {
      callbacksRef.current.onTicketCreated?.(data);
    });

    socket.on('ticket:updated', (data: KdsTicketEvent) => {
      callbacksRef.current.onTicketUpdated?.(data);
    });

    socket.on('order:confirmed', (data: Record<string, unknown>) => {
      callbacksRef.current.onOrderConfirmed?.(data);
    });
    for (const event of ['ticket:invalidated', 'fulfillment:changed', 'expo:released', 'expo:updated', 'order:assignment_changed', 'service:notification']) {
      socket.on(event, (data: Record<string, unknown>) => callbacksRef.current.onOperationalChange?.(event, data));
    }

    socket.on('error', (data: { message?: string }) => {
      setStatus('error');
      callbacksRef.current.onError?.(new Error(data?.message ?? 'Unknown socket error'));
    });
    socket.on('exception', (data: { message?: string }) => {
      setStatus('error');
      callbacksRef.current.onError?.(new Error(data?.message ?? 'Live update access denied'));
    });
    socket.io.on('reconnect_attempt', () => setStatus('connecting'));
    socket.io.on('reconnect_failed', () => {
      setStatus('error');
      callbacksRef.current.onError?.(new Error('Live updates unavailable. Polling can continue; retry the connection when available.'));
    });
  }, [branchId, accessToken, tenantId, stationId, cleanup]);

  useEffect(() => {
    connect();
    return cleanup;
  }, [connect, cleanup]);

  const emit = useCallback((event: string, data: unknown) => {
    socketRef.current?.emit(event, data);
  }, []);

  return { status, emit, reconnect: connect };
}
