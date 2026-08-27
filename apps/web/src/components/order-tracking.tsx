'use client';

import { useQuery } from '@tanstack/react-query';
import { apiRequest, formatEtbMinor, type ApiEnvelope } from '@/lib/api-client';

interface TrackedOrder { orderNumber: string; orderType: string; status: string; subtotalMinor: string; discountMinor: string; taxMinor: string; totalMinor: string; currency: string; branchName: string; tableLabel: string | null; createdAt: string; payment: { method: string; status: string } | null; lines: Array<{ itemName: string; variantName: string; quantity: number; lineTotalMinor: string }>; statusHistory: Array<{ status: string; createdAt: string }>; }

const timeline = ['CONFIRMED', 'IN_PROGRESS', 'READY', 'COMPLETED'];

export function OrderTracking({ token }: { token: string }) {
  const query = useQuery({ queryKey: ['track-order', token], queryFn: async () => (await apiRequest<ApiEnvelope<TrackedOrder>>(`/public/orders/${encodeURIComponent(token)}`)).data, refetchInterval: 10_000, retry: 1 });
  if (query.isLoading) return <State title="Finding your order…" detail="Checking the latest restaurant status." />;
  if (query.isError || !query.data) return <State title="Order tracking is unavailable" detail="This link may be invalid or expired. Ask restaurant staff for help." />;
  const order = query.data;
  const currentIndex = timeline.indexOf(order.status);
  const awaitingPayment = order.status === 'PENDING_PAYMENT' || order.status === 'PENDING_CONFIRMATION';
  const paymentCopy = order.payment?.method === 'CASH' ? 'Awaiting cashier confirmation.' : 'Awaiting manual payment verification.';
  return <main className="min-h-screen bg-[#fffaf3] px-4 py-8"><section className="mx-auto max-w-2xl rounded-3xl border border-line bg-white p-6 shadow-card sm:p-8" aria-live="polite"><div className="flex flex-wrap justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-wider text-brand">{order.branchName} · Order #{order.orderNumber}</p><h1 className="mt-2 text-3xl font-black">{awaitingPayment ? 'Waiting for confirmation' : order.status === 'READY' ? 'Your order is ready' : order.status === 'COMPLETED' ? 'Order completed' : 'We have your order'}</h1><p className="mt-2 text-sm text-ink-muted">{order.orderType.replaceAll('_', ' ')}{order.tableLabel ? ` · Table ${order.tableLabel}` : ''}</p></div><span className={`h-fit rounded-full px-3 py-2 text-xs font-black ${order.status === 'READY' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>{order.status.replaceAll('_', ' ')}</span></div>
    {order.payment?.status === 'REJECTED' ? <p className="mt-4 rounded-xl bg-red-50 p-4 text-sm font-semibold text-red-900">Payment could not be verified. Please ask restaurant staff for help.</p> : awaitingPayment && <p className="mt-4 rounded-xl bg-amber-50 p-4 text-sm font-semibold text-amber-900">{paymentCopy} The order will enter the kitchen only after confirmation.</p>}
    <ol className="mt-8 space-y-1">{timeline.map((status, index) => <li key={status} className="flex gap-4"><div className="flex flex-col items-center"><span className={`grid size-9 place-items-center rounded-full text-xs font-black ${index <= currentIndex ? 'bg-brand text-white' : 'bg-muted text-ink-muted'}`}>{index < currentIndex ? '✓' : index + 1}</span>{index < timeline.length - 1 && <span className={`h-12 w-0.5 ${index < currentIndex ? 'bg-brand' : 'bg-line'}`} />}</div><div className="pt-2"><p className="font-black">{status === 'IN_PROGRESS' ? 'Preparing' : status[0] + status.slice(1).toLowerCase()}</p></div></li>)}</ol>
    <div className="mt-7 rounded-2xl bg-muted p-5">{order.lines.map((line) => <div key={`${line.itemName}-${line.variantName}`} className="mb-3 flex justify-between text-sm"><span>{line.quantity} × {line.itemName}</span><span>{formatEtbMinor(line.lineTotalMinor)}</span></div>)}<div className="mt-4 border-t border-line pt-4 text-sm"><div className="flex justify-between"><span>Subtotal (before VAT)</span><span>{formatEtbMinor(order.subtotalMinor)}</span></div><div className="mt-2 flex justify-between"><span>VAT</span><span>{formatEtbMinor(order.taxMinor)}</span></div><div className="mt-3 flex justify-between text-lg font-black"><span>Total payable</span><span dir="ltr">{formatEtbMinor(order.totalMinor)}</span></div></div></div>
    <div className="mt-5 flex items-center justify-between gap-3 text-xs text-ink-muted"><span>{query.isFetching ? 'Refreshing status…' : 'Status is current'}</span><button onClick={() => void query.refetch()} className="min-h-11 rounded-xl border border-line px-4 font-black text-ink">Refresh now</button></div></section></main>;
}

function State({ title, detail }: { title: string; detail: string }) { return <main className="grid min-h-screen place-items-center bg-[#fffaf3] p-6 text-center"><div><h1 className="text-2xl font-black">{title}</h1><p className="mt-2 max-w-md text-sm text-ink-muted">{detail}</p></div></main>; }
