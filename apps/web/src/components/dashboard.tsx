'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { useBranch } from '@/components/shell/branch-provider';
import { useLocale, type MessageKey } from '@/components/locale-provider';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, ArrowUpRight, BarChart3, Boxes, ChefHat, CreditCard, Plus, ReceiptText } from 'lucide-react';
import { Card, PageHeader } from '@/components/ui';
import type { ReactNode } from 'react';
import {
  fetchRevenueByDay,
  fetchOrdersReport,
  fetchBestSellers,
  fetchLowStock,
  today,
  daysAgo,
  type OrderStats,
  type BestSellerItem,
  type LowStockItem,
  type RevenueDay,
} from '@/lib/dashboard-api';

const RANK_TONES = ['bg-brand', 'bg-success', 'bg-warning', 'bg-info', 'bg-dark-muted'];

type Tr = (key: MessageKey, variables?: Record<string, string | number>) => string;

function percentChange(today: number, yesterday: number, tr: Tr): string {
  if (yesterday === 0) return today > 0 ? '+100%' : tr('dashboard.noChange');
  const pct = ((today - yesterday) / yesterday) * 100;
  const sign = pct >= 0 ? '+' : '';
  return tr('dashboard.pctVsYesterday', { pct: `${sign}${pct.toFixed(1)}` });
}

