'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/components/auth-provider';
import { useBranch } from '@/components/shell/branch-provider';
import { fetchApi } from '@/lib/mock-adapter';
import type { ApiEnvelope } from '@/lib/api-client';
import { newIdempotencyKey } from '@/lib/api-client';
import type { ExpoOrder } from '@/lib/fulfillment-types';

function useAuthHeaders() {
  const { accessToken, csrfToken } = useAuth();
  const { branchId } = useBranch();
  const tenantId = typeof window !== 'undefined' ? sessionStorage.getItem('rms-tenant-id') : null;
  return { accessToken: accessToken ?? '', csrfToken: csrfToken ?? '', branchId, tenantId: tenantId ?? '' };
}

export function useExpoOrders() {
  const { accessToken, branchId, tenantId } = useAuthHeaders();
  return useQuery({
    queryKey: ['expo-orders', branchId],
    queryFn: () => fetchApi<ApiEnvelope<ExpoOrder[]>>(`/branches/${branchId}/expo/orders`, { accessToken, tenantId }),
    select: (d) => d.data,
    refetchInterval: 10_000,
  });
}

export function useReleaseOrder() {
  const { accessToken, branchId, tenantId } = useAuthHeaders();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, expectedVersion }: { orderId: string; expectedVersion: number }) =>
      fetchApi<ApiEnvelope<ExpoOrder>>(`/branches/${branchId}/expo/orders/${orderId}/release`, {
        accessToken, tenantId, method: 'POST',
        body: { expectedVersion, idempotencyKey: newIdempotencyKey() },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expo-orders', branchId] }),
  });
}

export function useRecallExpoOrder() {
  const { accessToken, branchId, tenantId } = useAuthHeaders();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, reason, expectedVersion }: { orderId: string; reason: string; expectedVersion: number }) =>
      fetchApi<ApiEnvelope<ExpoOrder>>(`/branches/${branchId}/expo/orders/${orderId}/recall`, {
        accessToken, tenantId, method: 'POST',
        body: { reason, expectedVersion, idempotencyKey: newIdempotencyKey() },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expo-orders', branchId] }),
  });
}
