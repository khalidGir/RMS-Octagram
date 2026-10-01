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

export interface TenantBranch {
  id: string;
  name: string;
  slug: string;
  publicSlug: string | null;
  timezone: string;
  isActive: boolean;
  createdAt: string;
}

export interface TenantMember {
  role: string;
  status: string;
  createdAt: string;
  user: {
    id: string;
    displayName: string | null;
    phoneE164: string | null;
    email: string | null;
    status: string;
    lastLoginAt: string | null;
  };
}

export interface TenantDetail extends Tenant {
  defaultCurrency: string;
  defaultTimezone: string;
  defaultLocale: string;
  _count: { memberships: number; branches: number };
  branches: TenantBranch[];
  memberships: TenantMember[];
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

export interface CreateTenantInput {
  name: string;
  slug?: string;
  ownerPhone: string;
  ownerPassword: string;
  ownerName?: string;
}

export interface CreateTenantResult {
  tenant: Tenant;
  owner: { id: string; phoneE164: string | null; displayName: string | null };
}

export async function createTenant(
  input: CreateTenantInput,
  accessToken: string,
  csrfToken: string | null,
): Promise<CreateTenantResult> {
  const res = await apiRequest<ApiEnvelope<CreateTenantResult>>('/platform/tenants', {
    method: 'POST',
    body: input,
    accessToken,
    csrfToken,
  });
  return res.data;
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

export async function fetchTenantDetail(
  tenantId: string,
  accessToken: string,
  csrfToken: string | null,
): Promise<TenantDetail> {
  const res = await apiRequest<ApiEnvelope<TenantDetail>>(`/platform/tenants/${tenantId}`, {
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
