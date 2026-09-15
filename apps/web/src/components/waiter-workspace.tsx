'use client';

import { useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { useServiceBoard, useClaimOrder, useCollectOrder, useServeOrder, useServiceNotifications } from '@/lib/use-service-board';
import { Button, Dialog, DialogContent, DialogTitle, StatusChip, Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui';
import type { ServiceBoardOrder } from '@/lib/fulfillment-types';

function formatElapsed(seconds: number | null): string {
  if (seconds === null) return '--';
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  return `${mins}m`;
}

function chipStatus(s: string): 'idle' | 'active' | 'success' | 'warning' | 'danger' | 'info' {
  switch (s) {
    case 'ALL_READY': return 'success';
    case 'PARTIALLY_READY': return 'warning';
    case 'QUEUED': return 'idle';
    case 'IN_PROGRESS': return 'active';
    case 'READY_FOR_SERVICE': return 'success';
    case 'PARTIALLY_SERVED': return 'warning';
    case 'CANCELLED': return 'danger';
    default: return 'idle';
  }
}

function fulfillmentLabel(s: string): string {
  switch (s) {
    case 'ALL_READY': return 'All ready';
    case 'PARTIALLY_READY': return 'Partially ready';
    case 'QUEUED': return 'Queued';
    case 'IN_PROGRESS': return 'In progress';
    case 'READY_FOR_SERVICE': return 'Ready for service';
    case 'PARTIALLY_SERVED': return 'Partially served';
    case 'CANCELLED': return 'Cancelled';
    default: return s;
  }
}

export function WaiterWorkspace() {
  const { profile } = useAuth();
  const [tab, setTab] = useState('ready');

  const membership = profile?.memberships?.[0];
  const role = membership?.role;
  if (!role || (role !== 'WAITER' && role !== 'OWNER')) {
    return <p role="alert" className="p-8 text-center text-sm font-bold text-red-700">Permission denied.</p>;
  }

  return (
    <main className="min-h-screen bg-[#f6f3ed]">
      <header className="sticky top-0 z-20 border-b border-line bg-[#14201b] px-4 py-4 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold text-white/60">{membership?.tenant.name}</p>
            <h1 className="text-xl font-black">Waiter · Service Board</h1>
          </div>
          <span className="rounded-full bg-emerald-400/15 px-3 py-2 text-xs font-black text-emerald-200">Online</span>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="ready">Ready to collect</TabsTrigger>
            <TabsTrigger value="mine">My orders</TabsTrigger>
            <TabsTrigger value="all">All orders</TabsTrigger>
            <TabsTrigger value="notifications">Notifications</TabsTrigger>
          </TabsList>

          <TabsContent value="ready">
            <ReadyOrdersTab />
          </TabsContent>

          <TabsContent value="mine">
            <MyOrdersTab />
          </TabsContent>

          <TabsContent value="all">
            <AllOrdersTab />
          </TabsContent>

          <TabsContent value="notifications">
            <NotificationsTab />
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}

function ReadyOrdersTab() {
  const { data: orders = [], isLoading, error, refetch } = useServiceBoard('all');
  const claimOrder = useClaimOrder();
  const collectOrder = useCollectOrder();
  const serveOrder = useServeOrder();

  const readyOrders = orders.filter((o) => o.canCollect || o.canServe || o.readyAllocations > 0);

  if (isLoading) return <p className="py-16 text-center text-sm font-bold text-ink-muted">Loading orders...</p>;
  if (error) return <ErrorState message={error.message} onRetry={refetch} />;

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-ink-muted">{readyOrders.length} order{readyOrders.length !== 1 ? 's' : ''} ready</p>
        <button onClick={() => refetch()} className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-black hover:bg-muted transition-colors">
          Refresh
        </button>
      </div>

      {readyOrders.length === 0 ? (
        <EmptyState message="No orders ready for collection" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {readyOrders.map((order) => (
            <OrderCard
              key={order.orderId}
              order={order}
              onClaim={() => claimOrder.mutateAsync(order.orderId)}
              onCollect={() => collectOrder.mutateAsync({ orderId: order.orderId })}
              onServe={() => serveOrder.mutateAsync(order.orderId)}
              claimBusy={claimOrder.isPending}
              collectBusy={collectOrder.isPending}
              serveBusy={serveOrder.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MyOrdersTab() {
  const { data: orders = [], isLoading, error, refetch } = useServiceBoard('mine');
  const collectOrder = useCollectOrder();
  const serveOrder = useServeOrder();

  if (isLoading) return <p className="py-16 text-center text-sm font-bold text-ink-muted">Loading orders...</p>;
  if (error) return <ErrorState message={error.message} onRetry={refetch} />;

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-ink-muted">{orders.length} order{orders.length !== 1 ? 's' : ''} claimed</p>
        <button onClick={() => refetch()} className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-black hover:bg-muted transition-colors">
          Refresh
        </button>
      </div>

      {orders.length === 0 ? (
        <EmptyState message="No orders claimed yet" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {orders.map((order) => (
            <OrderCard
              key={order.orderId}
              order={order}
              onCollect={() => collectOrder.mutateAsync({ orderId: order.orderId })}
              onServe={() => serveOrder.mutateAsync(order.orderId)}
              collectBusy={collectOrder.isPending}
              serveBusy={serveOrder.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AllOrdersTab() {
  const { data: orders = [], isLoading, error, refetch } = useServiceBoard('all');
  const claimOrder = useClaimOrder();
  const collectOrder = useCollectOrder();
  const serveOrder = useServeOrder();

  if (isLoading) return <p className="py-16 text-center text-sm font-bold text-ink-muted">Loading orders...</p>;
  if (error) return <ErrorState message={error.message} onRetry={refetch} />;

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-ink-muted">{orders.length} order{orders.length !== 1 ? 's' : ''}</p>
        <button onClick={() => refetch()} className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-black hover:bg-muted transition-colors">
          Refresh
        </button>
      </div>

      {orders.length === 0 ? (
        <EmptyState message="No orders" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {orders.map((order) => (
            <OrderCard
              key={order.orderId}
              order={order}
              onClaim={() => claimOrder.mutateAsync(order.orderId)}
              onCollect={() => collectOrder.mutateAsync({ orderId: order.orderId })}
              onServe={() => serveOrder.mutateAsync(order.orderId)}
              claimBusy={claimOrder.isPending}
              collectBusy={collectOrder.isPending}
              serveBusy={serveOrder.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NotificationsTab() {
  const { data: notifications = [], isLoading, error, refetch } = useServiceNotifications();

  if (isLoading) return <p className="py-16 text-center text-sm font-bold text-ink-muted">Loading notifications...</p>;
  if (error) return <ErrorState message={error.message} onRetry={refetch} />;

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-ink-muted">{notifications.length} notification{notifications.length !== 1 ? 's' : ''}</p>
        <button onClick={() => refetch()} className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-black hover:bg-muted transition-colors">
          Refresh
        </button>
      </div>

      {notifications.length === 0 ? (
        <EmptyState message="No notifications" />
      ) : (
        <div className="space-y-3">
          {notifications.map((n) => (
            <div key={n.id} className={`rounded-2xl border p-4 ${n.status === 'UNREAD' ? 'border-brand/30 bg-brand/5' : 'border-line bg-white'}`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-black">{n.type === 'STATION_READY' ? 'Station ready' : n.type}</p>
                  <p className="mt-1 text-xs text-ink-muted">Order {n.orderId.slice(0, 8)} · {n.collectionLabelSnapshot}</p>
                </div>
                <span className="text-[10px] text-ink-muted">{new Date(n.createdAt).toLocaleTimeString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface OrderCardProps {
  order: ServiceBoardOrder;
  onClaim?: () => void;
  onCollect?: () => void;
  onServe?: () => void;
  claimBusy?: boolean;
  collectBusy?: boolean;
  serveBusy?: boolean;
}

function OrderCard({ order, onClaim, onCollect, onServe, claimBusy, collectBusy, serveBusy }: OrderCardProps) {
  const [showDetail, setShowDetail] = useState(false);

  return (
    <>
      <article className="rounded-2xl border border-line bg-white p-5 shadow-sm transition hover:shadow-md">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-black">#{order.orderNumber}</h3>
              {order.tableLabel && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-black">{order.tableLabel}</span>
              )}
              <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-black uppercase">{order.orderType}</span>
            </div>
            {order.assignedWaiterName && (
              <p className="mt-1 text-xs text-ink-muted">Assigned to: {order.assignedWaiterName}</p>
            )}
          </div>
          <StatusChip status={chipStatus(order.fulfillmentStatus)}>
            {fulfillmentLabel(order.fulfillmentStatus)}
          </StatusChip>
        </div>

        <div className="mt-3 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-ink-muted">Ready:</span>
            <span className="font-bold">{order.readyAllocations}/{order.totalAllocations}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-muted">Collected:</span>
            <span className="font-bold">{order.collectedAllocations}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-muted">Served:</span>
            <span className="font-bold">{order.servedAllocations}</span>
          </div>
        </div>

        {order.outstandingStations.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {order.outstandingStations.map((s) => (
              <span key={s} className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-800">{s}</span>
            ))}
          </div>
        )}

        {order.collectionPoints.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {order.collectionPoints.map((cp) => (
              <span key={cp} className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-800">{cp}</span>
            ))}
          </div>
        )}

        {order.blockingReason && (
          <p className="mt-2 text-xs text-ink-muted">{order.blockingReason}</p>
        )}

        {order.readyAge !== null && (
          <p className="mt-2 text-[10px] font-bold text-ink-muted">Ready for {formatElapsed(order.readyAge)}</p>
        )}

        <div className="mt-4 flex gap-2">
          {order.canClaim && onClaim && (
            <Button onClick={onClaim} disabled={claimBusy} className="flex-1">
              {claimBusy ? 'Claiming...' : 'Claim'}
            </Button>
          )}
          {order.canCollect && onCollect && (
            <Button onClick={onCollect} disabled={collectBusy} className="flex-1">
              {collectBusy ? 'Collecting...' : 'Collect'}
            </Button>
          )}
          {order.canServe && onServe && (
            <Button onClick={onServe} disabled={serveBusy} className="flex-1">
              {serveBusy ? 'Serving...' : 'Serve'}
            </Button>
          )}
          <Button variant="secondary" onClick={() => setShowDetail(true)} className="flex-1">
            Details
          </Button>
        </div>
      </article>

      {showDetail && (
        <Dialog open onOpenChange={(o) => { if (!o) setShowDetail(false); }}>
          <DialogContent className="max-w-lg" aria-label={`Order ${order.orderNumber} detail`}>
            <DialogTitle>Order #{order.orderNumber}</DialogTitle>
            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs font-black text-ink-muted">Type</p>
                  <p className="font-bold">{order.orderType}</p>
                </div>
                <div>
                  <p className="text-xs font-black text-ink-muted">Table</p>
                  <p className="font-bold">{order.tableLabel ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs font-black text-ink-muted">Assigned waiter</p>
                  <p className="font-bold">{order.assignedWaiterName ?? 'Unassigned'}</p>
                </div>
                <div>
                  <p className="text-xs font-black text-ink-muted">Version</p>
                  <p className="font-bold">{order.version}</p>
                </div>
              </div>

              <div>
                <p className="text-xs font-black text-ink-muted mb-2">Allocations</p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-surface p-3">
                    <p className="text-lg font-black">{order.readyAllocations}</p>
                    <p className="text-[10px] font-bold text-ink-muted">Ready</p>
                  </div>
                  <div className="rounded-xl bg-surface p-3">
                    <p className="text-lg font-black">{order.collectedAllocations}</p>
                    <p className="text-[10px] font-bold text-ink-muted">Collected</p>
                  </div>
                  <div className="rounded-xl bg-surface p-3">
                    <p className="text-lg font-black">{order.servedAllocations}</p>
                    <p className="text-[10px] font-bold text-ink-muted">Served</p>
                  </div>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="grid min-h-72 place-items-center rounded-2xl border border-dashed border-line bg-white/60 text-center">
      <div>
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-muted text-xl">🍽</span>
        <p className="mt-4 text-lg font-black">{message}</p>
        <p className="mt-2 text-sm text-ink-muted">Orders will appear here when kitchen tickets are ready.</p>
      </div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="grid min-h-[400px] place-items-center">
      <div className="text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-red-100 text-xl">⚠</span>
        <h2 className="mt-4 font-black">Failed to load</h2>
        <p className="mt-2 text-sm text-ink-muted">{message}</p>
        <button onClick={onRetry} className="mt-4 rounded-xl bg-dark px-5 py-3 text-sm font-black text-white">
          Try again
        </button>
      </div>
    </div>
  );
}
