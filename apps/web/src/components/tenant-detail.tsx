'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, MapPin } from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import {
  Banner,
  Button,
  ConfirmDialog,
  Skeleton,
  StatusChip,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import {
  activateTenant,
  fetchEntitlements,
  fetchTenantDetail,
  suspendTenant,
  type TenantDetail,
} from '@/lib/platform-api';
import { useLocale, type MessageKey } from '@/components/locale-provider';
import { labelFor, membershipStatusKeys, tenantStatusKeys } from '@/lib/status-labels';

const statusVariant: Record<string, 'success' | 'warning' | 'danger' | 'idle'> = {
  ACTIVE: 'success',
  TRIAL: 'warning',
  SUSPENDED: 'danger',
};

const memberStatusVariant: Record<string, 'success' | 'warning' | 'danger' | 'idle'> = {
  ACTIVE: 'success',
  INVITED: 'warning',
  SUSPENDED: 'danger',
  REVOKED: 'idle',
};

const ROLE_KEYS: Record<string, MessageKey> = {
  OWNER: 'platform.roleOwner',
  MANAGER: 'platform.roleManager',
  CASHIER: 'platform.roleCashier',
  KITCHEN_STAFF: 'platform.roleKitchen',
  WAITER: 'platform.roleWaiter',
};

function roleLabel(role: string): string {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

function safeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone });
    return timeZone;
  } catch {
    return 'UTC';
  }
}

