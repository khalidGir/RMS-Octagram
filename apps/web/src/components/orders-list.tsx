'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { useBranch } from '@/components/shell/branch-provider';
import { apiRequest } from '@/lib/api-client';
import { formatEtbMinor } from '@/lib/money';
import { cn } from '@/lib/cn';
import { StatusChip } from '@/components/ui/status-chip';
import { Button } from '@/components/ui/button';
import { Banner } from '@/components/ui/banner';

type OrderStatus = 'DRAFT' | 'PENDING_PAYMENT' | 'PENDING_CONFIRMATION' | 'CONFIRMED' | 'IN_PROGRESS' | 'READY' | 'COMPLETED' | 'CANCELLED' | 'VOIDED';

interface OrderLine {
  id: string;
  itemNameSnapshot: string;
  variantNameSnapshot: string | null;
  unitPriceMinor: string;
  quantity: number;
  lineTotalMinor: string;
  notes: string | null;
}

interface Order {
  id: string;
  orderNumber: string;
  orderType: string;
  status: OrderStatus;
  customerName: string | null;
  tableId: string | null;
  totalMinor: string;
  subtotalMinor: string;
  taxMinor: string;
  notes: string | null;
  source: string;
  createdAt: string;
  lines: OrderLine[];
}

interface OrdersResponse {
  data: {
    orders: Order[];
    nextCursor?: string;
  };
}

const STATUS_FILTERS: { label: string; value: string }[] = [
  { label: 'All', value: '' },
  { label: 'Pending payment', value: 'PENDING_PAYMENT' },
  { label: 'Pending confirm', value: 'PENDING_CONFIRMATION' },
  { label: 'Confirmed', value: 'CONFIRMED' },
  { label: 'In progress', value: 'IN_PROGRESS' },
  { label: 'Ready', value: 'READY' },
  { label: 'Completed', value: 'COMPLETED' },
  { label: 'Cancelled', value: 'CANCELLED' },
];

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

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function OrdersList() {
  const { accessToken, csrfToken, profile } = useAuth();
  const { branchId } = useBranch();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const tenantId = profile?.memberships?.[0]?.tenant.id;

  const fetchOrders = useCallback(async (after?: string) => {
    if (!branchId || !accessToken || !tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      params.set('limit', '50');
      if (after) params.set('after', after);

      const qs = params.toString();
      const path = `/branches/${branchId}/orders${qs ? `?${qs}` : ''}`;
      const res = await apiRequest<OrdersResponse>(path, {
        accessToken,
        csrfToken,
        tenantId,
      });
      setOrders(res.data.orders);
      setNextCursor(res.data.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load orders');
    } finally {
      setLoading(false);
    }
  }, [branchId, accessToken, csrfToken, tenantId, statusFilter]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const loadMore = () => {
    if (nextCursor) {
      fetchOrders(nextCursor);
    }
  };

  return (
    <div>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[.18em] text-brand">Operations</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Orders</h1>
          <p className="mt-2 text-sm text-ink-muted">Track every active and completed order across this branch.</p>
        </div>
        <Link href="/pos">
          <Button>+ New order</Button>
        </Link>
      </div>

      <div className="mb-5 flex gap-2 overflow-auto pb-1">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setStatusFilter(f.value)}
            className={cn(
              'whitespace-nowrap rounded-full px-4 py-2 text-xs font-bold transition',
              statusFilter === f.value
                ? 'bg-dark text-white'
                : 'bg-white text-ink-muted hover:bg-surface-subtle border border-line',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <Banner variant="danger" title="Error loading orders" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}

      {loading && orders.length === 0 && (
        <div className="grid min-h-64 place-items-center">
          <p className="text-sm text-ink-muted animate-pulse">Loading orders…</p>
        </div>
      )}

      {!loading && orders.length === 0 && (
        <div className="grid min-h-64 place-items-center text-center">
          <div>
            <p className="text-lg font-black">No orders</p>
            <p className="mt-2 text-sm text-ink-muted">
              {statusFilter ? 'No orders match this filter.' : 'Orders will appear here once created.'}
            </p>
          </div>
        </div>
      )}

      {orders.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {orders.map((order) => {
            const lineCount = order.lines.length;
            const itemSummary = order.lines
              .slice(0, 2)
              .map((l) => `${l.quantity}× ${l.itemNameSnapshot}`)
              .join(' · ');
            const extra = lineCount > 2 ? ` +${lineCount - 2} more` : '';

            return (
              <Link
                key={order.id}
                href={`/orders/${order.id}`}
                className="group rounded-2xl border border-line bg-white p-5 shadow-sm transition hover:shadow-card hover:border-brand/30"
              >
                <div className="mb-4 flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-black text-brand">#{order.orderNumber}</p>
                    <h2 className="mt-1 text-base font-black">
                      {order.customerName || order.orderType.replace('_', ' ')}
                    </h2>
                  </div>
                  <StatusChip status={statusVariant[order.status] || 'idle'}>
                    {order.status.replace('_', ' ')}
                  </StatusChip>
                </div>

                <p className="text-sm text-ink-muted line-clamp-2">
                  {itemSummary}{extra}
                </p>

                <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
                  <span className="text-sm font-black tabular-nums">{formatEtbMinor(Number(order.totalMinor))}</span>
                  <span className="text-xs text-ink-muted">{timeAgo(order.createdAt)}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {nextCursor && !loading && (
        <div className="mt-6 text-center">
          <Button variant="secondary" onClick={loadMore}>Load more</Button>
        </div>
      )}
    </div>
  );
}
