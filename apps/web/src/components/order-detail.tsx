'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { apiRequest } from '@/lib/api-client';
import { formatEtbMinor } from '@/lib/money';
import { StatusChip } from '@/components/ui/status-chip';
import { Banner } from '@/components/ui/banner';

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

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

const ORDER_TYPE_LABELS: Record<string, string> = {
  DINE_IN: 'Dine in',
  TAKEAWAY: 'Takeaway',
  PICKUP: 'Pickup',
  POS: 'POS',
};

export function OrderDetail({ orderId }: { orderId: string }) {
  const { accessToken, csrfToken, profile } = useAuth();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      setError(err instanceof Error ? err.message : 'Failed to load order');
    } finally {
      setLoading(false);
    }
  }, [orderId, accessToken, csrfToken, tenantId]);

  useEffect(() => {
    fetchOrder();
  }, [fetchOrder]);

  if (loading) {
    return (
      <div className="grid min-h-64 place-items-center">
        <p className="text-sm text-ink-muted animate-pulse">Loading order…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <Link href="/orders" className="text-sm font-black text-brand">← All orders</Link>
        <div className="mt-6">
          <Banner variant="danger" title="Error loading order">{error}</Banner>
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
            Order #{order.orderNumber}
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
            {order.customerName || ORDER_TYPE_LABELS[order.orderType] || order.orderType}
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            {ORDER_TYPE_LABELS[order.orderType] || order.orderType}
            {order.customerName && ` · ${order.customerName}`}
            {` · ${formatDate(order.createdAt)}`}
          </p>
        </div>
        <Link href="/orders" className="text-sm font-black text-brand">← All orders</Link>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
        {/* Left: Order items */}
        <div className="rounded-panel border border-line bg-white shadow-card p-6">
          <h2 className="text-lg font-black">Order items</h2>

          {order.lines.length === 0 && (
            <p className="mt-4 text-sm text-ink-muted">No items in this order.</p>
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
                            <> ({formatEtbMinor(Number(mod.unitPriceDeltaMinor))})</>
                          )}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
                <p className="text-sm font-black tabular-nums whitespace-nowrap">
                  {formatEtbMinor(Number(line.lineTotalMinor))}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Right: Status + Summary */}
        <div className="space-y-5">
          <div className="rounded-panel border border-line bg-white shadow-card p-6">
            <p className="text-xs font-black text-brand">ORDER STATUS</p>
            <div className="mt-2 flex items-center gap-3">
              <h2 className="text-2xl font-black">{order.status.replace('_', ' ')}</h2>
              <StatusChip status={statusVariant[order.status] || 'idle'}>
                {order.status.replace('_', ' ')}
              </StatusChip>
            </div>

            <div className="mt-5 border-t border-line pt-5 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-ink-muted">Subtotal</span>
                <span className="font-bold tabular-nums">{formatEtbMinor(Number(order.subtotalMinor))}</span>
              </div>
              {Number(order.taxMinor) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-ink-muted">Tax</span>
                  <span className="font-bold tabular-nums">{formatEtbMinor(Number(order.taxMinor))}</span>
                </div>
              )}
              {Number(order.discountMinor) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-ink-muted">Discount</span>
                  <span className="font-bold text-danger tabular-nums">-{formatEtbMinor(Number(order.discountMinor))}</span>
                </div>
              )}
              <div className="flex justify-between text-xl font-black border-t border-line pt-3">
                <span>Total</span>
                <span className="tabular-nums">{formatEtbMinor(Number(order.totalMinor))}</span>
              </div>
            </div>

            {order.notes && (
              <div className="mt-5 rounded-xl bg-surface-warm p-4">
                <p className="text-xs font-black text-ink-muted">Notes</p>
                <p className="mt-1 text-sm">{order.notes}</p>
              </div>
            )}
          </div>

          {/* Status history */}
          {order.statusHistory.length > 0 && (
            <div className="rounded-panel border border-line bg-white shadow-card p-6">
              <h3 className="text-sm font-black">Status history</h3>
              <div className="mt-4 space-y-3">
                {order.statusHistory.map((entry) => (
                  <div key={entry.id} className="flex items-start gap-3 text-sm">
                    <div className="mt-1 size-2 shrink-0 rounded-full bg-brand" />
                    <div>
                      <p>
                        {entry.fromStatus ? `${entry.fromStatus.replace('_', ' ')} → ` : ''}
                        <span className="font-bold">{entry.toStatus.replace('_', ' ')}</span>
                      </p>
                      <p className="text-xs text-ink-muted">{formatDate(entry.createdAt)}</p>
                      {entry.reason && <p className="text-xs text-ink-muted">{entry.reason}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
