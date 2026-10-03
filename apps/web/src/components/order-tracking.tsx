'use client';

import { useQuery } from '@tanstack/react-query';
import { apiRequest, type ApiEnvelope } from '@/lib/api-client';
import { LanguagePicker } from './language-picker';
import { useLocale, type MessageKey } from './locale-provider';

interface TrackedOrder { orderNumber: string; orderType: string; status: string; subtotalMinor: string; discountMinor: string; taxMinor: string; totalMinor: string; currency: string; branchName: string; tableLabel: string | null; createdAt: string; payment: { method: string; status: string } | null; lines: Array<{ itemName: string; variantName: string; quantity: number; lineTotalMinor: string }>; statusHistory: Array<{ status: string; createdAt: string }>; }

const timeline = ['CONFIRMED', 'IN_PROGRESS', 'READY', 'COMPLETED'];

const statusKeys: Record<string, MessageKey> = {
  CONFIRMED: 'ordering.statusConfirmed',
  IN_PROGRESS: 'ordering.statusInProgress',
  READY: 'ordering.statusReady',
  COMPLETED: 'ordering.statusCompleted',
  PENDING_PAYMENT: 'ordering.statusPendingPayment',
  PENDING_CONFIRMATION: 'ordering.statusPendingConfirmation',
  CANCELLED: 'ordering.statusCancelled',
};

const stepKeys: Record<string, MessageKey> = {
  CONFIRMED: 'ordering.stepConfirmed',
  IN_PROGRESS: 'ordering.stepPreparing',
  READY: 'ordering.stepReady',
  COMPLETED: 'ordering.stepCompleted',
};

export function OrderTracking({ token }: { token: string }) {
  const { tr, formatCurrency } = useLocale();
  const query = useQuery({ queryKey: ['track-order', token], queryFn: async () => (await apiRequest<ApiEnvelope<TrackedOrder>>(`/public/orders/${encodeURIComponent(token)}`)).data, refetchInterval: 10_000, retry: 1 });
  if (query.isLoading) return <State title={tr('ordering.findingOrder')} detail={tr('ordering.findingOrderDetail')} />;
  if (query.isError || !query.data) return <State title={tr('ordering.trackingUnavailable')} detail={tr('ordering.trackingUnavailableDetail')} />;
  const order = query.data;
  const currentIndex = timeline.indexOf(order.status);
  const awaitingPayment = order.status === 'PENDING_PAYMENT' || order.status === 'PENDING_CONFIRMATION';
  const typeLabel = order.orderType === 'DINE_IN' ? tr('ordering.typeDineIn') : order.orderType === 'TAKEAWAY' ? tr('ordering.typeTakeaway') : order.orderType === 'PICKUP' ? tr('ordering.typePickup') : order.orderType.replaceAll('_', ' ');
  const statusLabel = statusKeys[order.status] ? tr(statusKeys[order.status]) : order.status.replaceAll('_', ' ');
  return <main className="min-h-screen bg-surface-warm px-4 py-8"><section className="mx-auto max-w-2xl rounded-3xl border border-line bg-white p-6 shadow-card sm:p-8" aria-live="polite"><div className="flex"><LanguagePicker compact className="ms-auto" /></div><div className="mt-5 flex flex-wrap justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-wider text-brand">{tr('ordering.orderLine', { branch: order.branchName, number: order.orderNumber })}</p><h1 className="mt-2 text-3xl font-black">{awaitingPayment ? tr('ordering.waitingConfirmation') : order.status === 'READY' ? tr('ordering.orderReady') : order.status === 'COMPLETED' ? tr('ordering.orderCompleted') : tr('ordering.orderReceived')}</h1><p className="mt-2 text-sm text-ink-muted">{order.tableLabel ? tr('ordering.typeAndTable', { type: typeLabel, table: order.tableLabel }) : typeLabel}</p></div><span className={`h-fit rounded-full px-3 py-2 text-xs font-black ${order.status === 'READY' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>{statusLabel}</span></div>
    {order.payment?.status === 'REJECTED' ? <p className="mt-4 rounded-xl bg-red-50 p-4 text-sm font-semibold text-red-900">{tr('ordering.paymentRejected')}</p> : awaitingPayment && <p className="mt-4 rounded-xl bg-amber-50 p-4 text-sm font-semibold text-amber-900">{order.payment?.method === 'CASH' ? tr('ordering.awaitingCash') : tr('ordering.awaitingManual')}</p>}
    <ol className="mt-8 space-y-1">{timeline.map((status, index) => <li key={status} className="flex gap-4"><div className="flex flex-col items-center"><span className={`grid size-9 place-items-center rounded-full text-xs font-black ${index <= currentIndex ? 'bg-brand text-white' : 'bg-muted text-ink-muted'}`}>{index < currentIndex ? '✓' : index + 1}</span>{index < timeline.length - 1 && <span className={`h-12 w-0.5 ${index < currentIndex ? 'bg-brand' : 'bg-line'}`} />}</div><div className="pt-2"><p className="font-black">{tr(stepKeys[status])}</p></div></li>)}</ol>
    <div className="mt-7 rounded-2xl bg-muted p-5">{order.lines.map((line) => <div key={`${line.itemName}-${line.variantName}`} className="mb-3 flex justify-between text-sm"><span>{line.quantity} × {line.itemName}</span><span>{formatCurrency(line.lineTotalMinor)}</span></div>)}<div className="mt-4 border-t border-line pt-4 text-sm"><div className="flex justify-between"><span>{tr('ordering.subtotalVat')}</span><span>{formatCurrency(order.subtotalMinor)}</span></div><div className="mt-2 flex justify-between"><span>{tr('ordering.vat')}</span><span>{formatCurrency(order.taxMinor)}</span></div><div className="mt-3 flex justify-between text-lg font-black"><span>{tr('ordering.totalPayable')}</span><span dir="ltr">{formatCurrency(order.totalMinor)}</span></div></div></div>
    <div className="mt-5 flex items-center justify-between gap-3 text-xs text-ink-muted"><span>{query.isFetching ? tr('ordering.refreshing') : tr('ordering.statusCurrent')}</span><button onClick={() => void query.refetch()} className="min-h-11 rounded-xl border border-line px-4 font-black text-ink">{tr('ordering.refreshNow')}</button></div></section></main>;
}

function State({ title, detail }: { title: string; detail: string }) { return <main className="grid min-h-screen place-items-center bg-surface-warm p-6 text-center"><div><h1 className="text-2xl font-black">{title}</h1><p className="mt-2 max-w-md text-sm text-ink-muted">{detail}</p></div></main>; }
