'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { useBranch } from '@/components/shell/branch-provider';
import { formatEtbMinor } from '@/lib/money';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import {
  fetchRevenueByDay,
  fetchOrdersReport,
  fetchBestSellers,
  fetchRevenueByMethod,
  fetchPeakHours,
  fetchInventoryConsumption,
  today,
  daysAgo,
  type RevenueDay,
  type OrderStats,
  type BestSellerItem,
  type RevenueByMethod,
  type PeakHour,
  type InventoryConsumptionItem,
} from '@/lib/dashboard-api';

type Period = 'today' | '7d' | '30d' | 'custom';

function periodDates(p: Period, customFrom: string, customTo: string): { fromLocalDate: string; toLocalDate: string } {
  switch (p) {
    case 'today': return { fromLocalDate: today(), toLocalDate: today() };
    case '7d': return { fromLocalDate: daysAgo(7), toLocalDate: today() };
    case '30d': return { fromLocalDate: daysAgo(30), toLocalDate: today() };
    case 'custom': return { fromLocalDate: customFrom || daysAgo(7), toLocalDate: customTo || today() };
  }
}

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'custom', label: 'Custom' },
];

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Cash',
  BANK_TRANSFER: 'Bank transfer',
  TELEBIRR: 'Telebirr',
  MPESA: 'M-PESA',
  CBE_BIRR: 'CBE Birr',
};

const TONES = ['#B4532A', '#D39A3E', '#31584A', '#8E4A38', '#49362D'];

