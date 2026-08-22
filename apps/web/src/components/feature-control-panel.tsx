'use client';

import { useMemo, useState } from 'react';
import { branchOverrideLabel, dependencyBlockers, effectiveFeatureEnabled, featureCatalog } from '@/lib/feature-control';
import type { EntitlementState, TenantFeatureControl } from '@/lib/types';

const initialControls: TenantFeatureControl[] = featureCatalog.map((feature, index) => ({
  featureKey: feature.key,
  entitlement: feature.key === 'PAYMENT_GATEWAY' ? 'DISABLED' : feature.key === 'ANALYTICS' ? 'TRIAL' : 'ENABLED',
  tenantEnabled: !['BATCH_INVENTORY', 'PAYMENT_GATEWAY'].includes(feature.key),
  branchOverride: feature.branchConfigurable && feature.key === 'PICKUP_ORDERING' ? 'DISABLED' : 'INHERIT',
  trialEndsAt: feature.key === 'ANALYTICS' ? '2026-09-30T23:59:59+03:00' : undefined,
  updatedAt: index < 3 ? 'Today, 10:42' : '18 Aug, 16:20',
  updatedBy: index < 3 ? 'Platform Admin' : 'Marta Alemu',
}));

const entitlementStyles: Record<EntitlementState, string> = {
  ENABLED: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15',
  DISABLED: 'bg-stone-100 text-stone-600 ring-stone-600/10',
  TRIAL: 'bg-amber-50 text-amber-800 ring-amber-600/15',
  SUSPENDED: 'bg-red-50 text-red-700 ring-red-600/15',
};

