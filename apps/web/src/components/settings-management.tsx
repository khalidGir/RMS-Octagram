'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError, apiRequest, type ApiEnvelope } from '@/lib/api-client';
import { useAuth } from './auth-provider';

/* -------------------------------------------------------------------------- */
/*                                   Types                                    */
/* -------------------------------------------------------------------------- */

interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: string;
}
interface FeatureStatus {
  featureKey: string;
  entitlementStatus: string;
  trialEndsAt: string | null;
  tenantEnabled: boolean;
  effective: boolean;
}

function featureLabel(key: string): string {
  return key
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/* -------------------------------------------------------------------------- */
/*                         SettingsManagement                                 */
/* -------------------------------------------------------------------------- */

export function SettingsManagement() {
  const { accessToken, csrfToken, profile } = useAuth();
  const membership = profile?.memberships[0];
  const tenantId = membership?.tenant.id ?? '';
  const [notice, setNotice] = useState<string | null>(null);

  const tenant = useQuery({
    queryKey: ['tenant-current', tenantId],
    enabled: Boolean(accessToken && tenantId),
    queryFn: async () =>
      (await apiRequest<ApiEnvelope<Tenant>>('/tenants/current', { accessToken, tenantId })).data,
  });

  const features = useQuery({
    queryKey: ['tenant-features', tenantId],
    enabled: Boolean(accessToken && tenantId),
    queryFn: async () =>
      (await apiRequest<ApiEnvelope<FeatureStatus[]>>('/tenants/features', { accessToken, tenantId })).data,
  });

  if (!membership || !['OWNER', 'MANAGER'].includes(membership.role)) {
    return <p role="alert">Permission denied.</p>;
  }

  const isOwner = membership.role === 'OWNER';

  return (
    <>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[.18em] text-brand">Restaurant settings</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Branding &amp; configuration</h1>
          <p className="mt-2 text-sm text-ink-muted">
            Customize your restaurant identity and manage feature flags.
          </p>
        </div>
      </div>

      {notice && (
        <div role="status" className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-900">
          {notice}
        </div>
      )}

      {tenant.isLoading && (
        <p className="py-16 text-center text-sm font-bold text-ink-muted">Loading settings…</p>
      )}

      {tenant.isError && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">
          Could not load settings. Check the API connection and try again.
        </div>
      )}

      {!tenant.isLoading && !tenant.isError && tenant.data && (
        <div className="grid gap-5 xl:grid-cols-[1fr_.85fr]">
          <div className="space-y-5">
            <TenantIdentityCard
              tenant={tenant.data}
              isOwner={isOwner}
              accessToken={accessToken!}
              csrfToken={csrfToken}
              tenantId={tenantId}
              onSaved={async () => {
                await tenant.refetch();
                setNotice('Restaurant identity updated.');
              }}
            />
          </div>
          <div className="space-y-5">
            <FeaturesCard
              features={features.data ?? []}
              isLoading={features.isLoading}
              isOwner={isOwner}
              accessToken={accessToken!}
              csrfToken={csrfToken}
              tenantId={tenantId}
              onToggled={async () => {
                await features.refetch();
                setNotice('Feature updated.');
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*                          TenantIdentityCard                                */
/* -------------------------------------------------------------------------- */

function TenantIdentityCard({
  tenant,
  isOwner,
  accessToken,
  csrfToken,
  tenantId,
  onSaved,
}: {
  tenant: Tenant;
  isOwner: boolean;
  accessToken: string;
  csrfToken: string | null;
  tenantId: string;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(tenant.name);
  const [colour, setColour] = useState('#b4532a');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) return setError('Enter a restaurant name.');
    setBusy(true);
    setError(null);
    try {
      await apiRequest('/tenants/current', {
        method: 'PATCH',
        accessToken,
        csrfToken,
        tenantId,
        body: { name: trimmed },
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save changes.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-black/[.07] bg-white p-6 shadow-sm">
      <h2 className="text-lg font-black">Restaurant identity</h2>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-black">
          Display name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!isOwner}
            className="mt-2 min-h-12 w-full rounded-xl border border-line bg-white px-4 font-normal outline-none focus:ring-2 focus:ring-brand/20 disabled:opacity-50"
          />
        </label>
        <label className="text-sm font-black">
          Primary colour
          <input
            type="color"
            value={colour}
            onChange={(e) => setColour(e.target.value)}
            className="mt-2 h-12 w-full rounded-xl border border-line p-1"
          />
        </label>
      </div>
      <div className="mt-5 rounded-xl border-2 border-dashed border-line p-6 text-center text-sm font-bold text-ink-muted">
        Logo upload coming soon
      </div>
      {error && (
        <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">
          {error}
        </div>
      )}
      {isOwner && (
        <div className="mt-5 flex justify-end">
          <button
            onClick={save}
            disabled={busy || name.trim() === tenant.name}
            className="min-h-11 rounded-xl bg-dark px-6 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}

      <div className="mt-6 rounded-xl p-5 text-white" style={{ background: colour }}>
        <p className="text-xs font-bold text-white/70">LIVE PREVIEW</p>
        <h2 className="mt-2 text-2xl font-black">{name || 'Restaurant Name'}</h2>
        <p className="mt-1 text-sm text-white/80">Made with warmth. Served with pride.</p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                             FeaturesCard                                   */
/* -------------------------------------------------------------------------- */

function FeaturesCard({
  features,
  isLoading,
  isOwner,
  accessToken,
  csrfToken,
  tenantId,
  onToggled,
}: {
  features: FeatureStatus[];
  isLoading: boolean;
  isOwner: boolean;
  accessToken: string;
  csrfToken: string | null;
  tenantId: string;
  onToggled: () => Promise<void>;
}) {
  const [toggling, setToggling] = useState<string | null>(null);

  async function toggleFeature(featureKey: string, currentEnabled: boolean) {
    if (!isOwner) return;
    setToggling(featureKey);
    try {
      await apiRequest(`/tenants/features/${featureKey}`, {
        method: 'PUT',
        accessToken,
        csrfToken,
        tenantId,
        body: { enabled: !currentEnabled },
      });
      await onToggled();
    } catch {
      // silently fail — onToggled won't be called
    } finally {
      setToggling(null);
    }
  }

  return (
    <div className="rounded-2xl border border-black/[.07] bg-white p-6 shadow-sm">
      <h2 className="text-lg font-black">Feature flags</h2>
      <p className="mt-1 text-sm text-ink-muted">Control which modules are active for your restaurant.</p>

      {isLoading && (
        <p className="py-8 text-center text-sm font-bold text-ink-muted">Loading features…</p>
      )}

      {!isLoading && features.length === 0 && (
        <p className="py-8 text-center text-sm text-ink-muted">No features available.</p>
      )}

      <div className="mt-4 space-y-1">
        {features.map((f) => (
          <div
            key={f.featureKey}
            className="flex items-center justify-between rounded-xl border border-line px-4 py-3"
          >
            <div>
              <p className="text-sm font-black">{featureLabel(f.featureKey)}</p>
              <p className="text-xs text-ink-muted">
                {f.entitlementStatus === 'ENABLED' ? 'Entitled' : f.entitlementStatus}
                {f.trialEndsAt && ` · Trial ends ${new Date(f.trialEndsAt).toLocaleDateString()}`}
              </p>
            </div>
            <button
              onClick={() => toggleFeature(f.featureKey, f.tenantEnabled)}
              disabled={!isOwner || toggling === f.featureKey}
              role="switch"
              aria-checked={f.effective}
              aria-label={`${f.tenantEnabled ? 'Disable' : 'Enable'} ${featureLabel(f.featureKey)}`}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                f.effective ? 'bg-brand' : 'bg-slate-300'
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <span
                className={`inline-block size-4 rounded-full bg-white shadow-sm transition-transform ${
                  f.effective ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
