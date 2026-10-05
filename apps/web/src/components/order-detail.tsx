'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { apiRequest, ApiError } from '@/lib/api-client';
import { useLocale, type MessageKey } from '@/components/locale-provider';
import { labelFor, orderStatusKeys } from '@/lib/status-labels';
import { StatusChip } from '@/components/ui/status-chip';
import { Banner } from '@/components/ui/banner';
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui';
import { FulfillmentTimeline } from '@/components/order-fulfillment-timeline';
import { ReceiptButton } from '@/components/receipt-viewer';

type OrderStatus = 'DRAFT' | 'PENDING_PAYMENT' | 'PENDING_CONFIRMATION' | 'CONFIRMED' | 'IN_PROGRESS' | 'READY' | 'COMPLETED' | 'CANCELLED' | 'VOIDED';

interface OrderModifier {
  id: string;
  nameSnapshot: string;
  unitPriceDeltaMinor: string;
  quantity: number;
  totalDeltaMinor: string;
}

interface OrderLine {
  id: string;
  itemNameSnapshot: string;
  variantNameSnapshot: string | null;
  unitPriceMinor: string;
  quantity: number;
  lineTotalMinor: string;
  notes: string | null;
  modifiers: OrderModifier[];
}

interface StatusHistoryEntry {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  reason: string | null;
  createdAt: string;
}

interface Order {
  id: string;
  orderNumber: string;
  orderType: string;
  status: OrderStatus;
  customerName: string | null;
  customerPhone: string | null;
  tableId: string | null;
  currency: string;
  subtotalMinor: string;
  discountMinor: string;
  taxMinor: string;
  serviceChargeMinor: string;
  totalMinor: string;
  notes: string | null;
  source: string;
  confirmedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  lines: OrderLine[];
  statusHistory: StatusHistoryEntry[];
}

interface OrderDetailResponse {
  data: Order;
}

const EDITABLE_STATUSES = ['DRAFT', 'PENDING_PAYMENT', 'PENDING_CONFIRMATION'];
const MANAGE_ROLES = ['OWNER', 'MANAGER', 'CASHIER'];

const statusVariant: Record<string, 'idle' | 'active' | 'success' | 'warning' | 'danger' | 'info'> = {
  DRAFT: 'idle',
  PENDING_PAYMENT: 'warning',
  PENDING_CONFIRMATION: 'warning',
  CONFIRMED: 'info',
  IN_PROGRESS: 'active',
  READY: 'success',
  COMPLETED: 'success',
  CANCELLED: 'danger',
  VOIDED: 'danger',
};

const ORDER_TYPE_KEYS: Record<string, MessageKey> = {
  DINE_IN: 'orders.detailTypeDineIn',
  TAKEAWAY: 'orders.detailTypeTakeaway',
  PICKUP: 'orders.detailTypePickup',
  POS: 'orders.detailTypePos',
};

