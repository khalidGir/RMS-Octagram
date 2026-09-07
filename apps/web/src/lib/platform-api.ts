import { apiRequest, type ApiEnvelope } from './api-client';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: string;
  _count?: {
    memberships: number;
    branches: number;
  };
}

export interface TenantsResponse {
  data: Tenant[];
}

export interface FeatureEntitlement {
  featureKey: string;
  status: string;
  trialEndsAt: string | null;
}

export interface EntitlementsResponse {
  data: FeatureEntitlement[];
}

export async function fetchTenants(
  accessToken: string,
  csrfToken: string | null,
  opts?: { status?: string },
): Promise<Tenant[]> {
  const qs = opts?.status ? `?status=${opts.status}` : '';
  const res = await apiRequest<TenantsResponse>(`/platform/tenants${qs}`, {
    accessToken, csrfToken,
  });
  return res.data;
}

export async function suspendTenant(
  tenantId: string,
  accessToken: string,
  csrfToken: string | null,
): Promise<Tenant> {
  const res = await apiRequest<ApiEnvelope<Tenant>>(`/platform/tenants/${tenantId}/suspend`, {
    method: 'PATCH',
    accessToken, csrfToken,
  });
  return res.data;
}

export async function activateTenant(
  tenantId: string,
  accessToken: string,
  csrfToken: string | null,
): Promise<Tenant> {
  const res = await apiRequest<ApiEnvelope<Tenant>>(`/platform/tenants/${tenantId}/activate`, {
    method: 'PATCH',
    accessToken, csrfToken,
  });
  return res.data;
}

export async function fetchEntitlements(
  tenantId: string,
  accessToken: string,
  csrfToken: string | null,
): Promise<FeatureEntitlement[]> {
  const res = await apiRequest<EntitlementsResponse>(`/platform/tenants/${tenantId}/features`, {
    accessToken, csrfToken,
  });
  return res.data;
}

export async function setEntitlement(
  tenantId: string,
  featureKey: string,
  status: string,
  accessToken: string,
  csrfToken: string | null,
): Promise<FeatureEntitlement> {
  const res = await apiRequest<ApiEnvelope<FeatureEntitlement>>(`/platform/tenants/${tenantId}/features/${featureKey}`, {
    method: 'PUT',
    body: { status },
    accessToken, csrfToken,
  });
  return res.data;
}
