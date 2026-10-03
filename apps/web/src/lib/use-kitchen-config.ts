'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/components/auth-provider';
import { useBranch } from '@/components/shell/branch-provider';
import { fetchApi } from '@/lib/mock-adapter';
import type { ApiEnvelope } from '@/lib/api-client';
import type { Kitchen, KitchenStation, StationRoute, MenuItemRouteAssignment, FulfillmentPolicy } from '@/lib/fulfillment-types';

function useAuthHeaders() {
  const { accessToken, csrfToken } = useAuth();
  const { branchId } = useBranch();
  const tenantId = typeof window !== 'undefined' ? sessionStorage.getItem('rms-tenant-id') : null;
  return { accessToken: accessToken ?? '', csrfToken: csrfToken ?? '', branchId, tenantId: tenantId ?? '' };
}

export function useKitchens() {
  const { accessToken, branchId, tenantId } = useAuthHeaders();
  return useQuery({
    queryKey: ['kitchens', branchId],
    queryFn: () => fetchApi<ApiEnvelope<Kitchen[]>>(`/branches/${branchId}/kitchens`, { accessToken, tenantId }),
    select: (d) => d.data,
  });
}

export function useCreateKitchen() {
  const { accessToken, branchId, tenantId } = useAuthHeaders();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; description?: string; collectionLabel?: string }) =>
      fetchApi<ApiEnvelope<Kitchen>>(`/branches/${branchId}/kitchens`, {
        accessToken, tenantId, method: 'POST', body: data,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kitchens', branchId] }),
  });
}

export function useUpdateKitchen() {
  const { accessToken, branchId, tenantId } = useAuthHeaders();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ kitchenId, ...data }: { kitchenId: string; name?: string; description?: string; collectionLabel?: string; isActive?: boolean; displayOrder?: number }) =>
      fetchApi<ApiEnvelope<Kitchen>>(`/branches/${branchId}/kitchens/${kitchenId}`, {
        accessToken, tenantId, method: 'PATCH', body: data,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kitchens', branchId] }),
  });
}

export function useDeleteKitchen() {
  const { accessToken, branchId, tenantId } = useAuthHeaders();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (kitchenId: string) =>
      fetchApi<ApiEnvelope<void>>(`/branches/${branchId}/kitchens/${kitchenId}`, {
        accessToken, tenantId, method: 'DELETE',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kitchens', branchId] }),
  });
}

export function useStations(kitchenId?: string) {
  const { accessToken, branchId, tenantId } = useAuthHeaders();
  return useQuery({
    queryKey: ['stations', branchId, kitchenId],
    queryFn: () => {
      const params = kitchenId ? `?kitchenId=${kitchenId}` : '';
      return fetchApi<ApiEnvelope<KitchenStation[]>>(`/branches/${branchId}/kitchen-stations${params}`, { accessToken, tenantId });
    },
    select: (d) => d.data,
  });
}

export function useStationRoutes(menuItemId?: string) {
  const { accessToken, branchId, tenantId } = useAuthHeaders();
  return useQuery({
    queryKey: ['station-routes', branchId, menuItemId],
    queryFn: () => {
      if (!menuItemId) return Promise.resolve({ data: [] } as ApiEnvelope<StationRoute[]>);
      return fetchApi<ApiEnvelope<StationRoute[]>>(`/branches/${branchId}/menu-items/${menuItemId}/station-routes`, { accessToken, tenantId });
    },
    select: (d) => d.data,
    enabled: !!menuItemId,
  });
}

export function useAllStationRoutes() {
  const { accessToken, branchId, tenantId } = useAuthHeaders();
  return useQuery({
    queryKey: ['station-routes-all', branchId],
    queryFn: () => fetchApi<ApiEnvelope<StationRoute[]>>(`/branches/${branchId}/menu-items/all/station-routes`, { accessToken, tenantId }),
    select: (d) => d.data,
  });
}

export function useReplaceRoutes() {
  const { accessToken, branchId, tenantId } = useAuthHeaders();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ menuItemId, routes }: { menuItemId: string; routes: MenuItemRouteAssignment[] }) =>
      fetchApi<ApiEnvelope<StationRoute[]>>(`/branches/${branchId}/menu-items/${menuItemId}/station-routes`, {
        accessToken, tenantId, method: 'PUT', body: { routes },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['station-routes', branchId] });
      qc.invalidateQueries({ queryKey: ['station-routes-all', branchId] });
    },
  });
}

export function useCreateStation() {
  const { accessToken, branchId, tenantId } = useAuthHeaders();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { kitchenId: string; name: string; code: string; defaultPrepMinutes?: number; isExpo?: boolean; collectionLabelOverride?: string }) =>
      fetchApi<ApiEnvelope<KitchenStation>>(`/branches/${branchId}/kitchen-stations`, {
        accessToken, tenantId, method: 'POST', body: data,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stations', branchId] }),
  });
}

export function useUpdateStation() {
  const { accessToken, branchId, tenantId } = useAuthHeaders();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; name?: string; code?: string; defaultPrepMinutes?: number; isExpo?: boolean; collectionLabelOverride?: string; displayOrder?: number; isActive?: boolean }) =>
      fetchApi<ApiEnvelope<KitchenStation>>(`/branches/${branchId}/kitchen-stations/${id}`, {
        accessToken, tenantId, method: 'PATCH', body: data,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stations', branchId] }),
  });
}

export function useDeleteStation() {
  const { accessToken, branchId, tenantId } = useAuthHeaders();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (stationId: string) =>
      fetchApi<ApiEnvelope<void>>(`/branches/${branchId}/kitchen-stations/${stationId}`, {
        accessToken, tenantId, method: 'DELETE',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stations', branchId] }),
  });
}

export function useFulfillmentPolicy() {
  const { accessToken, branchId, tenantId } = useAuthHeaders();
  return useQuery({
    queryKey: ['fulfillment-policy', branchId],
    queryFn: () => fetchApi<ApiEnvelope<FulfillmentPolicy>>(`/branches/${branchId}/fulfillment-policy`, { accessToken, tenantId }),
    select: (d) => d.data,
  });
}

export function useUpdateFulfillmentPolicy() {
  const { accessToken, branchId, tenantId } = useAuthHeaders();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Pick<FulfillmentPolicy, 'serviceMode' | 'expoMode' | 'allowWaiterSelfClaim' | 'showUnassignedReadyOrdersToWaiters' | 'readyReminderSeconds' | 'readyEscalationSeconds'>>) =>
      fetchApi<ApiEnvelope<FulfillmentPolicy>>(`/branches/${branchId}/fulfillment-policy`, {
        accessToken, tenantId, method: 'PUT', body: data,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fulfillment-policy', branchId] }),
  });
}
