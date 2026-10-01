'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/auth-provider';
import { branchOverrideLabel, dependencyBlockers, effectiveFeatureEnabled, featureCatalog } from '@/lib/feature-control';
import {
  fetchTenants,
  fetchTenantDetail,
  fetchEntitlements,
  setEntitlement,
  type Tenant,
  type TenantBranch,
  type FeatureEntitlement,
} from '@/lib/platform-api';
import type { BranchOverride, EntitlementState, FeatureKey, TenantFeatureControl } from '@/lib/types';
import { Button, PageHeader, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from '@/components/ui';

const entitlementStyles: Record<EntitlementState, string> = {
  ENABLED: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15',
  DISABLED: 'bg-stone-100 text-stone-600 ring-stone-600/10',
  TRIAL: 'bg-amber-50 text-amber-800 ring-amber-600/15',
  SUSPENDED: 'bg-red-50 text-red-700 ring-red-600/15',
};

function mapEntitlementToControl(e: FeatureEntitlement): TenantFeatureControl {
  return {
    featureKey: e.featureKey as FeatureKey,
    entitlement: (e.status as EntitlementState) || 'DISABLED',
    tenantEnabled: ['ENABLED', 'TRIAL'].includes(e.status),
    branchOverride: 'INHERIT',
    trialEndsAt: e.trialEndsAt ?? undefined,
    updatedAt: '',
    updatedBy: '',
  };
}

export function FeatureControlPanel() {
  const { accessToken, csrfToken } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string>('');
  const [controls, setControls] = useState<TenantFeatureControl[]>([]);
  const [branches, setBranches] = useState<TenantBranch[]>([]);
  const [branchId, setBranchId] = useState<string>('');
  const [category, setCategory] = useState('All');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visibleFeatures = useMemo(() => featureCatalog.filter((f) => category === 'All' || f.category === category), [category]);
  const enabledCount = controls.filter((c) => effectiveFeatureEnabled(c, controls)).length;
  const dirtyCount = Object.values(dirty).filter(Boolean).length;
  const selectedBranchName = branches.find((b) => b.id === branchId)?.name ?? 'this branch';

  const loadEntitlements = useCallback(
    async (tenantId: string) => {
      if (!accessToken || !tenantId) return;
      setLoading(true);
      setError(null);
      try {
        const data = await fetchEntitlements(tenantId, accessToken, csrfToken);
        setControls(data.map(mapEntitlementToControl));
        setDirty({});
      } catch {
        setError('Failed to load feature entitlements');
      } finally {
        setLoading(false);
      }
    },
    [accessToken, csrfToken],
  );

  const loadBranches = useCallback(
    async (tenantId: string) => {
      if (!accessToken || !tenantId) return;
      try {
        const detail = await fetchTenantDetail(tenantId, accessToken, csrfToken);
        const list = detail.branches ?? [];
        setBranches(list);
        setBranchId((prev) => {
          if (prev && list.some((b) => b.id === prev)) return prev;
          return (list.find((b) => b.isActive) ?? list[0])?.id ?? '';
        });
      } catch {
        setError('Failed to load branches for this restaurant');
      }
    },
    [accessToken, csrfToken],
  );

  const loadTenants = useCallback(async () => {
    if (!accessToken) return;
    try {
      const data = await fetchTenants(accessToken, csrfToken);
      setTenants(data);
      if (data.length > 0) {
        const requested = searchParams.get('tenant');
        const initial = requested && data.some((t) => t.id === requested) ? requested : data[0].id;
        setSelectedTenantId(initial);
        await Promise.all([loadEntitlements(initial), loadBranches(initial)]);
      }
    } catch {
      setError('Failed to load tenants');
    }
  }, [accessToken, csrfToken, searchParams, loadEntitlements, loadBranches]);

  useEffect(() => {
    void loadTenants();
  }, [loadTenants]);

  function handleTenantChange(tenantId: string) {
    setSelectedTenantId(tenantId);
    router.replace(`/platform/features?tenant=${tenantId}`, { scroll: false });
    void loadEntitlements(tenantId);
    void loadBranches(tenantId);
  }

  async function handleSave() {
    if (!accessToken || !selectedTenantId) return;
    setSaving(true);
    try {
      const dirtyKeys = Object.entries(dirty).filter(([, v]) => v).map(([k]) => k);
      await Promise.all(
        dirtyKeys.map((key) => {
          const control = controls.find((c) => c.featureKey === key);
          if (!control) return Promise.resolve();
          return setEntitlement(selectedTenantId, key, control.entitlement, accessToken, csrfToken);
        }),
      );
      setDirty({});
    } catch {
      setError('Failed to save changes');
    } finally {
      setSaving(false);
    }
  }

  function updateControl(featureKey: string, patch: Partial<TenantFeatureControl>) {
    setDirty((d) => ({ ...d, [featureKey]: true }));
    setControls((current) => current.map((item) => item.featureKey === featureKey ? { ...item, ...patch } : item));
  }

  return (
    <div className="page-shell">
      <PageHeader eyebrow={`Platform / ${tenants.find((t) => t.id === selectedTenantId)?.name ?? 'Select tenant'}`} title="Feature control" description="Control which modules this restaurant may use, then inspect how tenant and branch settings affect the final experience." actions={<>
          {tenants.length === 0 && (
            <Button variant="secondary" onClick={loadTenants}>Load tenants</Button>
          )}
          <Button onClick={handleSave} disabled={saving || dirtyCount === 0} loading={saving}>
            {saving ? 'Saving...' : dirtyCount > 0 ? `Save ${dirtyCount} change${dirtyCount > 1 ? 's' : ''}` : 'No changes'}
          </Button>
        </>} />

      {tenants.length > 0 && (
        <section className="mt-4">
          <div className="max-w-sm"><p className="mb-2 text-xs font-semibold text-ink-muted">Tenant workspace</p><Select value={selectedTenantId} onValueChange={handleTenantChange}><SelectTrigger><SelectValue placeholder="Select tenant" /></SelectTrigger><SelectContent>{tenants.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent></Select></div>
        </section>
      )}

      {error && <div className="mt-4 rounded-control border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}

      <section className="mt-7 grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Effective modules" value={`${enabledCount} of ${featureCatalog.length}`} detail="Available at selected branch" tone="brand" />
        <SummaryCard label="Features" value={`${controls.length} loaded`} detail={loading ? 'Loading...' : 'From platform API'} tone="dark" />
        <SummaryCard label="Attention" value={`${dirtyCount} unsaved`} detail={dirtyCount > 0 ? 'Changes pending' : 'All saved'} tone={dirtyCount > 0 ? 'amber' : 'brand'} />
      </section>

      <section className="mt-5 rounded-panel border border-line bg-white p-4 shadow-card sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex gap-2 overflow-x-auto hide-scrollbar" aria-label="Feature categories">
            {['All', 'Ordering', 'Payments', 'Operations', 'Growth'].map((item) => <button key={item} onClick={() => setCategory(item)} className={`min-h-10 whitespace-nowrap rounded-full px-4 text-xs font-black ${category === item ? 'bg-dark text-white' : 'bg-muted text-ink-muted hover:text-ink'}`}>{item}</button>)}
          </div>
          <div className="min-w-64"><p className="mb-2 text-xs font-semibold text-ink-muted">Branch view</p><Select value={branchId} onValueChange={setBranchId} disabled={branches.length === 0}><SelectTrigger><SelectValue placeholder={branches.length > 0 ? 'Select branch' : 'No branches yet'} /></SelectTrigger><SelectContent>{branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}{b.isActive ? '' : ' (inactive)'}</SelectItem>)}</SelectContent></Select></div>
        </div>
      </section>

      {loading ? (
        <div className="mt-5 rounded-panel border border-line bg-white p-10 text-center text-sm text-ink-muted">Loading feature entitlements...</div>
      ) : controls.length === 0 ? (
        <div className="mt-5 rounded-panel border border-line bg-white p-10 text-center text-sm text-ink-muted">
          {selectedTenantId ? 'No entitlements found for this tenant.' : 'Select a tenant to view feature controls.'}
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          {visibleFeatures.map((feature) => {
            const control = controls.find((item) => item.featureKey === feature.key);
            if (!control) return null;
            const blockers = dependencyBlockers(feature.key, controls);
            const effective = effectiveFeatureEnabled(control, controls);
            return (
              <article key={feature.key} className="rounded-panel border border-line bg-white p-5 shadow-card sm:p-6">
                <div className="grid gap-5 xl:grid-cols-[1.2fr_.75fr_.75fr_.8fr] xl:items-center">
                  <div className="flex gap-4"><span className={`grid size-12 shrink-0 place-items-center rounded-xl text-sm font-black ${effective ? 'bg-brand text-white' : 'bg-muted text-ink-muted'}`}>{feature.name.split(' ').map((word) => word[0]).slice(0, 2).join('')}</span><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-black">{feature.name}</h2><span className="rounded-full bg-muted px-2 py-1 text-[9px] font-black uppercase tracking-wider text-ink-muted">{feature.category}</span></div><p className="mt-1 max-w-xl text-sm leading-5 text-ink-muted">{feature.description}</p>{blockers.length > 0 && <p className="mt-2 text-xs font-bold text-amber-700">Requires {blockers.map((item) => item.name).join(', ')}</p>}</div></div>
                  <Control label="Platform entitlement"><Select value={control.entitlement} onValueChange={(value) => updateControl(feature.key, { entitlement: value as EntitlementState })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{(['ENABLED', 'TRIAL', 'DISABLED', 'SUSPENDED'] as const).map((value) => <SelectItem key={value} value={value}>{value[0]}{value.slice(1).toLowerCase()}</SelectItem>)}</SelectContent></Select><span className={`mt-2 inline-flex w-fit rounded-full px-2 py-1 text-[9px] font-black ring-1 ring-inset ${entitlementStyles[control.entitlement]}`}>{control.entitlement}</span></Control>
                  <Control label="Restaurant setting"><div className="flex min-h-11 items-center justify-between rounded-control border border-border px-3"><span className="text-sm font-semibold">{control.tenantEnabled ? 'On' : 'Off'}</span><Switch label={`${feature.name} restaurant setting`} disabled={!['ENABLED', 'TRIAL'].includes(control.entitlement)} checked={control.tenantEnabled} onCheckedChange={(checked) => updateControl(feature.key, { tenantEnabled: checked })} className="[&+label]:sr-only" /></div></Control>
                  <Control label={feature.branchConfigurable ? selectedBranchName : 'Scope'}>{feature.branchConfigurable ? <Select value={control.branchOverride} onValueChange={(value) => updateControl(feature.key, { branchOverride: value as BranchOverride })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="INHERIT">Follow tenant</SelectItem><SelectItem value="ENABLED">Enabled here</SelectItem><SelectItem value="DISABLED">Disabled here</SelectItem></SelectContent></Select> : <div className="flex min-h-11 items-center rounded-control bg-muted px-3 text-sm font-bold text-ink-muted">Tenant-wide</div>}<p className={`mt-2 text-xs font-black ${effective ? 'text-emerald-700' : 'text-stone-500'}`}>{effective ? 'Effective: enabled' : 'Effective: disabled'}{feature.branchConfigurable ? ` · ${branchOverrideLabel(control.branchOverride)}` : ''}</p></Control>
                </div>
                {dirty[feature.key] && <div className="mt-3 text-xs font-bold text-amber-600">Unsaved change</div>}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><p className="mb-2 text-[10px] font-black uppercase tracking-[0.14em] text-ink-muted">{label}</p><div className="flex flex-col">{children}</div></div>;
}

function SummaryCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: 'brand' | 'dark' | 'amber' }) {
  const styles = tone === 'dark' ? 'bg-dark text-white' : tone === 'amber' ? 'border-amber-200 bg-amber-50' : 'border-line bg-white';
  return <article className={`rounded-card border border-transparent p-5 shadow-card ${styles}`}><p className={`text-xs font-black ${tone === 'dark' ? 'text-white/55' : 'text-ink-muted'}`}>{label}</p><p className="mt-3 text-2xl font-black tracking-[-0.04em]">{value}</p><p className={`mt-1 text-xs font-semibold ${tone === 'dark' ? 'text-white/50' : 'text-ink-muted'}`}>{detail}</p></article>;
}
