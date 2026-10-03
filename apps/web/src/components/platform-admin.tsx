'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { Button } from '@/components/ui/button';
import { StatusChip } from '@/components/ui/status-chip';
import { Skeleton } from '@/components/ui/skeleton';
import { Banner } from '@/components/ui/banner';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { PageHeader } from '@/components/ui/page-header';
import { useLocale } from '@/components/locale-provider';
import { cn } from '@/lib/cn';
import { labelFor, tenantStatusKeys } from '@/lib/status-labels';
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
  const { tr } = useLocale();
  const router = useRouter();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<Tenant | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTenants(accessToken, csrfToken);
      setTenants(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('platform.loadError'));
    } finally {
      setLoading(false);
    }
  }, [accessToken, csrfToken]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  async function handleToggle(tenant: Tenant) {
    if (!accessToken) return;
    setActionLoading(tenant.id);
    setActionError(null);
    try {
      if (tenant.status === 'SUSPENDED') {
        const updated = await activateTenant(tenant.id, accessToken, csrfToken);
        setTenants((prev) => prev.map((t) => t.id === tenant.id ? updated : t));
      } else {
        const updated = await suspendTenant(tenant.id, accessToken, csrfToken);
        setTenants((prev) => prev.map((prev) => prev.id === tenant.id ? updated : prev));
      }
    } catch {
      setActionError(tr(tenant.status === 'SUSPENDED' ? 'platform.activateError' : 'platform.suspendError', { name: tenant.name }));
    } finally {
      setActionLoading(null);
      setPendingAction(null);
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
          <p className="text-lg font-extrabold">{tr('platform.unavailableTitle')}</p>
          <p className="mt-2 text-sm text-ink-muted">{error}</p>
          <Button onClick={() => void fetchAll()} className="mt-5">{tr('common.tryAgain')}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1500px]">
      <PageHeader
        eyebrow={tr('platform.eyebrow')}
        title={tr('platform.pageTitle')}
        description={tr('platform.pageDescription')}
        actions={
          <Button onClick={() => router.push('/platform/tenants/new')}>{tr('platform.newTenantBtn')}</Button>
        }
      />

      {actionError && (
        <Banner variant="danger" title={tr('platform.actionFailed')} onDismiss={() => setActionError(null)} className="mt-5">
          {actionError}
        </Banner>
      )}

      <section className="mt-7 grid gap-3 sm:grid-cols-3">
        <SummaryCard label={tr('platform.activeLabel')} value={String(activeCount)} detail={tr('platform.activeDetail')} tone="brand" />
        <SummaryCard label={tr('platform.trialLabel')} value={String(trialCount)} detail={tr('platform.trialDetail')} tone="dark" />
        <SummaryCard label={tr('platform.suspendedLabel')} value={String(suspendedCount)} detail={tr('platform.suspendedDetail')} tone="amber" />
      </section>

      <section className="mt-5 rounded-panel border border-line bg-white shadow-card overflow-x-auto">
        {tenants.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm font-bold text-ink-muted">{tr('platform.emptyTitle')}</p>
            <p className="mt-1 text-xs text-ink-muted">{tr('platform.emptyHint')}</p>
          </div>
        ) : (
          <table className="w-full min-w-[700px] text-start">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wider text-ink-muted">
                <th className="px-5 py-4">{tr('platform.thRestaurant')}</th>
                <th className="px-5 py-4">{tr('platform.thSlug')}</th>
                <th className="px-5 py-4">{tr('platform.thMembers')}</th>
                <th className="px-5 py-4">{tr('platform.thBranches')}</th>
                <th className="px-5 py-4">{tr('platform.thStatus')}</th>
                <th className="px-5 py-4">{tr('platform.thActions')}</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => (
                <tr key={tenant.id} className="border-b border-line last:border-0 text-sm">
                  <td className="px-5 py-5">
                    <Link href={`/platform/tenants/${tenant.id}`} className="font-black hover:text-brand hover:underline">
                      {tenant.name}
                    </Link>
                  </td>
                  <td className="px-5 py-5 text-ink-muted">{tenant.slug}</td>
                  <td className="px-5 py-5">{tenant._count?.memberships ?? 0}</td>
                  <td className="px-5 py-5">{tenant._count?.branches ?? 0}</td>
                  <td className="px-5 py-5">
                    <StatusChip status={statusVariant[tenant.status] ?? 'idle'}>
                      {labelFor(tenantStatusKeys, tenant.status, tr)}
                    </StatusChip>
                  </td>
                  <td className="px-5 py-5">
                    <div className="flex gap-3">
                      <button
                        onClick={() => setPendingAction(tenant)}
                        disabled={actionLoading === tenant.id}
                        className={cn('text-xs font-black', tenant.status === 'SUSPENDED' ? 'text-emerald-700' : 'text-amber-700')}
                      >
                        {actionLoading === tenant.id ? '...' : tenant.status === 'SUSPENDED' ? tr('platform.activateBtn') : tr('platform.suspendBtn')}
                      </button>
                      <Link href={`/platform/features?tenant=${tenant.id}`} className="text-xs font-black text-brand">{tr('platform.featuresLink')}</Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <ConfirmDialog
        open={pendingAction !== null}
        onOpenChange={(open) => { if (!open) setPendingAction(null); }}
        title={pendingAction ? tr(pendingAction.status === 'SUSPENDED' ? 'platform.activateTitle' : 'platform.suspendTitle', { name: pendingAction.name }) : ''}
        description={
          pendingAction?.status === 'SUSPENDED'
            ? tr('platform.activateDesc')
            : tr('platform.suspendDesc')
        }
        confirmLabel={pendingAction?.status === 'SUSPENDED' ? tr('platform.activateConfirm') : tr('platform.suspendConfirm')}
        variant={pendingAction?.status === 'SUSPENDED' ? 'primary' : 'danger'}
        onConfirm={() => { if (pendingAction) void handleToggle(pendingAction); }}
      />
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
