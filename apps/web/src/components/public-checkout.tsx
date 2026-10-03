'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { ApiError, apiRequest, newIdempotencyKey, type ApiEnvelope } from '@/lib/api-client';
import { LanguagePicker } from './language-picker';
import { useLocale } from './locale-provider';

interface StoredCart {
  entry: { kind: 'pickup'; publicSlug: string } | { kind: 'table'; token: string };
  context: {
    branch: { id: string; name: string };
    table?: { label: string };
    availableOrderTypes?: string[];
    availablePaymentMethods: string[];
  };
  lines: Array<{ variantId: string; name: string; basePriceMinor: string; quantity: number }>;
  quotedSubtotal: string;
}

interface CreatedOrder {
  order: { id: string; orderNumber: string; totalMinor: string; status: string };
  trackingToken: string;
}

export function PublicCheckout({ expectedEntry }: { expectedEntry: StoredCart['entry'] }) {
  const router = useRouter();
  const { tr, formatCurrency } = useLocale();
  const idempotencyKey = useRef(newIdempotencyKey());
  const paymentKey = useRef(newIdempotencyKey());
  const [cart, setCart] = useState<StoredCart | null>(null);
  const [orderType, setOrderType] = useState<'DINE_IN' | 'TAKEAWAY'>('DINE_IN');
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'BANK_TRANSFER' | 'TELEBIRR'>('BANK_TRANSFER');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [pickupAt, setPickupAt] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const raw = window.sessionStorage.getItem('rms-public-cart');
    if (!raw) return;
    try {
      const value = JSON.parse(raw) as StoredCart;
      if (value.entry.kind === expectedEntry.kind) setCart(value);
    } catch { setCart(null); }
  }, [expectedEntry.kind]);

  const subtotal = useMemo(() => cart?.lines.reduce((sum, line) => sum + BigInt(line.basePriceMinor) * BigInt(line.quantity), 0n) ?? 0n, [cart]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!cart) return;
    setSubmitting(true);
    setError(null);
    try {
      const lines = cart.lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity, modifiers: [] }));
      let created: CreatedOrder;
      if (cart.entry.kind === 'pickup') {
        if (!customerName.trim() || !customerPhone.trim() || !pickupAt) throw new Error(tr('validation.requiredCheckout'));
        const response = await apiRequest<ApiEnvelope<CreatedOrder>>('/public/pickup-orders', { method: 'POST', body: { branchId: cart.context.branch.id, customerName, customerPhone, pickupAt: new Date(pickupAt).toISOString(), notes, lines, idempotencyKey: idempotencyKey.current, quotedTotal: cart.quotedSubtotal } });
        created = response.data;
      } else {
        const response = await apiRequest<ApiEnvelope<CreatedOrder>>('/public/orders', { method: 'POST', body: { qrToken: cart.entry.token, orderType, customerName: customerName || undefined, notes, lines, idempotencyKey: idempotencyKey.current, quotedTotal: cart.quotedSubtotal } });
        created = response.data;
      }

      const tracking = created.trackingToken;
      window.sessionStorage.setItem('rms-tracking-token', tracking);
      if (paymentMethod === 'CASH') {
        router.push(`/track/${encodeURIComponent(tracking)}` as Route);
        return;
      }
      const payment = await apiRequest<{ data: { paymentToken: string } }>('/public/payments/manual-transfer', { method: 'POST', body: { trackingToken: tracking, idempotencyKey: paymentKey.current, method: paymentMethod } });
      window.sessionStorage.setItem('rms-payment-token', payment.data.paymentToken);
      window.sessionStorage.setItem('rms-payment-method', paymentMethod);
      router.push(`/pay/${encodeURIComponent(tracking)}` as Route);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) setError(tr('validation.menuChanged'));
      else setError(reason instanceof Error ? reason.message : tr('validation.orderSubmitFailed'));
    } finally { setSubmitting(false); }
  }

  if (!cart) return <main className="grid min-h-screen place-items-center p-6 text-center"><div><h1 className="text-2xl font-black">{tr('ordering.cartUnavailable')}</h1><p className="mt-2 text-ink-muted">{tr('ordering.cartUnavailableDetail')}</p></div></main>;
  const pickup = cart.entry.kind === 'pickup';
  const methods = cart.context.availablePaymentMethods;

  return <main className="min-h-screen bg-surface-warm px-4 py-7"><div className="mx-auto flex max-w-5xl"><LanguagePicker compact className="ms-auto" /></div><form onSubmit={submit} className="mt-4 mx-auto grid max-w-5xl gap-5 lg:grid-cols-[1.1fr_.9fr]"><section className="rounded-2xl border border-line bg-white p-5 shadow-card sm:p-7"><p className="text-xs font-black uppercase tracking-wider text-brand">{pickup ? tr('ordering.pickupPreorder') : tr('ordering.table', { table: cart.context.table?.label ?? '' })}</p><h1 className="mt-2 text-3xl font-black">{tr('ordering.reviewAndPay')}</h1>{error && <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">{error}</div>}
    {!pickup && <fieldset className="mt-6"><legend className="font-black">{tr('ordering.orderType')}</legend><div className="mt-3 grid grid-cols-2 gap-3">{(['DINE_IN','TAKEAWAY'] as const).filter((type) => cart.context.availableOrderTypes?.includes(type)).map((type) => <label key={type} className={`rounded-xl border p-4 font-bold ${orderType === type ? 'border-brand bg-orange-50' : 'border-line'}`}><input type="radio" name="orderType" value={type} checked={orderType === type} onChange={() => setOrderType(type)} className="me-2" />{type === 'DINE_IN' ? tr('ordering.dineIn') : tr('ordering.takeaway')}</label>)}</div></fieldset>}
    {pickup && <div className="mt-6 grid gap-4"><label className="text-sm font-bold">{tr('ordering.name')}<input required value={customerName} onChange={(e) => setCustomerName(e.target.value)} maxLength={200} className="mt-2 min-h-12 w-full rounded-xl border border-line px-3" /></label><label className="text-sm font-bold">{tr('ordering.phone')}<input required value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} maxLength={20} className="mt-2 min-h-12 w-full rounded-xl border border-line px-3" /></label><label className="text-sm font-bold">{tr('ordering.pickupTime')}<input required type="datetime-local" value={pickupAt} onChange={(e) => setPickupAt(e.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-line px-3" /></label></div>}
    <fieldset className="mt-6"><legend className="font-black">{tr('ordering.paymentMethod')}</legend><div className="mt-3 space-y-3">{(['CASH','BANK_TRANSFER','TELEBIRR'] as const).filter((method) => methods.includes(method)).map((method) => <label key={method} className={`flex min-h-14 items-center rounded-xl border px-4 font-bold ${paymentMethod === method ? 'border-brand bg-orange-50' : 'border-line'}`}><input type="radio" name="payment" checked={paymentMethod === method} onChange={() => setPaymentMethod(method)} className="me-3" />{method === 'CASH' ? tr('ordering.payCash') : method === 'TELEBIRR' ? tr('ordering.payTelebirr') : tr('ordering.payBank')}</label>)}</div></fieldset>
    <label className="mt-5 block text-sm font-bold">{tr('ordering.orderNotes')}<textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} className="mt-2 min-h-24 w-full rounded-xl border border-line p-3" /></label><button disabled={submitting || methods.length === 0} className="mt-5 min-h-14 w-full rounded-xl bg-brand px-5 font-black text-white disabled:opacity-50">{submitting ? tr('ordering.submitting') : tr('ordering.placeOrder')}</button></section>
    <aside className="h-fit rounded-2xl border border-line bg-white p-5 shadow-card"><h2 className="text-xl font-black">{tr('ordering.yourOrder')}</h2>{cart.lines.map((line) => <div key={line.variantId} className="mt-4 flex justify-between border-b border-line pb-4 text-sm"><span><b>{line.quantity} × {line.name}</b></span><b>{formatCurrency(BigInt(line.basePriceMinor) * BigInt(line.quantity))}</b></div>)}<div className="mt-4 flex justify-between"><span>{tr('ordering.subtotalVat')}</span><b>{formatCurrency(subtotal)}</b></div><p className="mt-3 text-xs text-ink-muted">{tr('ordering.vatNote')}</p></aside></form></main>;
}
