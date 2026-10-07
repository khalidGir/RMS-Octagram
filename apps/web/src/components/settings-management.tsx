'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError, apiRequest, type ApiEnvelope } from '@/lib/api-client';
import type { TenantLogoView } from '@/lib/types';
import { useAuth } from './auth-provider';
import { useLocale } from '@/components/locale-provider';

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
interface LogoStatus {
  processingStatus: string;
  rejectionReason: string | null;
  logo: TenantLogoView | null;
  tenantVersion: number;
}

const LOGO_PROCESSING_STATUSES = new Set(['PENDING_UPLOAD', 'PENDING_PROCESSING', 'PROCESSING']);
const LOGO_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const LOGO_MAX_BYTES = 10 * 1024 * 1024;
const ACTIVE_MEDIA_STORAGE_KEY = 'rms:logo-active-media';

function readStoredActiveMediaId(): string | null {
  try {
    return sessionStorage.getItem(ACTIVE_MEDIA_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeActiveMediaId(id: string | null): void {
  try {
    if (id) sessionStorage.setItem(ACTIVE_MEDIA_STORAGE_KEY, id);
    else sessionStorage.removeItem(ACTIVE_MEDIA_STORAGE_KEY);
  } catch {
    /* Storage unavailable: polling still works for the current visit. */
  }
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
  const { tr } = useLocale();
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
      (
        await apiRequest<ApiEnvelope<FeatureStatus[]>>('/tenants/features', {
          accessToken,
          tenantId,
        })
      ).data,
  });

  if (!membership || !['OWNER', 'MANAGER'].includes(membership.role)) {
    return (
      <section className="grid min-h-72 place-items-center text-center">
        <div>
          <h1 className="text-2xl font-black">{tr('settings.permissionDenied')}</h1>
          <p className="mt-2 max-w-md text-sm text-ink-muted">
            {membership ? tr('settings.ownerOnlyHint') : tr('settings.noRestaurantHint')}
          </p>
        </div>
      </section>
    );
  }

  const isOwner = membership.role === 'OWNER';

  return (
    <>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[.18em] text-brand">
            {tr('settings.eyebrow')}
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
            {tr('settings.pageTitle')}
          </h1>
          <p className="mt-2 text-sm text-ink-muted">{tr('settings.pageDescription')}</p>
        </div>
      </div>

      {notice && (
        <div
          role="status"
          className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-900"
        >
          {notice}
        </div>
      )}

      {tenant.isLoading && (
        <p className="py-16 text-center text-sm font-bold text-ink-muted">
          {tr('settings.loading')}
        </p>
      )}

      {tenant.isError && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800"
        >
          {tr('settings.loadError')}
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
                setNotice(tr('settings.identityUpdated'));
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
                setNotice(tr('settings.featureUpdated'));
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
  const { tr } = useLocale();

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) return setError(tr('settings.enterName'));
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
      setError(err instanceof ApiError ? err.message : tr('settings.saveError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-black/[.07] bg-white p-6 shadow-sm">
      <h2 className="text-lg font-black">{tr('settings.identityTitle')}</h2>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-black">
          {tr('settings.displayName')}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!isOwner}
            className="mt-2 min-h-12 w-full rounded-xl border border-line bg-white px-4 font-normal outline-none focus:ring-2 focus:ring-brand/20 disabled:opacity-50"
          />
        </label>
        <label className="text-sm font-black">
          {tr('settings.primaryColour')}
          <input
            type="color"
            value={colour}
            onChange={(e) => setColour(e.target.value)}
            className="mt-2 h-12 w-full rounded-xl border border-line p-1"
          />
        </label>
      </div>
      <TenantLogoCard
        isOwner={isOwner}
        accessToken={accessToken}
        csrfToken={csrfToken}
        tenantId={tenantId}
      />
      {error && (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800"
        >
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
            {busy ? tr('settings.saving') : tr('settings.saveChanges')}
          </button>
        </div>
      )}

      <div className="mt-6 rounded-xl p-5 text-white" style={{ background: colour }}>
        <p className="text-xs font-bold text-white/70">{tr('settings.livePreview')}</p>
        <h2 className="mt-2 text-2xl font-black">
          {name || tr('settings.restaurantNameFallback')}
        </h2>
        <p className="mt-1 text-sm text-white/80">{tr('settings.tagline')}</p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                            TenantLogoCard                                  */
/* -------------------------------------------------------------------------- */

function TenantLogoCard({
  isOwner,
  accessToken,
  csrfToken,
  tenantId,
}: {
  isOwner: boolean;
  accessToken: string;
  csrfToken: string | null;
  tenantId: string;
}) {
  const { tr } = useLocale();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'upload' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // While an upload is in flight, status must be polled for THAT media object:
  // the attached logo still points at the old image (or none) until the worker
  // swaps it in, so querying without an id would miss the processing state.
  const [activeMediaId, setActiveMediaId] = useState<string | null>(null);

  useEffect(() => {
    const stored = readStoredActiveMediaId();
    if (stored) setActiveMediaId(stored);
  }, []);

  const status = useQuery({
    queryKey: ['tenant-logo-status', tenantId, activeMediaId ?? 'attached'],
    enabled: Boolean(accessToken && tenantId && isOwner),
    queryFn: async () =>
      (
        await apiRequest<ApiEnvelope<LogoStatus>>(
          `/tenants/current/logo/status${
            activeMediaId ? `?mediaObjectId=${encodeURIComponent(activeMediaId)}` : ''
          }`,
          {
            accessToken,
            tenantId,
          },
        )
      ).data,
    refetchInterval: (query) =>
      query.state.data && LOGO_PROCESSING_STATUSES.has(query.state.data.processingStatus)
        ? 2000
        : false,
  });

  // The in-flight upload finished processing: drop it so the query returns to
  // the attached-logo view (which now points at this media object).
  useEffect(() => {
    if (activeMediaId && status.data?.processingStatus === 'READY') {
      setActiveMediaId(null);
      storeActiveMediaId(null);
    }
  }, [activeMediaId, status.data?.processingStatus]);

  if (!isOwner) {
    return (
      <div className="mt-5 rounded-xl border-2 border-dashed border-line p-6 text-center text-sm font-bold text-ink-muted">
        {tr('settings.logoSoon')}
      </div>
    );
  }

  const logoStatus = status.data;
  const processing = logoStatus ? LOGO_PROCESSING_STATUSES.has(logoStatus.processingStatus) : false;
  const ready = logoStatus?.processingStatus === 'READY';
  const rejected = logoStatus?.processingStatus === 'REJECTED';

  function setActiveUpload(id: string | null) {
    setActiveMediaId(id);
    storeActiveMediaId(id);
  }

  async function pickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || busy) return;
    if (!LOGO_ALLOWED_TYPES.includes(file.type)) return setError(tr('settings.logoInvalidType'));
    if (file.size > LOGO_MAX_BYTES) return setError(tr('settings.logoTooLarge'));
    if (!logoStatus) return;
    setBusy('upload');
    setError(null);
    try {
      const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      const sha256 = Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
      const intent = await apiRequest<
        ApiEnvelope<{
          mediaObjectId: string;
          uploadUrl: string;
          fields: Record<string, string>;
          tenantVersion: number;
        }>
      >('/tenants/current/logo/upload-intent', {
        method: 'POST',
        accessToken,
        csrfToken,
        tenantId,
        body: {
          contentType: file.type,
          sizeBytes: file.size,
          sha256,
          crop: { x: 0, y: 0, width: 1, height: 1 },
          expectedVersion: logoStatus.tenantVersion,
        },
      });
      // Follow this upload's media object from here on (query key changes,
      // which fetches its status immediately).
      setActiveUpload(intent.data.mediaObjectId);
      const form = new FormData();
      Object.entries(intent.data.fields).forEach(([key, value]) => form.append(key, value));
      form.append('file', file);
      const uploaded = await fetch(intent.data.uploadUrl, { method: 'POST', body: form });
      if (!uploaded.ok) throw new Error('logo upload transport failed');
      await apiRequest('/tenants/current/logo/finalize', {
        method: 'POST',
        accessToken,
        csrfToken,
        tenantId,
        body: {
          mediaObjectId: intent.data.mediaObjectId,
          expectedVersion: intent.data.tenantVersion,
        },
      });
    } catch (err) {
      // The intent is unusable now; fall back to the attached-logo view.
      setActiveUpload(null);
      setError(err instanceof ApiError ? err.message : tr('settings.logoUploadError'));
    } finally {
      setBusy(null);
    }
  }

  async function removeLogo() {
    if (!logoStatus || busy) return;
    setBusy('remove');
    setError(null);
    try {
      await apiRequest('/tenants/current/logo', {
        method: 'DELETE',
        accessToken,
        csrfToken,
        tenantId,
        body: { expectedVersion: logoStatus.tenantVersion },
      });
      setActiveUpload(null);
      await status.refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tr('settings.logoUploadError'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-5 rounded-xl border border-black/[.07] p-5">
      <input
        ref={fileRef}
        type="file"
        accept={LOGO_ALLOWED_TYPES.join(',')}
        className="hidden"
        onChange={pickFile}
      />
      <div className="flex flex-wrap items-center gap-4">
        {logoStatus?.logo ? (
          <img
            src={logoStatus.logo.thumbnail}
            alt={tr('settings.logoTitle')}
            className="size-20 rounded-xl border border-line bg-white object-cover"
          />
        ) : (
          <div className="grid size-20 place-items-center rounded-xl border-2 border-dashed border-line text-xs font-black text-ink-muted">
            256×256
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black">{tr('settings.logoTitle')}</p>
          <p className="mt-1 text-xs font-bold text-ink-muted">{tr('settings.logoHint')}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy !== null || processing || !logoStatus}
            className="min-h-11 rounded-xl bg-dark px-5 text-sm font-bold text-white disabled:opacity-50"
          >
            {ready ? tr('settings.logoReplace') : tr('settings.logoUpload')}
          </button>
          {logoStatus?.logo && (
            <button
              onClick={removeLogo}
              disabled={busy !== null || processing}
              className="min-h-11 rounded-xl border border-line px-5 text-sm font-bold disabled:opacity-50"
            >
              {tr('settings.logoRemove')}
            </button>
          )}
        </div>
      </div>
      {processing && (
        <p role="status" className="mt-3 text-sm font-bold text-brand">
          {tr('settings.logoProcessing')}
        </p>
      )}
      {rejected && (
        <p className="mt-3 text-sm font-bold text-red-700">
          {tr('settings.logoRejected', { reason: logoStatus?.rejectionReason ?? 'UNKNOWN' })}
        </p>
      )}
      {error && (
        <div
          role="alert"
          className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800"
        >
          {error}
        </div>
      )}
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
  const { formatDate, tr } = useLocale();

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
      <h2 className="text-lg font-black">{tr('settings.featuresTitle')}</h2>
      <p className="mt-1 text-sm text-ink-muted">{tr('settings.featuresHint')}</p>

      {isLoading && (
        <p className="py-8 text-center text-sm font-bold text-ink-muted">
          {tr('settings.featuresLoading')}
        </p>
      )}

      {!isLoading && features.length === 0 && (
        <p className="py-8 text-center text-sm text-ink-muted">{tr('settings.featuresEmpty')}</p>
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
                {f.entitlementStatus === 'ENABLED' ? tr('settings.entitled') : f.entitlementStatus}
                {f.trialEndsAt && tr('settings.trialEnds', { date: formatDate(f.trialEndsAt) })}
              </p>
            </div>
            <button
              onClick={() => toggleFeature(f.featureKey, f.tenantEnabled)}
              disabled={!isOwner || toggling === f.featureKey}
              role="switch"
              aria-checked={f.effective}
              aria-label={tr('settings.toggleAria', {
                action: f.tenantEnabled
                  ? tr('settings.toggleDisable')
                  : tr('settings.toggleEnable'),
                feature: featureLabel(f.featureKey),
              })}
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