export function FeatureControlPanel() {
  const [controls, setControls] = useState(initialControls);
  const [branch, setBranch] = useState('Bole Main');
  const [category, setCategory] = useState('All');
  const [saved, setSaved] = useState(true);
  const visibleFeatures = useMemo(() => featureCatalog.filter((feature) => category === 'All' || feature.category === category), [category]);
  const enabledCount = controls.filter((control) => effectiveFeatureEnabled(control, controls)).length;

  function updateControl(featureKey: string, patch: Partial<TenantFeatureControl>) {
    setSaved(false);
    setControls((current) => current.map((item) => item.featureKey === featureKey ? { ...item, ...patch } : item));
  }

  return (
    <div className="mx-auto max-w-[1500px]">
      <header className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-brand"><span>Platform</span><span className="text-ink-muted/50">/</span><span>Buna House</span></div>
          <h1 className="mt-3 text-3xl font-black tracking-[-0.045em] sm:text-4xl">Feature control</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">Control which modules this restaurant may use, then inspect how restaurant and branch settings affect the final experience.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="min-h-11 rounded-control border border-line bg-white px-4 text-sm font-extrabold shadow-sm">View audit history</button>
          <button onClick={() => setSaved(true)} disabled={saved} className="min-h-11 rounded-control bg-[#18241f] px-5 text-sm font-extrabold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-45">{saved ? 'Changes saved' : 'Save changes'}</button>
        </div>
      </header>

      <section className="mt-7 grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Effective modules" value={`${enabledCount} of ${featureCatalog.length}`} detail="Available at selected branch" tone="brand" />
        <SummaryCard label="Plan" value="Full service" detail="Renews 01 October 2026" tone="dark" />
        <SummaryCard label="Attention" value="2 modules" detail="One disabled, one dependency blocked" tone="amber" />
      </section>

      <section className="mt-5 rounded-panel border border-line bg-white p-4 shadow-card sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex gap-2 overflow-x-auto hide-scrollbar" aria-label="Feature categories">
            {['All', 'Ordering', 'Payments', 'Operations', 'Growth'].map((item) => <button key={item} onClick={() => setCategory(item)} className={`min-h-10 whitespace-nowrap rounded-full px-4 text-xs font-black ${category === item ? 'bg-[#18241f] text-white' : 'bg-muted text-ink-muted hover:text-ink'}`}>{item}</button>)}
          </div>
          <label className="flex min-w-64 items-center gap-3 rounded-control border border-line bg-[#faf8f4] px-3 py-2"><span className="text-xs font-black text-ink-muted">Branch view</span><select value={branch} onChange={(event) => setBranch(event.target.value)} className="min-h-8 flex-1 bg-transparent text-sm font-extrabold outline-none"><option>Bole Main</option><option>Downtown</option><option>Airport</option></select></label>
        </div>
      </section>

      <div className="mt-5 space-y-3">
        {visibleFeatures.map((feature) => {
          const control = controls.find((item) => item.featureKey === feature.key)!;
          const blockers = dependencyBlockers(feature.key, controls);
          const effective = effectiveFeatureEnabled(control, controls);
          return (
            <article key={feature.key} className="rounded-panel border border-line bg-white p-5 shadow-card sm:p-6">
              <div className="grid gap-5 xl:grid-cols-[1.2fr_.75fr_.75fr_.8fr] xl:items-center">
                <div className="flex gap-4"><span className={`grid size-12 shrink-0 place-items-center rounded-xl text-sm font-black ${effective ? 'bg-brand text-white' : 'bg-muted text-ink-muted'}`}>{feature.name.split(' ').map((word) => word[0]).slice(0, 2).join('')}</span><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-black">{feature.name}</h2><span className="rounded-full bg-muted px-2 py-1 text-[9px] font-black uppercase tracking-wider text-ink-muted">{feature.category}</span></div><p className="mt-1 max-w-xl text-sm leading-5 text-ink-muted">{feature.description}</p>{blockers.length > 0 && <p className="mt-2 text-xs font-bold text-amber-700">Requires {blockers.map((item) => item.name).join(', ')}</p>}</div></div>
                <Control label="Platform entitlement"><select value={control.entitlement} onChange={(event) => updateControl(feature.key, { entitlement: event.target.value as EntitlementState })} className="control-select"><option value="ENABLED">Enabled</option><option value="TRIAL">Trial</option><option value="DISABLED">Disabled</option><option value="SUSPENDED">Suspended</option></select><span className={`mt-2 inline-flex w-fit rounded-full px-2 py-1 text-[9px] font-black ring-1 ring-inset ${entitlementStyles[control.entitlement]}`}>{control.entitlement}</span></Control>
                <Control label="Restaurant setting"><button disabled={!['ENABLED', 'TRIAL'].includes(control.entitlement)} onClick={() => updateControl(feature.key, { tenantEnabled: !control.tenantEnabled })} className="flex min-h-10 items-center justify-between rounded-control border border-line px-3 text-sm font-bold disabled:opacity-45"><span>{control.tenantEnabled ? 'On' : 'Off'}</span><span className={`relative h-6 w-11 rounded-full transition ${control.tenantEnabled ? 'bg-brand' : 'bg-stone-300'}`}><span className={`absolute top-1 size-4 rounded-full bg-white transition ${control.tenantEnabled ? 'left-6' : 'left-1'}`} /></span></button></Control>
                <Control label={feature.branchConfigurable ? branch : 'Scope'}>{feature.branchConfigurable ? <select value={control.branchOverride} onChange={(event) => updateControl(feature.key, { branchOverride: event.target.value as TenantFeatureControl['branchOverride'] })} className="control-select"><option value="INHERIT">Follow tenant</option><option value="ENABLED">Enabled here</option><option value="DISABLED">Disabled here</option></select> : <div className="flex min-h-10 items-center rounded-control bg-muted px-3 text-sm font-bold text-ink-muted">Tenant-wide</div>}<p className={`mt-2 text-xs font-black ${effective ? 'text-emerald-700' : 'text-stone-500'}`}>{effective ? 'Effective: enabled' : 'Effective: disabled'}{feature.branchConfigurable ? ` · ${branchOverrideLabel(control.branchOverride)}` : ''}</p></Control>
              </div>
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-3 text-[11px] font-semibold text-ink-muted"><span>Updated {control.updatedAt}</span><span>By {control.updatedBy}</span>{control.trialEndsAt && <span className="text-amber-700">Trial ends 30 Sep 2026</span>}</div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><p className="mb-2 text-[10px] font-black uppercase tracking-[0.14em] text-ink-muted">{label}</p><div className="flex flex-col">{children}</div></div>;
}

function SummaryCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: 'brand' | 'dark' | 'amber' }) {
  const styles = tone === 'dark' ? 'bg-[#18241f] text-white' : tone === 'amber' ? 'border-amber-200 bg-amber-50' : 'border-line bg-white';
  return <article className={`rounded-card border border-transparent p-5 shadow-card ${styles}`}><p className={`text-xs font-black ${tone === 'dark' ? 'text-white/55' : 'text-ink-muted'}`}>{label}</p><p className="mt-3 text-2xl font-black tracking-[-0.04em]">{value}</p><p className={`mt-1 text-xs font-semibold ${tone === 'dark' ? 'text-white/50' : 'text-ink-muted'}`}>{detail}</p></article>;
}
