'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/components/auth-provider';
import { useBranch } from '@/components/shell/branch-provider';
import { fetchApi } from '@/lib/mock-adapter';
import type { ApiEnvelope } from '@/lib/api-client';
import { newIdempotencyKey } from '@/lib/api-client';
import type { ServiceBoardOrder, ServiceNotification } from '@/lib/fulfillment-types';

function useAuthHeaders() {
  const { accessToken, csrfToken } = useAuth();
  const { branchId } = useBranch();
  const tenantId = typeof window !== 'undefined' ? sessionStorage.getItem('rms-tenant-id') : null;
  return { accessToken: accessToken ?? '', csrfToken: csrfToken ?? '', branchId, tenantId: tenantId ?? '' };
}

export type ServiceBoardScope = 'mine' | 'unassigned' | 'all';

export function useServiceBoard(scope: ServiceBoardScope = 'all') {
  const { accessToken, branchId, tenantId } = useAuthHeaders();
  return useQuery({
    queryKey: ['service-board', branchId, scope],
    queryFn: () => fetchApi<ApiEnvelope<ServiceBoardOrder[]>>(`/branches/${branchId}/service-board?scope=${scope}`, { accessToken, tenantId }),
    select: (d) => d.data,
    refetchInterval: 15_000,
  });
}

export function useClaimOrder() {
  const { accessToken, branchId, tenantId } = useAuthHeaders();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) =>
      fetchApi<ApiEnvelope<ServiceBoardOrder>>(`/branches/${branchId}/orders/${orderId}/claim`, {
        accessToken, tenantId, method: 'POST',
        body: { idempotencyKey: newIdempotencyKey() },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['service-board', branchId] }),
  });
}

export function useCollectOrder() {
  const { accessToken, branchId, tenantId } = useAuthHeaders();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, ticketIds }: { orderId: string; ticketIds?: string[] }) =>
      fetchApi<ApiEnvelope<ServiceBoardOrder>>(`/branches/${branchId}/orders/${orderId}/collect`, {
        accessToken, tenantId, method: 'POST',
        body: { ticketIds, idempotencyKey: newIdempotencyKey() },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['service-board', branchId] }),
  });
}

export function useServeOrder() {
  const { accessToken, branchId, tenantId } = useAuthHeaders();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) =>
      fetchApi<ApiEnvelope<ServiceBoardOrder>>(`/branches/${branchId}/orders/${orderId}/serve`, {
        accessToken, tenantId, method: 'POST',
        body: { idempotencyKey: newIdempotencyKey() },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['service-board', branchId] }),
  });
}

export function useServiceNotifications() {
  const { accessToken, branchId, tenantId } = useAuthHeaders();
  return useQuery({
    queryKey: ['service-notifications', branchId],
    queryFn: () => fetchApi<ApiEnvelope<ServiceNotification[]>>(`/branches/${branchId}/service-notifications`, { accessToken, tenantId }),
    select: (d) => d.data,
    refetchInterval: 15_000,
  });
}