export function OrderDetail({ orderId }: { orderId: string }) {
  const { accessToken, csrfToken, profile } = useAuth();
  const { formatCurrency, tr, formatDate } = useLocale();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const tenantId = profile?.memberships?.[0]?.tenant.id;

  const fetchOrder = useCallback(async () => {
    if (!accessToken || !tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<OrderDetailResponse>(`/orders/${orderId}`, {
        accessToken,
        csrfToken,
        tenantId,
      });
      setOrder(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('orders.detailLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [orderId, accessToken, csrfToken, tenantId, tr]);

  const typeLabel = (raw: string) => (ORDER_TYPE_KEYS[raw] ? tr(ORDER_TYPE_KEYS[raw]) : raw);
  const dateFmt = (value: string) =>
    formatDate(value, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });

  useEffect(() => {
    fetchOrder();
  }, [fetchOrder]);

  async function submitCancel() {
    if (!order || cancelBusy) return;
    setCancelBusy(true);
    setCancelError(null);
    try {
      await apiRequest(`/orders/${order.id}/cancel`, {
        method: 'POST',
        accessToken,
        csrfToken,
        tenantId,
        body: { reason: cancelReason.trim() || undefined, expectedVersion: order.version },
      });
      setCancelOpen(false);
      setCancelReason('');
      await fetchOrder();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setCancelError(tr('orders.detailVersionConflict'));
        await fetchOrder();
      } else {
        setCancelError(err instanceof ApiError ? err.message : tr('orders.detailCancelFailed'));
      }
    } finally {
      setCancelBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="grid min-h-64 place-items-center">
        <p className="text-sm text-ink-muted animate-pulse">{tr('orders.detailLoading')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <ReceiptButton endpoint={`/orders/${orderId}/receipt`} accessToken={accessToken} tenantId={tenantId} label={tr('orders.receiptReprint')} />
          <Link href="/orders" className="grid min-h-11 place-items-center px-2 text-sm font-black text-brand">{tr('orders.detailBack')}</Link>
        </div>
        <div className="mt-6">
          <Banner variant="danger" title={tr('orders.detailErrorTitle')}>{error}</Banner>
        </div>
      </div>
    );
  }

  if (!order) return null;

  return (
    <div>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[.18em] text-brand">
            {tr('orders.detailOrderNumber', { number: order.orderNumber })}
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
            {order.customerName || typeLabel(order.orderType)}
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            {typeLabel(order.orderType)}
            {order.customerName && ` · ${order.customerName}`}
            {` · ${dateFmt(order.createdAt)}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ReceiptButton endpoint={`/orders/${order.id}/receipt`} accessToken={accessToken} tenantId={tenantId} label={tr('orders.receiptReprint')} />
          <Link href="/orders" className="grid min-h-11 place-items-center px-2 text-sm font-black text-brand">{tr('orders.detailBack')}</Link>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
        {/* Left: Order items */}
        <div className="rounded-panel border border-line bg-white shadow-card p-6">
          <h2 className="text-lg font-black">{tr('orders.detailItemsTitle')}</h2>

          {order.lines.length === 0 && (
            <p className="mt-4 text-sm text-ink-muted">{tr('orders.detailEmptyItems')}</p>
          )}

          {order.lines.map((line) => (
            <div key={line.id} className="mt-4 border-b border-line pb-4 last:border-b-0">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-black">
                    {line.quantity}× {line.itemNameSnapshot}
                    {line.variantNameSnapshot && (
                      <span className="font-normal text-ink-muted"> ({line.variantNameSnapshot})</span>
                    )}
                  </p>
                  {line.notes && (
                    <p className="mt-1 text-xs text-ink-muted">{line.notes}</p>
                  )}
                  {line.modifiers.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {line.modifiers.map((mod) => (
                        <p key={mod.id} className="text-xs text-ink-muted">
                          + {mod.nameSnapshot}
                          {Number(mod.unitPriceDeltaMinor) > 0 && (
                            <> ({formatCurrency(Number(mod.unitPriceDeltaMinor))})</>
                          )}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
                <p className="text-sm font-black tabular-nums whitespace-nowrap">
                  {formatCurrency(Number(line.lineTotalMinor))}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Right: Status + Summary */}
        <div className="space-y-5">
          <div className="rounded-panel border border-line bg-white shadow-card p-6">
            <p className="text-xs font-black text-brand">{tr('orders.detailStatusEyebrow')}</p>
            <div className="mt-2 flex items-center gap-3">
              <h2 className="text-2xl font-black">{labelFor(orderStatusKeys, order.status, tr)}</h2>
              <StatusChip status={statusVariant[order.status] || 'idle'}>
                {labelFor(orderStatusKeys, order.status, tr)}
              </StatusChip>
            </div>

            <div className="mt-5 border-t border-line pt-5 space-y-3">
              {(() => {
                const role = profile?.memberships?.[0]?.role;
                const showActions =
                  role !== undefined && MANAGE_ROLES.includes(role) && EDITABLE_STATUSES.includes(order.status);
                if (!showActions) return null;
                return (
                  <div className="flex flex-wrap gap-2" data-testid="order-actions">
                    <Link
                      href={`/pos?edit=${order.id}`}
                      className="grid min-h-11 flex-1 place-items-center rounded-xl bg-dark px-4 text-sm font-black text-white"
                    >
                      {tr('orders.detailActionEdit')}
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        setCancelError(null);
                        setCancelReason('');
                        setCancelOpen(true);
                      }}
                      className="min-h-11 flex-1 rounded-xl border border-red-200 px-4 text-sm font-black text-red-700 transition-colors hover:bg-red-50"
                    >
                      {tr('orders.detailActionCancel')}
                    </button>
                  </div>
                );
              })()}
              <div className="flex justify-between text-sm">
                <span className="text-ink-muted">{tr('orders.detailSubtotal')}</span>
                <span className="font-bold tabular-nums">{formatCurrency(Number(order.subtotalMinor))}</span>
              </div>
              {Number(order.taxMinor) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-ink-muted">{tr('orders.detailTax')}</span>
                  <span className="font-bold tabular-nums">{formatCurrency(Number(order.taxMinor))}</span>
                </div>
              )}
              {Number(order.discountMinor) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-ink-muted">{tr('orders.detailDiscount')}</span>
                  <span className="font-bold text-danger tabular-nums">-{formatCurrency(Number(order.discountMinor))}</span>
                </div>
              )}
              <div className="flex justify-between text-xl font-black border-t border-line pt-3">
                <span>{tr('orders.detailTotal')}</span>
                <span className="tabular-nums">{formatCurrency(Number(order.totalMinor))}</span>
              </div>
            </div>

            {order.notes && (
              <div className="mt-5 rounded-xl bg-surface-warm p-4">
                <p className="text-xs font-black text-ink-muted">{tr('orders.detailNotes')}</p>
                <p className="mt-1 text-sm">{order.notes}</p>
              </div>
            )}
          </div>

          {/* Status history */}
          {order.statusHistory.length > 0 && (
            <div className="rounded-panel border border-line bg-white shadow-card p-6">
              <h3 className="text-sm font-black">{tr('orders.detailStatusHistory')}</h3>
              <div className="mt-4 space-y-3">
                {order.statusHistory.map((entry) => (
                  <div key={entry.id} className="flex items-start gap-3 text-sm">
                    <div className="mt-1 size-2 shrink-0 rounded-full bg-brand" />
                    <div>
                      <p>
                        {entry.fromStatus ? `${labelFor(orderStatusKeys, entry.fromStatus, tr)} → ` : ''}
                        <span className="font-bold">{labelFor(orderStatusKeys, entry.toStatus, tr)}</span>
                      </p>
                      <p className="text-xs text-ink-muted">{dateFmt(entry.createdAt)}</p>
                      {entry.reason && <p className="text-xs text-ink-muted">{entry.reason}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Fulfillment timeline */}
          <FulfillmentTimeline orderId={orderId} />
        </div>
      </div>

      {cancelOpen && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !cancelBusy) setCancelOpen(false);
          }}
        >
          <DialogContent aria-label={tr('orders.detailCancelTitle')}>
            <DialogHeader>
              <DialogTitle>{tr('orders.detailCancelTitle')}</DialogTitle>
              <DialogDescription>{tr('orders.detailCancelBody')}</DialogDescription>
            </DialogHeader>
            <label className="mt-2 block text-sm font-bold">
              {tr('orders.detailCancelReason')}
              <textarea
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
                maxLength={500}
                className="mt-2 min-h-20 w-full rounded-xl border border-line p-3 font-normal"
              />
            </label>
            {cancelError && (
              <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800">
                {cancelError}
              </p>
            )}
            <DialogFooter className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setCancelOpen(false)} disabled={cancelBusy}>
                {tr('common.cancel')}
              </Button>
              <Button variant="danger" onClick={() => void submitCancel()} disabled={cancelBusy}>
                {cancelBusy ? tr('orders.detailCancelPending') : tr('orders.detailCancelConfirm')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
