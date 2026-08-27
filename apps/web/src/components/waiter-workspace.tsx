'use client';

import { useQuery } from '@tanstack/react-query';
import { apiRequest, type ApiEnvelope, ApiError } from '@/lib/api-client';
import { useAuth } from './auth-provider';

interface TableOperation {
  tableId: string;
  label: string;
  capacity: number;
  isActive: boolean;
  sessionId: string | null;
  sessionStatus: string | null;
  openOrderCount: number;
}

export function WaiterWorkspace() {
  const { accessToken, profile, loading } = useAuth();
  const membership = profile?.memberships[0];
  const branch = membership?.branchAssignments.find((item) => item.branch.isActive)?.branch;
  const query = useQuery({
    queryKey: ['waiter-table-operations', membership?.tenant.id, branch?.id],
    enabled: Boolean(accessToken && membership && branch),
    queryFn: async () => {
      const response = await apiRequest<ApiEnvelope<TableOperation[]>>(`/branches/${branch!.id}/table-operations`, {
        accessToken,
        tenantId: membership!.tenant.id,
      });
      return response.data;
    },
    refetchInterval: 15_000,
  });

  if (loading) return <WaiterState title="Loading workspace…" detail="Restoring your secure session." />;
  if (!profile || !accessToken) return <WaiterState title="Sign-in required" detail="Return to staff sign-in to continue." href="/login" />;
  if (membership?.role !== 'WAITER' && membership?.role !== 'OWNER') return <WaiterState title="Permission denied" detail="This workspace is only available to waiters and owners." />;
  if (!branch) return <WaiterState title="No active branch" detail="Ask the restaurant owner to assign this account to a branch." />;
  if (query.isError) return <WaiterState title="Could not load tables" detail={query.error instanceof ApiError ? query.error.message : 'Check your connection and try again.'} retry={() => void query.refetch()} />;

  const occupied = query.data?.filter((table) => table.sessionId) ?? [];
  const available = query.data?.filter((table) => !table.sessionId) ?? [];

  return (
    <main className="min-h-screen bg-[#f6f3ed]">
      <header className="sticky top-0 z-20 border-b border-line bg-[#14201b] px-4 py-4 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4"><div><p className="text-xs font-bold text-white/60">{membership.tenant.name}</p><h1 className="text-xl font-black">Waiter · {branch.name}</h1></div><span className="rounded-full bg-emerald-400/15 px-3 py-2 text-xs font-black text-emerald-200">Online</span></div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-6">
        <section aria-labelledby="ready-heading" className="rounded-2xl border border-amber-200 bg-amber-50 p-5"><h2 id="ready-heading" className="text-xl font-black">Ready to serve</h2><p className="mt-2 text-sm text-amber-900">Ready-order delivery requires the final Phase 6B completion endpoint correction. No action is shown until the server can confirm it safely.</p></section>
        <section className="mt-7"><div className="flex items-end justify-between"><div><p className="text-xs font-black uppercase tracking-wider text-brand">Dining room</p><h2 className="mt-1 text-2xl font-black">Occupied tables</h2></div><button onClick={() => void query.refetch()} className="min-h-11 rounded-xl border border-line bg-white px-4 text-sm font-black">Refresh</button></div>
          {occupied.length ? <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{occupied.map((table) => <article key={table.tableId} className="rounded-2xl border border-amber-200 bg-white p-5"><div className="flex justify-between"><span className="grid size-11 place-items-center rounded-xl bg-amber-100 font-black">{table.label}</span><span className="h-fit rounded-full bg-amber-50 px-2 py-1 text-xs font-black text-amber-800">Occupied</span></div><p className="mt-4 font-black">Table {table.label}</p><p className="mt-1 text-sm text-ink-muted">{table.openOrderCount} open {table.openOrderCount === 1 ? 'order' : 'orders'}</p><a href={`/tables?session=${encodeURIComponent(table.sessionId!)}`} className="mt-4 grid min-h-11 place-items-center rounded-xl bg-[#18241f] text-sm font-black text-white">View session</a></article>)}</div> : <p className="mt-4 rounded-2xl border border-line bg-white p-8 text-center text-sm text-ink-muted">No occupied tables.</p>}
        </section>
        <section className="mt-7"><h2 className="text-xl font-black">Available tables</h2><div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">{available.map((table) => <article key={table.tableId} className="rounded-xl border border-line bg-white p-4"><p className="font-black">Table {table.label}</p><p className="mt-1 text-xs text-ink-muted">Available · seats {table.capacity}</p></article>)}</div></section>
      </div>
    </main>
  );
}

function WaiterState({ title, detail, href, retry }: { title: string; detail: string; href?: string; retry?: () => void }) {
  return <main className="grid min-h-screen place-items-center bg-[#f6f3ed] p-5 text-center"><div><h1 className="text-2xl font-black">{title}</h1><p className="mt-2 max-w-md text-sm text-ink-muted">{detail}</p>{href && <a href={href} className="mt-5 inline-grid min-h-11 place-items-center rounded-xl bg-[#18241f] px-5 font-black text-white">Continue</a>}{retry && <button onClick={retry} className="mt-5 min-h-11 rounded-xl bg-[#18241f] px-5 font-black text-white">Try again</button>}</div></main>;
}
