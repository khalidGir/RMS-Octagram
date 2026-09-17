'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { useBranch } from '@/components/shell/branch-provider';
import { formatEtbMinor } from '@/lib/money';
import { Skeleton } from '@/components/ui/skeleton';
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

const TONES = ['#B4532A', '#D39A3E', '#31584A', '#8E4A38', '#49362D'];

function timeGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function dayLabel(): string {
  return new Date().toLocaleDateString('en-ET', { weekday: 'long', day: 'numeric', month: 'long' });
}

function percentChange(today: number, yesterday: number): string {
  if (yesterday === 0) return today > 0 ? '+100%' : 'No change';
  const pct = ((today - yesterday) / yesterday) * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}% from yesterday`;
}

export function Dashboard() {
  const { accessToken, csrfToken, profile } = useAuth();
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
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [branchId, accessToken, csrfToken, tenantId]);

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

  const userName = profile?.displayName?.split(' ')[0] ?? 'there';

  if (loading) return <DashboardSkeleton />;

  if (error) {
    return (
      <div className="grid min-h-[55vh] place-items-center">
        <div className="max-w-sm rounded-panel border border-line bg-white p-8 text-center shadow-card">
          <p className="text-lg font-extrabold">Dashboard unavailable</p>
          <p className="mt-2 text-sm text-ink-muted">{error}</p>
          <button onClick={() => void fetchAll()} className="mt-5 min-h-11 rounded-control bg-brand px-5 font-bold text-white">Try again</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1500px]">
      <section className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-brand">{dayLabel()}</p>
          <h1 className="mt-2 text-3xl font-black tracking-[-0.045em] text-ink sm:text-4xl">{timeGreeting()}, {userName}.</h1>
          <p className="mt-2 text-sm text-ink-muted">Here is what is happening across your restaurant today.</p>
        </div>
        {branches.length > 1 && (
          <div className="flex items-center gap-3 rounded-card border border-line bg-white px-4 py-3 shadow-card text-sm">
            <span className="text-xs font-black uppercase tracking-wider text-ink-muted">Branch</span>
            <span className="font-extrabold">{branches.find((b) => b.id === branchId)?.name ?? '—'}</span>
          </div>
        )}
      </section>

      <section className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Today's metrics">
        <MetricCard label="Today's revenue" value={formatEtbMinor(todayRevenue)} detail={percentChange(todayRevenue, yesterdayRevenue)} direction={todayRevenue >= yesterdayRevenue ? 'up' : 'attention'} icon="↗" />
        <MetricCard label="Orders today" value={String(todayOrderCount)} detail={`${orderStats?.completedOrders ?? 0} completed`} direction="neutral" icon="◇" />
        <MetricCard label="Avg. order value" value={orderStats ? formatEtbMinor(Number(orderStats.avgOrderMinor)) : '—'} detail={`${orderStats?.cancelledOrders ?? 0} cancelled`} direction="neutral" icon="◷" />
        <MetricCard label="Low stock alerts" value={String(pendingReviews)} detail={pendingReviews > 0 ? 'Items running low' : 'All stocked'} direction={pendingReviews > 0 ? 'attention' : 'neutral'} icon="◉" />
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-[1.7fr_1fr]">
        <article className="overflow-hidden rounded-panel border border-line bg-white shadow-card">
          <div className="flex items-center justify-between border-b border-line px-5 py-5 sm:px-6">
            <div>
              <h2 className="text-lg font-black">Revenue trend</h2>
              <p className="mt-1 text-xs text-ink-muted">Last 2 days comparison</p>
            </div>
            <Link href="/reports" className="min-h-10 rounded-control border border-line px-4 text-xs font-extrabold hover:bg-muted">Full report</Link>
          </div>
          <div className="p-5 sm:p-6">
            {revenue.length === 0 ? (
              <p className="text-sm text-ink-muted">No revenue data for the selected period.</p>
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
                    <span className="w-24 text-right text-sm font-black">{formatEtbMinor(Number(day.revenueMinor))}</span>
                    <span className="w-16 text-right text-xs text-ink-muted">{day.orderCount} orders</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </article>

        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-1">
          <Link href="/kitchen" className="rounded-panel bg-dark p-6 text-white shadow-float block hover:opacity-95 transition-opacity">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-white/50">Quick action</p>
                <h2 className="mt-1 text-xl font-black">Kitchen display</h2>
              </div>
              <span className="grid size-11 place-items-center rounded-xl bg-white/10 text-xl">⏱</span>
            </div>
            <p className="mt-4 text-sm text-white/70">View live kitchen queue and bump tickets.</p>
            <div className="mt-6 min-h-11 w-full rounded-control bg-white text-center text-sm font-black text-dark leading-[2.75rem]">Open kitchen display</div>
          </Link>

          <article className="rounded-panel border border-line bg-white p-6 shadow-card">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-black">Popular today</h2>
              <Link href="/reports" className="text-xs font-black text-brand">Full report</Link>
            </div>
            <div className="mt-5 space-y-4">
              {bestSellers.length === 0 ? (
                <p className="text-sm text-ink-muted">No sales data yet today.</p>
              ) : (
                bestSellers.map((item, index) => (
                  <div key={item.variantId} className="flex items-center gap-3">
                    <span className="grid size-9 place-items-center rounded-xl text-xs font-black text-white" style={{ backgroundColor: TONES[index % TONES.length] }}>{index + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-extrabold">{item.itemName}</span>
                      <span className="text-xs text-ink-muted">{item.totalQuantity} sold</span>
                    </span>
                    <span className="text-xs font-black">{formatEtbMinor(Number(item.totalRevenueMinor))}</span>
                  </div>
                ))
              )}
            </div>
          </article>
        </div>
      </section>

      <section className="mt-5 grid gap-3 sm:grid-cols-3">
        <Link href="/pos" className="flex min-h-20 items-center gap-4 rounded-card border border-line bg-white px-5 text-left shadow-card hover:-translate-y-0.5 transition-transform">
          <span className="grid size-11 place-items-center rounded-xl bg-brand text-xl text-white">+</span>
          <span>
            <span className="block text-sm font-black">Start POS order</span>
            <span className="mt-1 block text-xs text-ink-muted">Create a counter or table order</span>
          </span>
        </Link>
        <Link href="/payments" className="flex min-h-20 items-center gap-4 rounded-card border border-line bg-white px-5 text-left shadow-card hover:-translate-y-0.5 transition-transform">
          <span className="grid size-11 place-items-center rounded-xl bg-amber-100 text-xl text-amber-800">◎</span>
          <span>
            <span className="block text-sm font-black">Review payments</span>
            <span className="mt-1 block text-xs text-ink-muted">Transfers awaiting confirmation</span>
          </span>
        </Link>
        <Link href="/inventory" className="flex min-h-20 items-center gap-4 rounded-card border border-line bg-white px-5 text-left shadow-card hover:-translate-y-0.5 transition-transform">
          <span className="grid size-11 place-items-center rounded-xl bg-emerald-100 text-xl text-emerald-800">▤</span>
          <span>
            <span className="block text-sm font-black">Check inventory</span>
            <span className="mt-1 block text-xs text-ink-muted">{pendingReviews} items are running low</span>
          </span>
        </Link>
      </section>
    </div>
  );
}

function MetricCard({ label, value, detail, direction, icon }: { label: string; value: string; detail: string; direction: 'up' | 'neutral' | 'attention'; icon: string }) {
  return (
    <article className="relative overflow-hidden rounded-card border border-line bg-white p-5 shadow-card">
      <div className={`absolute inset-y-0 left-0 w-1 ${direction === 'attention' ? 'bg-amber-500' : direction === 'up' ? 'bg-accent-teal' : 'bg-brand'}`} />
      <div className="flex items-start justify-between">
        <p className="text-sm font-bold text-ink-muted">{label}</p>
        <span className="text-lg text-ink-muted/50">{icon}</span>
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
