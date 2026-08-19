'use client';

import { useQuery } from '@tanstack/react-query';
import { formatEtb, mockDashboardApi } from '@/lib/mock-api';
import type { OrderStatus } from '@/lib/types';

const statusStyles: Record<OrderStatus, string> = {
  PENDING_VERIFICATION: 'bg-amber-50 text-amber-800 ring-amber-600/15',
  CONFIRMED: 'bg-blue-50 text-blue-700 ring-blue-600/15',
  IN_PROGRESS: 'bg-violet-50 text-violet-700 ring-violet-600/15',
  READY: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15',
};

const statusLabels: Record<OrderStatus, string> = { PENDING_VERIFICATION: 'Verify payment', CONFIRMED: 'Confirmed', IN_PROGRESS: 'In kitchen', READY: 'Ready' };

export function Dashboard() {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['dashboard'], queryFn: () => mockDashboardApi.getDashboard() });
  if (isLoading) return <DashboardSkeleton />;
  if (isError || !data) return <div className="grid min-h-[55vh] place-items-center"><div className="max-w-sm rounded-panel border border-line bg-white p-8 text-center shadow-card"><p className="text-lg font-extrabold">Dashboard unavailable</p><p className="mt-2 text-sm text-ink-muted">We could not load your branch summary.</p><button onClick={() => void refetch()} className="mt-5 min-h-11 rounded-control bg-brand px-5 font-bold text-white">Try again</button></div></div>;

  return (
    <div className="mx-auto max-w-[1500px]">
      <section className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div><p className="text-xs font-black uppercase tracking-[0.2em] text-brand">Tuesday, 19 August</p><h1 className="mt-2 text-3xl font-black tracking-[-0.045em] text-ink sm:text-4xl">Good morning, Abebe.</h1><p className="mt-2 text-sm text-ink-muted">Here is what is happening across your restaurant today.</p></div>
        <label className="flex min-w-60 items-center gap-3 rounded-card border border-line bg-white px-4 py-3 shadow-card"><span className="grid size-9 place-items-center rounded-lg bg-brand/10 text-brand">⌖</span><span className="min-w-0 flex-1"><span className="block text-[10px] font-black uppercase tracking-wider text-ink-muted">Viewing branch</span><select className="w-full cursor-pointer appearance-none bg-transparent text-sm font-extrabold outline-none" defaultValue={data.activeBranchId}>{data.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name} · {branch.location}</option>)}</select></span><span aria-hidden>⌄</span></label>
      </section>

      <section className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Today's metrics">
        {data.metrics.map((metric, index) => <article key={metric.label} className="relative overflow-hidden rounded-card border border-line bg-white p-5 shadow-card"><div className={`absolute inset-y-0 left-0 w-1 ${metric.direction === 'attention' ? 'bg-amber-500' : index === 1 ? 'bg-[#31584a]' : 'bg-brand'}`} /><div className="flex items-start justify-between"><p className="text-sm font-bold text-ink-muted">{metric.label}</p><span className="text-lg text-ink-muted/50">{index === 0 ? '↗' : index === 1 ? '◇' : index === 2 ? '◷' : '◉'}</span></div><p className="mt-4 text-2xl font-black tracking-[-0.035em]">{metric.value}</p><p className={`mt-2 text-xs font-semibold ${metric.direction === 'attention' ? 'text-amber-700' : metric.direction === 'up' ? 'text-emerald-700' : 'text-ink-muted'}`}>{metric.direction === 'up' ? '↑ ' : ''}{metric.detail}</p></article>)}
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-[1.7fr_1fr]">
        <article className="overflow-hidden rounded-panel border border-line bg-white shadow-card">
          <div className="flex items-center justify-between border-b border-line px-5 py-5 sm:px-6"><div><h2 className="text-lg font-black">Live orders</h2><p className="mt-1 text-xs text-ink-muted">Latest activity from every channel</p></div><button className="min-h-10 rounded-control border border-line px-4 text-xs font-extrabold hover:bg-muted">View all orders</button></div>
          <div className="divide-y divide-line">
            {data.recentOrders.map((order) => <div key={order.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-5 py-4 hover:bg-muted/40 sm:grid-cols-[auto_1.25fr_.8fr_.8fr_auto] sm:px-6"><span className="grid size-10 place-items-center rounded-xl bg-muted text-xs font-black text-ink">{order.number.slice(-2)}</span><div><p className="text-sm font-extrabold">{order.number} <span className="ml-1 font-medium text-ink-muted">{order.customer}</span></p><p className="mt-1 text-xs text-ink-muted">{order.type} · {order.itemCount} items</p></div><p className="hidden text-sm font-black sm:block">{formatEtb(order.amountMinor)}</p><span className={`hidden w-fit rounded-full px-2.5 py-1.5 text-[10px] font-black ring-1 ring-inset sm:inline-flex ${statusStyles[order.status]}`}>{statusLabels[order.status]}</span><div className="text-right"><p className="text-xs font-semibold text-ink-muted">{order.time}</p><span className={`mt-1 inline-flex rounded-full px-2 py-1 text-[9px] font-black ring-1 ring-inset sm:hidden ${statusStyles[order.status]}`}>{statusLabels[order.status]}</span></div></div>)}
          </div>
        </article>

        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-1">
          <article className="rounded-panel bg-[#18241f] p-6 text-white shadow-float"><div className="flex items-center justify-between"><div><p className="text-xs font-bold text-white/50">Kitchen pulse</p><h2 className="mt-1 text-xl font-black">8 orders cooking</h2></div><span className="grid size-11 place-items-center rounded-xl bg-white/10 text-xl">◷</span></div><div className="mt-6 grid grid-cols-3 gap-2"><div><p className="text-2xl font-black">6</p><p className="text-[10px] font-bold text-white/45">Queued</p></div><div><p className="text-2xl font-black text-amber-300">8</p><p className="text-[10px] font-bold text-white/45">Cooking</p></div><div><p className="text-2xl font-black text-emerald-300">3</p><p className="text-[10px] font-bold text-white/45">Ready</p></div></div><button className="mt-6 min-h-11 w-full rounded-control bg-white text-sm font-black text-[#18241f]">Open kitchen display</button></article>
          <article className="rounded-panel border border-line bg-white p-6 shadow-card"><div className="flex items-center justify-between"><h2 className="text-lg font-black">Popular today</h2><button className="text-xs font-black text-brand">Full report</button></div><div className="mt-5 space-y-4">{data.popularItems.map((item, index) => <div key={item.id} className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl text-xs font-black text-white" style={{ backgroundColor: item.color }}>{index + 1}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-extrabold">{item.name}</span><span className="text-xs text-ink-muted">{item.sold} sold · {item.category}</span></span><span className="text-xs font-black">{formatEtb(item.revenueMinor)}</span></div>)}</div></article>
        </div>
      </section>

      <section className="mt-5 grid gap-3 sm:grid-cols-3"><button className="flex min-h-20 items-center gap-4 rounded-card border border-line bg-white px-5 text-left shadow-card hover:-translate-y-0.5"><span className="grid size-11 place-items-center rounded-xl bg-brand text-xl text-white">＋</span><span><span className="block text-sm font-black">Start POS order</span><span className="mt-1 block text-xs text-ink-muted">Create a counter or table order</span></span></button><button className="flex min-h-20 items-center gap-4 rounded-card border border-line bg-white px-5 text-left shadow-card hover:-translate-y-0.5"><span className="grid size-11 place-items-center rounded-xl bg-amber-100 text-xl text-amber-800">◎</span><span><span className="block text-sm font-black">Review payments</span><span className="mt-1 block text-xs text-ink-muted">5 transfers need confirmation</span></span></button><button className="flex min-h-20 items-center gap-4 rounded-card border border-line bg-white px-5 text-left shadow-card hover:-translate-y-0.5"><span className="grid size-11 place-items-center rounded-xl bg-emerald-100 text-xl text-emerald-800">▤</span><span><span className="block text-sm font-black">Check inventory</span><span className="mt-1 block text-xs text-ink-muted">3 items are running low</span></span></button></section>
    </div>
  );
}

function DashboardSkeleton() { return <div className="mx-auto max-w-[1500px] animate-pulse"><div className="h-10 w-72 rounded-xl bg-black/10" /><div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-36 rounded-card bg-white/80" />)}</div><div className="mt-5 h-96 rounded-panel bg-white/80" /></div>; }
