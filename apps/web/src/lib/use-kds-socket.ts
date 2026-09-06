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
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
}

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000];
const MAX_RECONNECT_ATTEMPTS = 10;

export function useKdsSocket({
  branchId,
  accessToken,
  tenantId,
  stationId,
  onTicketCreated,
  onTicketUpdated,
  onOrderConfirmed,
  onConnect,
  onDisconnect,
  onError,
}: UseKdsSocketOptions) {
  const [status, setStatus] = useState<KdsSocketStatus>('disconnected');
  const socketRef = useRef<Socket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacksRef = useRef({ onTicketCreated, onTicketUpdated, onOrderConfirmed, onConnect, onDisconnect, onError });
  callbacksRef.current = { onTicketCreated, onTicketUpdated, onOrderConfirmed, onConnect, onDisconnect, onError };

  const cleanup = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    reconnectAttemptsRef.current = 0;
  }, []);

  const connect = useCallback(() => {
    if (!branchId || !accessToken || !tenantId) return;
    cleanup();

    const socket = io(`${WS_URL}/kds`, {
      auth: { token: accessToken, tenantId },
      transports: ['websocket', 'polling'],
      reconnection: false,
      timeout: 10000,
      forceNew: true,
    });

    socketRef.current = socket;
    setStatus('connecting');

    socket.on('connect', () => {
      setStatus('connected');
      reconnectAttemptsRef.current = 0;

      socket.emit('join:branch', { branchId });
      if (stationId) {
        socket.emit('join:station', { branchId, stationId });
      }

      callbacksRef.current.onConnect?.();
    });

    socket.on('disconnect', (reason) => {
      setStatus('disconnected');
      callbacksRef.current.onDisconnect?.();

      if (reason === 'io server disconnect') {
        attemptReconnect();
      }
    });

    socket.on('connect_error', () => {
      setStatus('error');
      callbacksRef.current.onError?.(new Error('Connection failed'));
      attemptReconnect();
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

    socket.on('error', (data: { message?: string }) => {
      callbacksRef.current.onError?.(new Error(data?.message ?? 'Unknown socket error'));
    });
  }, [branchId, accessToken, tenantId, stationId, cleanup]);

  const attemptReconnect = useCallback(() => {
    if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) return;
    const delay = RECONNECT_DELAYS[Math.min(reconnectAttemptsRef.current, RECONNECT_DELAYS.length - 1)];
    reconnectAttemptsRef.current++;

    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = setTimeout(() => {
      connect();
    }, delay);
  }, [connect]);

  useEffect(() => {
    connect();
    return cleanup;
  }, [connect, cleanup]);

  const emit = useCallback((event: string, data: unknown) => {
    socketRef.current?.emit(event, data);
  }, []);

  return { status, emit, reconnect: connect };
}