export function ReportsPage() {
  const { accessToken, csrfToken, profile } = useAuth();
  const { branchId } = useBranch();
  const tenantId = profile?.memberships?.[0]?.tenant.id;

  const [period, setPeriod] = useState<Period>('7d');
  const [customFrom, setCustomFrom] = useState(daysAgo(7));
  const [customTo, setCustomTo] = useState(today());

  const [revenue, setRevenue] = useState<RevenueDay[]>([]);
  const [orderStats, setOrderStats] = useState<OrderStats | null>(null);
  const [bestSellers, setBestSellers] = useState<BestSellerItem[]>([]);
  const [methods, setMethods] = useState<RevenueByMethod[]>([]);
  const [peakHours, setPeakHours] = useState<PeakHour[]>([]);
  const [consumption, setConsumption] = useState<InventoryConsumptionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const dates = useMemo(() => periodDates(period, customFrom, customTo), [period, customFrom, customTo]);

  const fetchAll = useCallback(async () => {
    if (!branchId || !accessToken || !tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const params = { branchId, ...dates };
      const [revRes, ordersRes, bestRes, methodRes, peakRes, consRes] = await Promise.all([
        fetchRevenueByDay(params, accessToken, csrfToken, tenantId),
        fetchOrdersReport(params, accessToken, csrfToken, tenantId),
        fetchBestSellers({ ...params, limit: 10 }, accessToken, csrfToken, tenantId),
        fetchRevenueByMethod(params, accessToken, csrfToken, tenantId),
        fetchPeakHours(params, accessToken, csrfToken, tenantId),
        fetchInventoryConsumption(params, accessToken, csrfToken, tenantId),
      ]);
      setRevenue(revRes.days);
      setOrderStats(ordersRes.stats);
      setBestSellers(bestRes.items);
      setMethods(methodRes.methods);
      setPeakHours(peakRes.hours);
      setConsumption(consRes.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reports');
    } finally {
      setLoading(false);
    }
  }, [branchId, accessToken, csrfToken, tenantId, dates]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const maxRevenue = useMemo(() => Math.max(1, ...revenue.map((d) => Number(d.revenueMinor))), [revenue]);
  const maxHourOrders = useMemo(() => Math.max(1, ...peakHours.map((h) => h.orderCount)), [peakHours]);
  const totalRevenue = useMemo(() => revenue.reduce((sum, d) => sum + Number(d.revenueMinor), 0), [revenue]);

  if (loading) return <ReportsSkeleton />;

  if (error) {
    return (
      <div className="grid min-h-[55vh] place-items-center">
        <div className="max-w-sm rounded-panel border border-line bg-white p-8 text-center shadow-card">
          <p className="text-lg font-extrabold">Reports unavailable</p>
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
          <p className="text-xs font-black uppercase tracking-[0.18em] text-brand">Analytics</p>
          <h1 className="mt-2 text-3xl font-black tracking-[-0.045em] sm:text-4xl">Reports</h1>
          <p className="mt-2 text-sm text-ink-muted">Branch performance for {dates.fromLocalDate} to {dates.toLocalDate}.</p>
        </div>
        <Button variant="secondary" disabled>Export report</Button>
      </header>

      <div className="mt-5 flex flex-wrap gap-2">
        {PERIOD_OPTIONS.map((opt) => (
          <button key={opt.value} onClick={() => setPeriod(opt.value)} className={cn('min-h-10 rounded-full px-4 text-xs font-black', period === opt.value ? 'bg-dark text-white' : 'bg-white text-ink-muted hover:text-ink')}>{opt.label}</button>
        ))}
        {period === 'custom' && (
          <div className="flex items-center gap-2">
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="min-h-10 rounded-control border border-line bg-white px-3 text-xs font-bold" />
            <span className="text-xs text-ink-muted">to</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="min-h-10 rounded-control border border-line bg-white px-3 text-xs font-bold" />
          </div>
        )}
      </div>

      <section className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Summary metrics">
        <SummaryCard label="Total revenue" value={formatEtbMinor(totalRevenue)} detail={`${revenue.length} days`} />
        <SummaryCard label="Total orders" value={String(orderStats?.totalOrders ?? 0)} detail={`${orderStats?.completedOrders ?? 0} completed`} />
        <SummaryCard label="Avg. order value" value={orderStats ? formatEtbMinor(Number(orderStats.avgOrderMinor)) : '—'} detail={`${orderStats?.cancelledOrders ?? 0} cancelled`} />
        <SummaryCard label="Payment methods" value={String(methods.length)} detail="Active methods" />
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <article className="rounded-panel border border-line bg-white p-5 shadow-card sm:p-6">
          <h2 className="text-lg font-black">Revenue by day</h2>
          <div className="mt-5 space-y-2">
            {revenue.length === 0 ? (
              <p className="text-sm text-ink-muted">No revenue data for this period.</p>
            ) : (
              revenue.map((day) => (
                <div key={day.date} className="flex items-center gap-3">
                  <span className="w-20 shrink-0 text-xs font-bold text-ink-muted">{day.date.slice(5)}</span>
                  <div className="flex-1">
                    <div className="h-6 rounded-lg bg-muted overflow-hidden">
                      <div className="h-full rounded-lg bg-brand transition-all" style={{ width: `${(Number(day.revenueMinor) / maxRevenue) * 100}%` }} />
                    </div>
                  </div>
                  <span className="w-24 shrink-0 text-right text-sm font-black">{formatEtbMinor(Number(day.revenueMinor))}</span>
                  <span className="w-12 shrink-0 text-right text-xs text-ink-muted">{day.orderCount}</span>
                </div>
              ))
            )}
          </div>
        </article>

        <article className="rounded-panel border border-line bg-white p-5 shadow-card sm:p-6">
          <h2 className="text-lg font-black">Revenue by method</h2>
          <div className="mt-5 space-y-3">
            {methods.length === 0 ? (
              <p className="text-sm text-ink-muted">No payment data for this period.</p>
            ) : (
              methods.map((m, i) => (
                <div key={m.method} className="flex items-center gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg text-xs font-black text-white" style={{ backgroundColor: TONES[i % TONES.length] }}>{m.method[0]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-extrabold">{PAYMENT_METHOD_LABELS[m.method] ?? m.method}</span>
                    <span className="text-xs text-ink-muted">{m.paymentCount} payments</span>
                  </span>
                  <span className="text-sm font-black">{formatEtbMinor(Number(m.totalMinor))}</span>
                </div>
              ))
            )}
          </div>
        </article>
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-2">
        <article className="rounded-panel border border-line bg-white p-5 shadow-card sm:p-6">
          <h2 className="text-lg font-black">Peak hours</h2>
          <p className="mt-1 text-xs text-ink-muted">Order volume by hour of day</p>
          <div className="mt-5 flex items-end gap-1 h-40">
            {peakHours.map((h) => (
              <div key={h.hour} className="flex-1 flex flex-col items-center justify-end h-full" title={`${h.hour}:00 — ${h.orderCount} orders`}>
                <div className="w-full rounded-t bg-brand transition-all" style={{ height: `${(h.orderCount / maxHourOrders) * 100}%`, minHeight: h.orderCount > 0 ? 2 : 0 }} />
                <span className="mt-1 text-[9px] text-ink-muted">{h.hour}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-panel border border-line bg-white p-5 shadow-card sm:p-6">
          <h2 className="text-lg font-black">Best sellers</h2>
          <div className="mt-5 space-y-3">
            {bestSellers.length === 0 ? (
              <p className="text-sm text-ink-muted">No sales data for this period.</p>
            ) : (
              bestSellers.slice(0, 8).map((item, index) => (
                <div key={item.variantId} className="flex items-center gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg text-xs font-black text-white" style={{ backgroundColor: TONES[index % TONES.length] }}>{index + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-extrabold">{item.itemName}</span>
                    <span className="text-xs text-ink-muted">{item.totalQuantity} sold · {item.orderCount} orders</span>
                  </span>
                  <span className="text-xs font-black">{formatEtbMinor(Number(item.totalRevenueMinor))}</span>
                </div>
              ))
            )}
          </div>
        </article>
      </section>

      {consumption.length > 0 && (
        <section className="mt-5">
          <article className="rounded-panel border border-line bg-white p-5 shadow-card sm:p-6">
            <h2 className="text-lg font-black">Inventory consumption</h2>
            <p className="mt-1 text-xs text-ink-muted">Stock movement breakdown by item</p>
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[500px] text-left">
                <thead><tr className="border-b border-line text-xs uppercase tracking-wider text-ink-muted">
                  <th className="pb-3">Item</th>
                  <th className="pb-3">Movement type</th>
                  <th className="pb-3 text-right">Quantity</th>
                  <th className="pb-3 text-right">Count</th>
                </tr></thead>
                <tbody>
                  {consumption.map((c, i) => (
                    <tr key={`${c.inventoryItemId}-${c.movementType}-${i}`} className="border-b border-line last:border-0 text-sm">
                      <td className="py-3 font-black">{c.itemName}</td>
                      <td className="py-3"><span className="rounded-full bg-muted px-2 py-1 text-[10px] font-black">{c.movementType}</span></td>
                      <td className="py-3 text-right font-black">{c.totalQuantity}</td>
                      <td className="py-3 text-right text-ink-muted">{c.movementCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </section>
      )}
    </div>
  );
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="rounded-card border border-line bg-white p-5 shadow-card">
      <p className="text-xs font-black text-ink-muted">{label}</p>
      <p className="mt-3 text-2xl font-black tracking-[-0.04em]">{value}</p>
      <p className="mt-1 text-xs text-ink-muted">{detail}</p>
    </article>
  );
}

function ReportsSkeleton() {
  return (
    <div className="mx-auto max-w-[1500px] animate-pulse">
      <Skeleton className="h-10 w-48 rounded-xl" />
      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-card" />)}
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Skeleton className="h-80 rounded-panel" />
        <Skeleton className="h-80 rounded-panel" />
      </div>
    </div>
  );
}
