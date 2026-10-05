'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest, type ApiEnvelope } from '@/lib/api-client';
import { useAuth } from '@/components/auth-provider';
import { useKdsSocket } from './use-kds-socket';
import type { KdsTicket, KdsStation } from './kds-types';

export type { KdsTicket, KdsStation };

interface UseKdsTicketsOptions {
  branchId: string;
  stationId?: string | null;
  kitchenId?: string | null;
  statusFilter?: string | null;
  pollingIntervalMs?: number;
}

const POLLING_INTERVAL = 15000;

export function useKdsTickets({
  branchId,
  stationId,
  kitchenId,
  statusFilter,
  pollingIntervalMs = POLLING_INTERVAL,
}: UseKdsTicketsOptions) {
  const { accessToken, profile } = useAuth();
  const tenantId = profile?.memberships[0]?.tenant?.id ?? null;

  const [tickets, setTickets] = useState<KdsTicket[]>([]);
  const [stations, setStations] = useState<KdsStation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastFetchRef = useRef(0);

  const fetchTickets = useCallback(async (silent = false) => {
    if (!accessToken || !branchId || !tenantId) return;
    if (!silent) setLoading(true);

    try {
      const params = new URLSearchParams();
      if (kitchenId) params.set('kitchenId', kitchenId);
      if (stationId) params.set('stationId', stationId);
      if (statusFilter) params.set('status', statusFilter);
      params.set('limit', '100');

      const query = params.toString();
      const path = `/branches/${branchId}/kitchen-tickets${query ? `?${query}` : ''}`;

      const response = await apiRequest<ApiEnvelope<KdsTicket[]>>(path, { accessToken, tenantId });
      setTickets(response.data);
      setError(null);
      lastFetchRef.current = Date.now();
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : 'Failed to load tickets');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [accessToken, branchId, tenantId, kitchenId, stationId, statusFilter]);

  const fetchStations = useCallback(async () => {
    if (!accessToken || !branchId || !tenantId) return;
    try {
      const response = await apiRequest<ApiEnvelope<KdsStation[]>>(`/branches/${branchId}/kitchen-stations`, { accessToken, tenantId });
      setStations(response.data);
    } catch {
      // Stations are non-critical for initial load
    }
  }, [accessToken, branchId, tenantId]);

  const bumpTicket = useCallback(async (ticketId: string, expectedVersion: number, reason?: string) => {
    if (!accessToken || !branchId || !tenantId) throw new Error('Not authenticated');

    const response = await apiRequest<ApiEnvelope<KdsTicket>>(`/branches/${branchId}/kitchen-tickets/${ticketId}/bump`, {
      method: 'POST',
      accessToken,
      tenantId,
      body: { expectedVersion, reason },
    });

    setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, ...response.data } : t));
    return response.data;
  }, [accessToken, branchId, tenantId]);

  const recallTicket = useCallback(async (ticketId: string, expectedVersion: number, reason: string) => {
    if (!accessToken || !branchId || !tenantId) throw new Error('Not authenticated');

    const response = await apiRequest<ApiEnvelope<KdsTicket>>(`/branches/${branchId}/kitchen-tickets/${ticketId}/recall`, {
      method: 'POST',
      accessToken,
      tenantId,
      body: { expectedVersion, reason },
    });

    setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, ...response.data } : t));
    return response.data;
  }, [accessToken, branchId, tenantId]);

  const completeTicket = useCallback(async (ticketId: string, expectedVersion: number) => {
    if (!accessToken || !branchId || !tenantId) throw new Error('Not authenticated');

    const response = await apiRequest<ApiEnvelope<KdsTicket>>(`/branches/${branchId}/kitchen-tickets/${ticketId}/complete`, {
      method: 'POST',
      accessToken,
      tenantId,
      body: { expectedVersion },
    });

    setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, ...response.data } : t));
    return response.data;
  }, [accessToken, branchId, tenantId]);

  const cancelTicket = useCallback(async (ticketId: string, expectedVersion: number, reason?: string) => {
    if (!accessToken || !branchId || !tenantId) throw new Error('Not authenticated');

    const response = await apiRequest<ApiEnvelope<KdsTicket>>(`/branches/${branchId}/kitchen-tickets/${ticketId}/cancel`, {
      method: 'POST',
      accessToken,
      tenantId,
      body: { expectedVersion, reason },
    });

    setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, ...response.data } : t));
    return response.data;
  }, [accessToken, branchId, tenantId]);

  const handleSocketTicketCreated = useCallback((ticket: KdsTicket) => {
    if (kitchenId && ticket.kitchenId !== kitchenId) return;
    setTickets(prev => {
      if (prev.some(t => t.id === ticket.id)) return prev;
      return [...prev, ticket];
    });
  }, [kitchenId]);

  const handleSocketTicketUpdated = useCallback((updated: KdsTicket) => {
    if (kitchenId && updated.kitchenId && updated.kitchenId !== kitchenId) return;
    setTickets(prev => prev.map(t => t.id === updated.id ? { ...t, ...updated } : t));
  }, [kitchenId]);

  const handleSocketConnect = useCallback(() => {
    fetchTickets(true);
  }, [fetchTickets]);

  const { status: socketStatus, reconnect } = useKdsSocket({
    branchId,
    accessToken,
    tenantId,
    stationId: stationId ?? undefined,
    onTicketCreated: handleSocketTicketCreated,
    onTicketUpdated: handleSocketTicketUpdated,
    onOperationalChange: handleSocketConnect,
    onConnect: handleSocketConnect,
  });

  // Initial fetch
  useEffect(() => {
    fetchTickets();
    fetchStations();
  }, [fetchTickets, fetchStations]);

  // Polling fallback when socket is not connected
  useEffect(() => {
    if (socketStatus === 'connected') {
      if (pollingTimerRef.current) {
        clearInterval(pollingTimerRef.current);
        pollingTimerRef.current = null;
      }
      return;
    }

    pollingTimerRef.current = setInterval(() => {
      fetchTickets(true);
    }, pollingIntervalMs);

    return () => {
      if (pollingTimerRef.current) {
        clearInterval(pollingTimerRef.current);
        pollingTimerRef.current = null;
      }
    };
  }, [socketStatus, pollingIntervalMs, fetchTickets]);

  // Show only the selected kitchen's tickets immediately, so switching
  // kitchens never briefly displays the previous kitchen's tickets while
  // the filtered refetch is still in flight.
  const visibleTickets = useMemo(
    () => (kitchenId ? tickets.filter((t) => t.kitchenId === kitchenId) : tickets),
    [tickets, kitchenId],
  );

  return {
    tickets: visibleTickets,
    stations,
    loading,
    error,
    socketStatus,
    refetch: () => fetchTickets(),
    reconnect,
    bumpTicket,
    recallTicket,
    completeTicket,
    cancelTicket,
  };
}
