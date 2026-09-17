'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { Button } from '@/components/ui/button';
import { StatusChip } from '@/components/ui/status-chip';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import {
  fetchTenants,
  suspendTenant,
  activateTenant,
  type Tenant,
} from '@/lib/platform-api';

const statusVariant: Record<string, 'success' | 'warning' | 'danger' | 'idle'> = {
  ACTIVE: 'success',
  TRIAL: 'warning',
  SUSPENDED: 'danger',
};

export function PlatformAdmin() {
  const { accessToken, csrfToken } = useAuth();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTenants(accessToken, csrfToken);
      setTenants(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tenants');
    } finally {
      setLoading(false);
    }
  }, [accessToken, csrfToken]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  async function handleToggle(tenant: Tenant) {
    if (!accessToken) return;
    setActionLoading(tenant.id);
    try {
      if (tenant.status === 'SUSPENDED') {
        const updated = await activateTenant(tenant.id, accessToken, csrfToken);
        setTenants((prev) => prev.map((t) => t.id === tenant.id ? updated : t));
      } else {
        const updated = await suspendTenant(tenant.id, accessToken, csrfToken);
        setTenants((prev) => prev.map((prev) => prev.id === tenant.id ? updated : prev));
      }
    } catch {
    } finally {
      setActionLoading(null);
    }
  }

  const activeCount = tenants.filter((t) => t.status === 'ACTIVE').length;
  const trialCount = tenants.filter((t) => t.status === 'TRIAL').length;
  const suspendedCount = tenants.filter((t) => t.status === 'SUSPENDED').length;

  if (loading) return <PlatformSkeleton />;

  if (error) {
    return (
      <div className="grid min-h-[55vh] place-items-center">
        <div className="max-w-sm rounded-panel border border-line bg-white p-8 text-center shadow-card">
          <p className="text-lg font-extrabold">Platform unavailable</p>
          <p className="mt-2 text-sm text-ink-muted">{error}</p>
          <Button onClick={() => void fetchAll()} className="mt-5">Try again</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1500px]">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-brand">Platform</p>
          <h1 className="mt-2 text-3xl font-black tracking-[-0.045em] sm:text-4xl">Tenant operations</h1>
          <p className="mt-2 text-sm text-ink-muted">Manage restaurant tenants, account status, and platform-wide access.</p>
        </div>
      </header>

      <section className="mt-7 grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Active tenants" value={String(activeCount)} detail="Currently active" tone="brand" />
        <SummaryCard label="Trial tenants" value={String(trialCount)} detail="Evaluating" tone="dark" />
        <SummaryCard label="Suspended" value={String(suspendedCount)} detail="Account suspended" tone="amber" />
      </section>

      <section className="mt-5 rounded-panel border border-line bg-white shadow-card overflow-x-auto">
        {tenants.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm font-bold text-ink-muted">No restaurants registered yet</p>
            <p className="mt-1 text-xs text-ink-muted">Tenants will appear here once they sign up.</p>
          </div>
        ) : (
          <table className="w-full min-w-[700px] text-left">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wider text-ink-muted">
                <th className="px-5 py-4">Restaurant</th>
                <th className="px-5 py-4">Slug</th>
                <th className="px-5 py-4">Members</th>
                <th className="px-5 py-4">Branches</th>
                <th className="px-5 py-4">Status</th>
                <th className="px-5 py-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => (
                <tr key={tenant.id} className="border-b border-line last:border-0 text-sm">
                  <td className="px-5 py-5 font-black">{tenant.name}</td>
                  <td className="px-5 py-5 text-ink-muted">{tenant.slug}</td>
                  <td className="px-5 py-5">{tenant._count?.memberships ?? 0}</td>
                  <td className="px-5 py-5">{tenant._count?.branches ?? 0}</td>
                  <td className="px-5 py-5">
                    <StatusChip status={statusVariant[tenant.status] ?? 'idle'}>{tenant.status}</StatusChip>
                  </td>
                  <td className="px-5 py-5">
                    <div className="flex gap-3">
                      <button
                        onClick={() => void handleToggle(tenant)}
                        disabled={actionLoading === tenant.id}
                        className={cn('text-xs font-black', tenant.status === 'SUSPENDED' ? 'text-emerald-700' : 'text-amber-700')}
                      >
                        {actionLoading === tenant.id ? '...' : tenant.status === 'SUSPENDED' ? 'Activate' : 'Suspend'}
                      </button>
                      <Link href="/platform/features" className="text-xs font-black text-brand">Features →</Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function SummaryCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: 'brand' | 'dark' | 'amber' }) {
  const styles = tone === 'dark' ? 'bg-dark text-white' : tone === 'amber' ? 'border-amber-200 bg-amber-50' : 'border-line bg-white';
  return (
    <article className={cn('rounded-card border border-transparent p-5 shadow-card', styles)}>
      <p className={cn('text-xs font-black', tone === 'dark' ? 'text-white/55' : 'text-ink-muted')}>{label}</p>
      <p className="mt-3 text-2xl font-black tracking-[-0.04em]">{value}</p>
      <p className={cn('mt-1 text-xs font-semibold', tone === 'dark' ? 'text-white/50' : 'text-ink-muted')}>{detail}</p>
    </article>
  );
}

function PlatformSkeleton() {
  return (
    <div className="mx-auto max-w-[1500px] animate-pulse">
      <Skeleton className="h-10 w-64 rounded-xl" />
      <div className="mt-7 grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-card" />)}
      </div>
      <Skeleton className="mt-5 h-64 rounded-panel" />
    </div>
  );
}
