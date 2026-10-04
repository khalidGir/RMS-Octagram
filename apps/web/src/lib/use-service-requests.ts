'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/components/auth-provider';
import { useBranch } from '@/components/shell/branch-provider';
import { fetchApi } from '@/lib/mock-adapter';
import { apiRequest, type ApiEnvelope } from '@/lib/api-client';

export type ServiceRequestType = 'CALL_WAITER' | 'REQUEST_BILL' | 'OTHER_ASSISTANCE';
export type ServiceRequestState = 'OPEN' | 'CLAIMED' | 'RESOLVED' | 'CANCELLED' | 'ESCALATED';

export interface TableServiceRequest {
  id: string;
  type: ServiceRequestType;
  status: ServiceRequestState;
  createdAt: string;
}

export interface StaffServiceRequest extends TableServiceRequest {
  note: string | null;
  tableLabel: string | null;
  orderNumber: number | null;
  assignedWaiterUserId: string | null;
  claimedByUserId: string | null;
  version: number;
  claimedAt: string | null;
  resolvedAt: string | null;
  cancelledAt: string | null;
  escalatedAt: string | null;
  updatedAt: string;
}

export function useTableServiceRequests(qrToken: string, enabled: boolean) {
  return useQuery({
    queryKey: ['table-service-requests', qrToken],
    enabled: enabled && Boolean(qrToken),
    queryFn: async () => {
      const response = await apiRequest<ApiEnvelope<{ requests: TableServiceRequest[] }>>(
        '/public/service-requests/status',
        { method: 'POST', body: { qrToken } },
      );
      return response.data.requests;
    },
    refetchInterval: 10_000,
    retry: false,
  });
}

export function useCreateServiceRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ qrToken, type }: { qrToken: string; type: ServiceRequestType }) =>
      apiRequest<ApiEnvelope<{ request: TableServiceRequest; created: boolean; alreadyOpen: boolean }>>(
        '/public/service-requests',
        { method: 'POST', body: { qrToken, type } },
      ),
    onSuccess: (_result, variables) =>
      queryClient.invalidateQueries({ queryKey: ['table-service-requests', variables.qrToken] }),
  });
}

function useAuthHeaders() {
  const { accessToken, csrfToken } = useAuth();
  const { branchId } = useBranch();
  const tenantId = typeof window !== 'undefined' ? sessionStorage.getItem('rms-tenant-id') : null;
  return { accessToken: accessToken ?? '', csrfToken: csrfToken ?? '', branchId, tenantId: tenantId ?? '' };
}

export function useServiceRequests() {
  const { accessToken, branchId, tenantId } = useAuthHeaders();
  return useQuery({
    queryKey: ['service-requests', tenantId, branchId],
    enabled: Boolean(accessToken && tenantId && branchId),
    queryFn: () =>
      fetchApi<ApiEnvelope<StaffServiceRequest[]>>(`/branches/${branchId}/service-requests`, {
        accessToken,
        tenantId,
      }),
    select: (d) => d.data,
    refetchInterval: 15_000,
    retry: false,
  });
}

export type ServiceRequestActionKind = 'claim' | 'resolve' | 'cancel';

export function useServiceRequestAction() {
  const { accessToken, branchId, tenantId } = useAuthHeaders();
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['service-requests', tenantId, branchId] });
  return useMutation({
    mutationFn: ({
      requestId,
      action,
      expectedVersion,
    }: {
      requestId: string;
      action: ServiceRequestActionKind;
      expectedVersion: number;
    }) =>
      fetchApi<ApiEnvelope<StaffServiceRequest>>(
        `/branches/${branchId}/service-requests/${requestId}/${action}`,
        { accessToken, tenantId, method: 'POST', body: { expectedVersion } },
      ),
    onSuccess: invalidate,
    onError: invalidate,
  });
}