export function Dashboard() {
  const { accessToken, csrfToken, profile } = useAuth();
  const { formatCurrency, tr, formatDate } = useLocale();
  const { branchId, branches } = useBranch();
  const tenantId = profile?.memberships?.[0]?.tenant.id;

  const [revenue, setRevenue] = useState<RevenueDay[]>([]);
  const [orderStats, setOrderStats] = useState<OrderStats | null>(null);
  const [bestSellers, setBestSellers] = useState<BestSellerItem[]>([]);
  const [lowStock, setLowStock] = useState<LowStockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!branchId || !accessToken || !tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const params = { branchId, fromLocalDate: daysAgo(1), toLocalDate: today() };
      const [revRes, ordersRes, bestRes, lowRes] = await Promise.all([
        fetchRevenueByDay(params, accessToken, csrfToken, tenantId),
        fetchOrdersReport(params, accessToken, csrfToken, tenantId),
        fetchBestSellers({ ...params, limit: 5 }, accessToken, csrfToken, tenantId),
        fetchLowStock(branchId, accessToken, csrfToken, tenantId),
      ]);
      setRevenue(revRes.days);
      setOrderStats(ordersRes.stats);
      setBestSellers(bestRes.items);
      setLowStock(lowRes.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('dashboard.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [branchId, accessToken, csrfToken, tenantId, tr]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const todayRevenue = useMemo(() => {
    const t = today();
    const day = revenue.find((d) => d.date === t);
    return day ? Number(day.revenueMinor) : 0;
  }, [revenue]);

  const yesterdayRevenue = useMemo(() => {
    const y = daysAgo(1);
    const day = revenue.find((d) => d.date === y);
    return day ? Number(day.revenueMinor) : 0;
  }, [revenue]);

  const todayOrderCount = orderStats?.totalOrders ?? 0;
  const pendingReviews = lowStock.length;

  const userName = profile?.displayName?.split(' ')[0] ?? tr('dashboard.nameFallback');
  const hour = new Date().getHours();
  const titleKey: MessageKey =
    hour < 12 ? 'dashboard.greetingMorning' : hour < 17 ? 'dashboard.greetingAfternoon' : 'dashboard.greetingEvening';

  if (loading) return <DashboardSkeleton />;

  if (error) {
    return (
      <div className="grid min-h-[55vh] place-items-center">
        <div className="max-w-sm rounded-panel border border-line bg-white p-8 text-center shadow-card">
          <p className="text-lg font-extrabold">{tr('dashboard.unavailable')}</p>
          <p className="mt-2 text-sm text-ink-muted">{error}</p>
          <button onClick={() => void fetchAll()} className="mt-5 min-h-11 rounded-control bg-brand px-5 font-bold text-white">{tr('common.tryAgain')}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <PageHeader eyebrow={formatDate(new Date(), { weekday: 'long', day: 'numeric', month: 'long' })} title={tr(titleKey, { name: userName })} description={tr('dashboard.description')} actions={branches.length > 1 ? (
          <div className="flex items-center gap-3 rounded-card border border-line bg-white px-4 py-3 shadow-card text-sm">
            <span className="text-xs font-semibold text-ink-muted">{tr('dashboard.viewing')}</span>
            <span className="font-semibold">{branches.find((b) => b.id === branchId)?.name ?? '—'}</span>
          </div>
        ) : undefined} />

      <section className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={tr('dashboard.metricsRegion')}>
        <MetricCard label={tr('dashboard.metricRevenue')} value={formatCurrency(todayRevenue)} detail={percentChange(todayRevenue, yesterdayRevenue, tr)} direction={todayRevenue >= yesterdayRevenue ? 'up' : 'attention'} icon={<ArrowUpRight />} />
        <MetricCard label={tr('dashboard.metricOrders')} value={String(todayOrderCount)} detail={tr('dashboard.completedSuffix', { count: orderStats?.completedOrders ?? 0 })} direction="neutral" icon={<ReceiptText />} />
        <MetricCard label={tr('dashboard.metricAvgValue')} value={orderStats ? formatCurrency(Number(orderStats.avgOrderMinor)) : '—'} detail={tr('dashboard.cancelledSuffix', { count: orderStats?.cancelledOrders ?? 0 })} direction="neutral" icon={<BarChart3 />} />
        <MetricCard label={tr('dashboard.metricLowStock')} value={String(pendingReviews)} detail={pendingReviews > 0 ? tr('status.stockItemsRunningLow') : tr('status.stockAllStocked')} direction={pendingReviews > 0 ? 'attention' : 'neutral'} icon={<AlertTriangle />} />
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-[1.7fr_1fr]">
        <Card className="overflow-hidden rounded-panel">
          <div className="flex items-center justify-between border-b border-line px-5 py-5 sm:px-6">
            <div>
              <h2 className="text-lg font-black">{tr('dashboard.revenueTrend')}</h2>
              <p className="mt-1 text-xs text-ink-muted">{tr('dashboard.last2Days')}</p>
            </div>
            <Link href="/reports" className="min-h-10 rounded-control border border-line px-4 text-xs font-extrabold hover:bg-muted">{tr('dashboard.fullReport')}</Link>
          </div>
          <div className="p-5 sm:p-6">
            {revenue.length === 0 ? (
              <p className="text-sm text-ink-muted">{tr('dashboard.noRevenue')}</p>
            ) : (
              <div className="space-y-3">
                {revenue.map((day) => (
                  <div key={day.date} className="flex items-center gap-4">
                    <span className="w-20 text-xs font-bold text-ink-muted">{day.date.slice(5)}</span>
                    <div className="flex-1">
                      <div className="h-6 rounded-lg bg-muted overflow-hidden">
                        <div className="h-full rounded-lg bg-brand transition-all" style={{ width: `${Math.min(100, (Number(day.revenueMinor) / Math.max(1, yesterdayRevenue || 1)) * 100)}%` }} />
                      </div>
                    </div>
                    <span className="w-24 text-end text-sm font-black">{formatCurrency(Number(day.revenueMinor))}</span>
                    <span className="w-16 text-end text-xs text-ink-muted">{tr('dashboard.ordersCount', { count: day.orderCount })}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-1">
          <Link href="/kitchen" className="rounded-panel bg-dark p-6 text-white shadow-float block hover:opacity-95 transition-opacity">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-white/50">{tr('dashboard.quickAction')}</p>
                <h2 className="mt-1 text-xl font-black">{tr('navigation.navKitchenDisplay')}</h2>
              </div>
              <span className="grid size-11 place-items-center rounded-xl bg-white/10"><ChefHat size={21} aria-hidden="true" /></span>
            </div>
            <p className="mt-4 text-sm text-white/70">{tr('dashboard.kitchenPitch')}</p>
            <div className="mt-6 min-h-11 w-full rounded-control bg-white text-center text-sm font-black text-dark leading-[2.75rem]">{tr('dashboard.openKitchen')}</div>
          </Link>

          <article className="rounded-panel border border-line bg-white p-6 shadow-card">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-black">{tr('dashboard.popularToday')}</h2>
              <Link href="/reports" className="text-xs font-black text-brand">{tr('dashboard.fullReport')}</Link>
            </div>
            <div className="mt-5 space-y-4">
              {bestSellers.length === 0 ? (
                <p className="text-sm text-ink-muted">{tr('dashboard.noSalesYet')}</p>
              ) : (
                bestSellers.map((item, index) => (
                  <div key={item.variantId} className="flex items-center gap-3">
                    <span className={`grid size-9 place-items-center rounded-xl text-xs font-semibold text-white ${RANK_TONES[index % RANK_TONES.length]}`}>{index + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-extrabold">{item.itemName}</span>
                      <span className="text-xs text-ink-muted">{tr('dashboard.soldSuffix', { count: item.totalQuantity })}</span>
                    </span>
                    <span className="text-xs font-black">{formatCurrency(Number(item.totalRevenueMinor))}</span>
                  </div>
                ))
              )}
            </div>
          </article>
        </div>
      </section>

      <section className="mt-5 grid gap-3 sm:grid-cols-3">
        <Link href="/pos" className="flex min-h-20 items-center gap-4 rounded-card border border-line bg-white px-5 text-start shadow-card hover:-translate-y-0.5 transition-transform">
          <span className="grid size-11 place-items-center rounded-xl bg-brand text-white"><Plus size={20} aria-hidden="true" /></span>
          <span>
            <span className="block text-sm font-black">{tr('dashboard.startPos')}</span>
            <span className="mt-1 block text-xs text-ink-muted">{tr('dashboard.startPosHint')}</span>
          </span>
        </Link>
        <Link href="/payments" className="flex min-h-20 items-center gap-4 rounded-card border border-line bg-white px-5 text-start shadow-card hover:-translate-y-0.5 transition-transform">
          <span className="grid size-11 place-items-center rounded-xl bg-warning-surface text-warning"><CreditCard size={20} aria-hidden="true" /></span>
          <span>
            <span className="block text-sm font-black">{tr('dashboard.reviewPayments')}</span>
            <span className="mt-1 block text-xs text-ink-muted">{tr('dashboard.paymentsHint')}</span>
          </span>
        </Link>
        <Link href="/inventory" className="flex min-h-20 items-center gap-4 rounded-card border border-line bg-white px-5 text-start shadow-card hover:-translate-y-0.5 transition-transform">
          <span className="grid size-11 place-items-center rounded-xl bg-success-surface text-success"><Boxes size={20} aria-hidden="true" /></span>
          <span>
            <span className="block text-sm font-black">{tr('dashboard.checkInventory')}</span>
            <span className="mt-1 block text-xs text-ink-muted">{tr('dashboard.itemsRunningLow', { count: pendingReviews })}</span>
          </span>
        </Link>
      </section>
    </div>
  );
}

function MetricCard({ label, value, detail, direction, icon }: { label: string; value: string; detail: string; direction: 'up' | 'neutral' | 'attention'; icon: ReactNode }) {
  return (
    <article className="relative overflow-hidden rounded-card border border-line bg-white p-5 shadow-card">
      <div className={`absolute inset-y-0 start-0 w-1 ${direction === 'attention' ? 'bg-amber-500' : direction === 'up' ? 'bg-accent-teal' : 'bg-brand'}`} />
      <div className="flex items-start justify-between">
        <p className="text-sm font-bold text-ink-muted">{label}</p>
        <span className="text-ink-muted/60 [&>svg]:size-4">{icon}</span>
      </div>
      <p className="mt-4 text-2xl font-black tracking-[-0.035em]">{value}</p>
      <p className={`mt-2 text-xs font-semibold ${direction === 'attention' ? 'text-amber-700' : direction === 'up' ? 'text-emerald-700' : 'text-ink-muted'}`}>
        {direction === 'up' ? '↑ ' : ''}{detail}
      </p>
    </article>
  );
}

function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-[1500px] animate-pulse">
      <Skeleton className="h-10 w-72 rounded-xl" />
      <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-card" />)}
      </div>
      <div className="mt-5 h-96 rounded-panel bg-white/80" />
    </div>
  );
}
