'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { useBranch } from '@/components/shell/branch-provider';
import { apiRequest } from '@/lib/api-client';
import { useLocale, type MessageKey } from '@/components/locale-provider';
import { labelFor, orderStatusKeys, orderTypeKeys } from '@/lib/status-labels';
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

const STATUS_FILTERS: { labelKey: MessageKey; value: string }[] = [
  { labelKey: 'orders.filterAll', value: '' },
  { labelKey: 'orders.filterPendingPayment', value: 'PENDING_PAYMENT' },
  { labelKey: 'orders.filterPendingConfirm', value: 'PENDING_CONFIRMATION' },
  { labelKey: 'orders.filterConfirmed', value: 'CONFIRMED' },
  { labelKey: 'orders.filterInProgress', value: 'IN_PROGRESS' },
  { labelKey: 'orders.filterReady', value: 'READY' },
  { labelKey: 'orders.filterCompleted', value: 'COMPLETED' },
  { labelKey: 'orders.filterCancelled', value: 'CANCELLED' },
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

type Tr = (key: MessageKey, variables?: Record<string, string | number>) => string;

function timeAgo(dateStr: string, tr: Tr): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return tr('orders.timeJustNow');
  if (mins < 60) return tr('orders.timeMinutesAgo', { count: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return tr('orders.timeHoursAgo', { count: hrs });
  const days = Math.floor(hrs / 24);
  return tr('orders.timeDaysAgo', { count: days });
}

export function OrdersList() {
  const { accessToken, csrfToken, profile } = useAuth();
  const { formatCurrency, tr } = useLocale();
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
      setError(err instanceof Error ? err.message : tr('orders.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [branchId, accessToken, csrfToken, tenantId, statusFilter, tr]);

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
          <p className="text-xs font-black uppercase tracking-[.18em] text-brand">{tr('orders.eyebrowOperations')}</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">{tr('orders.title')}</h1>
          <p className="mt-2 text-sm text-ink-muted">{tr('orders.description')}</p>
        </div>
        <Link href="/pos">
          <Button>{tr('orders.newOrder')}</Button>
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
            {tr(f.labelKey)}
          </button>
        ))}
      </div>

      {error && (
        <Banner variant="danger" title={tr('orders.errorTitle')} onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}

      {loading && orders.length === 0 && (
        <div className="grid min-h-64 place-items-center">
          <p className="text-sm text-ink-muted animate-pulse">{tr('orders.loading')}</p>
        </div>
      )}

      {!loading && orders.length === 0 && (
        <div className="grid min-h-64 place-items-center text-center">
          <div>
            <p className="text-lg font-black">{tr('orders.emptyTitle')}</p>
            <p className="mt-2 text-sm text-ink-muted">
              {statusFilter ? tr('orders.emptyFiltered') : tr('orders.emptyAll')}
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
            const extra = lineCount > 2 ? ` ${tr('orders.moreLines', { count: lineCount - 2 })}` : '';

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
                      {order.customerName || labelFor(orderTypeKeys, order.orderType, tr)}
                    </h2>
                  </div>
                  <StatusChip status={statusVariant[order.status] || 'idle'}>
                    {labelFor(orderStatusKeys, order.status, tr)}
                  </StatusChip>
                </div>

                <p className="text-sm text-ink-muted line-clamp-2">
                  {itemSummary}{extra}
                </p>

                <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
                  <span className="text-sm font-black tabular-nums">{formatCurrency(Number(order.totalMinor))}</span>
                  <span className="text-xs text-ink-muted">{timeAgo(order.createdAt, tr)}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {nextCursor && !loading && (
        <div className="mt-6 text-center">
          <Button variant="secondary" onClick={loadMore}>{tr('orders.loadMore')}</Button>
        </div>
      )}
    </div>
  );
}