function initials(name: string | null, fallback: string): string {
  const source = (name ?? fallback).trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function TenantDetail() {
  const { accessToken, csrfToken } = useAuth();
  const { tr, formatDate } = useLocale();
  const params = useParams<{ id: string }>();
  const tenantId = params.id;

  const formatDateInZone = (iso: string | null, timeZone: string): string => {
    if (!iso) return '—';
    try {
      return formatDate(iso, { day: '2-digit', month: 'short', year: 'numeric', timeZone: safeZone(timeZone) });
    } catch {
      return '—';
    }
  };

  const formatDateTimeInZone = (iso: string | null, timeZone: string): string => {
    if (!iso) return tr('platform.never');
    try {
      return formatDate(iso, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: safeZone(timeZone) });
    } catch {
      return tr('platform.never');
    }
  };

  const [detail, setDetail] = useState<TenantDetail | null>(null);
  const [featuresEnabled, setFeaturesEnabled] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken || !tenantId) return;
    setLoading(true);
    setNotFound(false);
    setActionError(null);
    try {
      const data = await fetchTenantDetail(tenantId, accessToken, csrfToken);
      setDetail(data);
      try {
        const entitlements = await fetchEntitlements(tenantId, accessToken, csrfToken);
        setFeaturesEnabled(entitlements.filter((e) => ['ENABLED', 'TRIAL'].includes(e.status)).length);
      } catch {
        setFeaturesEnabled(null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message.toLowerCase().includes('not found')) setNotFound(true);
      else setActionError(tr('platform.restaurantLoadError'));
    } finally {
      setLoading(false);
    }
  }, [accessToken, csrfToken, tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleToggle() {
    if (!accessToken || !detail) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const updated =
        detail.status === 'SUSPENDED'
          ? await activateTenant(detail.id, accessToken, csrfToken)
          : await suspendTenant(detail.id, accessToken, csrfToken);
      setDetail((prev) => (prev ? { ...prev, status: updated.status } : prev));
    } catch {
      setActionError(
        tr(detail.status === 'SUSPENDED' ? 'platform.activateError' : 'platform.suspendError', { name: detail.name }),
      );
    } finally {
      setActionLoading(false);
      setPendingAction(false);
    }
  }

  if (loading) return <DetailSkeleton />;

  if (notFound || !detail) {
    return (
      <div className="grid min-h-[55vh] place-items-center">
        <div className="max-w-sm rounded-card border border-line bg-white p-8 text-center shadow-card">
          <p className="text-lg font-extrabold">{tr('platform.notFoundTitle')}</p>
          <p className="mt-2 text-sm text-ink-muted">
            {tr('platform.notFoundDetail')}
          </p>
          <Link href="/platform" className="mt-5 inline-block">
            <Button variant="secondary">
              <ArrowLeft size={14} /> {tr('platform.backToRestaurants')}
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const zone = safeZone(detail.defaultTimezone);

  return (
    <div className="page-shell">
      <Link
        href="/platform"
        className="inline-flex items-center gap-1.5 text-xs font-black text-ink-muted transition hover:text-brand"
      >
        <ArrowLeft size={14} /> {tr('platform.allRestaurants')}
      </Link>

      <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="page-header">
          <p className="page-eyebrow">{tr('platform.tdEyebrow')}</p>
          <h1 className="page-title flex flex-wrap items-center gap-3">
            {detail.name}
            <StatusChip status={statusVariant[detail.status] ?? 'idle'}>{labelFor(tenantStatusKeys, detail.status, tr)}</StatusChip>
          </h1>
          <p className="page-description">
            {tr('platform.joinedLine', { slug: detail.slug, date: formatDateInZone(detail.createdAt, zone), currency: detail.defaultCurrency, zone })}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link href={`/platform/features?tenant=${detail.id}`}>
            <Button variant="secondary">{tr('platform.manageFeatures')}</Button>
          </Link>
          <Button
            variant={detail.status === 'SUSPENDED' ? 'primary' : 'danger'}
            disabled={actionLoading}
            loading={actionLoading}
            onClick={() => setPendingAction(true)}
          >
            {detail.status === 'SUSPENDED' ? tr('platform.activateConfirm') : tr('platform.suspendConfirm')}
          </Button>
        </div>
      </div>

      {actionError && (
        <Banner variant="danger" title={tr('platform.actionFailed')} onDismiss={() => setActionError(null)} className="mt-5">
          {actionError}
        </Banner>
      )}

      <section className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label={tr('platform.teamMembers')} value={String(detail._count.memberships)} detail={tr('platform.teamMembersDetail')} tone="brand" />
        <SummaryCard label={tr('platform.branchesLabel')} value={String(detail._count.branches)} detail={tr('platform.branchesDetail')} tone="dark" />
        <SummaryCard
          label={tr('platform.featuresActive')}
          value={featuresEnabled === null ? '—' : tr('platform.ofTotal', { enabled: featuresEnabled, total: 9 })}
          detail={featuresEnabled === null ? tr('platform.unavailableNow') : tr('platform.enabledForRestaurant')}
          tone="brand"
        />
        <SummaryCard label={tr('platform.memberSince')} value={formatDateInZone(detail.createdAt, zone)} detail={tr('platform.timezoneLine', { zone })} tone="amber" />
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-2 xl:items-start">
        <div className="rounded-card border border-line bg-white shadow-card">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="text-sm font-black">{tr('platform.branchesLabel')}</h2>
            <span className="rounded-full bg-muted px-2 py-1 text-[10px] font-black uppercase tracking-wider text-ink-muted">
              {tr('platform.totalSuffix', { count: detail.branches.length })}
            </span>
          </div>
          {detail.branches.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="text-sm font-bold text-ink-muted">{tr('platform.noBranchesYet')}</p>
              <p className="mt-1 text-xs text-ink-muted">{tr('platform.noBranchesHint')}</p>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {detail.branches.map((branch) => (
                <li key={branch.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                  <span className={cn(
                    'grid size-10 shrink-0 place-items-center rounded-xl',
                    branch.isActive ? 'bg-brand/10 text-brand' : 'bg-muted text-ink-muted',
                  )}>
                    <MapPin size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-black">{branch.name}</p>
                      {!branch.isActive && (
                        <StatusChip status="idle">{tr('platform.inactiveBadge')}</StatusChip>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-ink-muted">
                      /{branch.slug}
                      {branch.publicSlug && (
                        <>
                          {' · '}{tr('platform.orderLinkLabel')} <span className="font-semibold text-brand">/r/{branch.publicSlug}</span>
                        </>
                      )}
                    </p>
                  </div>
                  <div className="shrink-0 text-end">
                    <StatusChip status={branch.isActive ? 'success' : 'idle'}>
                      {branch.isActive ? tr('platform.activeBadge') : tr('platform.offBadge')}
                    </StatusChip>
                    <p className="mt-1 text-[11px] text-ink-muted">{formatDateInZone(branch.createdAt, zone)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-card border border-line bg-white shadow-card">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="text-sm font-black">{tr('platform.teamMembers')}</h2>
            <span className="rounded-full bg-muted px-2 py-1 text-[10px] font-black uppercase tracking-wider text-ink-muted">
              {tr('platform.totalSuffix', { count: detail.memberships.length })}
            </span>
          </div>
          {detail.memberships.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="text-sm font-bold text-ink-muted">{tr('platform.noMembersYet')}</p>
              <p className="mt-1 text-xs text-ink-muted">{tr('platform.noMembersHint')}</p>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {detail.memberships.map((member, index) => {
                const contact = member.user.phoneE164 ?? member.user.email;
                return (
                  <li key={`${member.user.id}-${index}`} className="flex flex-wrap items-center gap-4 px-5 py-4">
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-dark text-xs font-black text-white">
                      {initials(member.user.displayName, contact ?? '?')}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-black">
                          {member.user.displayName ?? contact ?? tr('platform.unnamedMember')}
                        </p>
                        <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-brand">
                          {ROLE_KEYS[member.role] ? tr(ROLE_KEYS[member.role]) : roleLabel(member.role)}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-ink-muted">
                        {contact ?? tr('platform.noContact')} · {tr('platform.lastSignIn', { when: formatDateTimeInZone(member.user.lastLoginAt, zone) })}
                      </p>
                    </div>
                    <div className="shrink-0 text-end">
                      <StatusChip status={memberStatusVariant[member.status] ?? 'idle'}>
                        {labelFor(membershipStatusKeys, member.status, tr)}
                      </StatusChip>
                      <p className="mt-1 text-[11px] text-ink-muted">{tr('platform.joined', { date: formatDateInZone(member.createdAt, zone) })}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <ConfirmDialog
        open={pendingAction}
        onOpenChange={setPendingAction}
        title={tr(detail.status === 'SUSPENDED' ? 'platform.activateTitle' : 'platform.suspendTitle', { name: detail.name })}
        description={
          detail.status === 'SUSPENDED'
            ? tr('platform.activateDesc')
            : tr('platform.suspendDesc')
        }
        confirmLabel={detail.status === 'SUSPENDED' ? tr('platform.activateConfirm') : tr('platform.suspendConfirm')}
        variant={detail.status === 'SUSPENDED' ? 'primary' : 'danger'}
        onConfirm={() => void handleToggle()}
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

function DetailSkeleton() {
  return (
    <div className="page-shell animate-pulse">
      <Skeleton className="h-4 w-28 rounded-full" />
      <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="page-header">
          <Skeleton className="h-3 w-40 rounded-full" />
          <Skeleton className="h-9 w-72 rounded-xl" />
          <Skeleton className="h-4 w-96 max-w-full rounded-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-10 w-36 rounded-xl" />
          <Skeleton className="h-10 w-40 rounded-xl" />
        </div>
      </div>
      <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-card" />)}
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Skeleton className="h-72 rounded-card" />
        <Skeleton className="h-72 rounded-card" />
      </div>
    </div>
  );
}
