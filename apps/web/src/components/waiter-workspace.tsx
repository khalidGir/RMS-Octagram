'use client';

import { useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { useFulfillmentLive } from '@/lib/use-fulfillment-live';
import { useServiceBoard, useClaimOrder, useCollectOrder, useServeOrder, useServiceNotifications } from '@/lib/use-service-board';
import { useServiceRequests, useServiceRequestAction, type StaffServiceRequest, type ServiceRequestActionKind } from '@/lib/use-service-requests';
import { Button, Dialog, DialogContent, DialogTitle, StatusChip, Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui';
import { useLocale, type MessageKey } from '@/components/locale-provider';
import { orderTypeKeys, labelFor } from '@/lib/status-labels';
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

function fulfillmentKey(s: string): MessageKey | null {
  switch (s) {
    case 'ALL_READY': return 'waiter.stAllReady';
    case 'PARTIALLY_READY': return 'waiter.stPartiallyReady';
    case 'QUEUED': return 'status.kdsQueued';
    case 'IN_PROGRESS': return 'status.kdsInProgress';
    case 'READY_FOR_SERVICE': return 'waiter.stReadyForService';
    case 'PARTIALLY_SERVED': return 'waiter.stPartiallyServed';
    case 'CANCELLED': return 'status.kdsCancelled';
    default: return null;
  }
}

export function WaiterWorkspace() {
  const { profile } = useAuth();
  const [tab, setTab] = useState('ready');
  const { tr } = useLocale();

  const membership = profile?.memberships?.[0];
  const role = membership?.role;
  const live = useFulfillmentLive(role === 'WAITER' || role === 'OWNER');
  if (!role || (role !== 'WAITER' && role !== 'OWNER')) {
    return <p role="alert" className="p-8 text-center text-sm font-bold text-red-700">{tr('waiter.permissionDenied')}</p>;
  }

  return (
    <main className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-dark-deep px-4 py-4 text-white shadow-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold text-white/60">{membership?.tenant.name}</p>
            <h1 className="text-xl font-black">{tr('waiter.boardTitle')}</h1>
          </div>
          <button onClick={live.reconnect} aria-label={tr('waiter.reconnectAria')} className="min-h-11 rounded-full border border-white/30 px-3 py-2 text-xs font-black">
            {live.status === 'connected' ? tr('waiter.liveUpdates') : tr('waiter.pollingReconnect')}
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="ready">{tr('waiter.tabReady')}</TabsTrigger>
            <TabsTrigger value="mine">{tr('waiter.tabMine')}</TabsTrigger>
            <TabsTrigger value="all">{tr('waiter.tabAll')}</TabsTrigger>
            <TabsTrigger value="notifications">{tr('waiter.tabNotifications')}</TabsTrigger>
            <TabsTrigger value="requests">{tr('waiter.tabRequests')}</TabsTrigger>
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

          <TabsContent value="requests">
            <ServiceRequestsTab />
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
  const { tr } = useLocale();

  const readyOrders = orders.filter((o) => o.canCollect || o.canServe || o.readyAllocations > 0);

  if (isLoading) return <p className="py-16 text-center text-sm font-bold text-ink-muted">{tr('waiter.loadingOrders')}</p>;
  if (error) return <ErrorState message={error.message} onRetry={refetch} />;

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-ink-muted">{tr('waiter.readyCount', { count: readyOrders.length })}</p>
        <button onClick={() => refetch()} className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-black hover:bg-muted transition-colors">
          {tr('waiter.refresh')}
        </button>
      </div>

      {readyOrders.length === 0 ? (
        <EmptyState message={tr('waiter.emptyReady')} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {readyOrders.map((order) => (
            <OrderCard
              key={order.orderId}
              order={order}
              onClaim={() => claimOrder.mutateAsync(order.orderId)}
              onCollect={() => collectOrder.mutateAsync({ orderId: order.orderId, expectedVersion: order.version })}
              onServe={() => serveOrder.mutateAsync({ orderId: order.orderId, expectedVersion: order.version })}
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
  const { tr } = useLocale();

  if (isLoading) return <p className="py-16 text-center text-sm font-bold text-ink-muted">{tr('waiter.loadingOrders')}</p>;
  if (error) return <ErrorState message={error.message} onRetry={refetch} />;

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-ink-muted">{tr('waiter.claimedCount', { count: orders.length })}</p>
        <button onClick={() => refetch()} className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-black hover:bg-muted transition-colors">
          {tr('waiter.refresh')}
        </button>
      </div>

      {orders.length === 0 ? (
        <EmptyState message={tr('waiter.emptyMine')} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {orders.map((order) => (
            <OrderCard
              key={order.orderId}
              order={order}
              onCollect={() => collectOrder.mutateAsync({ orderId: order.orderId, expectedVersion: order.version })}
              onServe={() => serveOrder.mutateAsync({ orderId: order.orderId, expectedVersion: order.version })}
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
  const { tr } = useLocale();

  if (isLoading) return <p className="py-16 text-center text-sm font-bold text-ink-muted">{tr('waiter.loadingOrders')}</p>;
  if (error) return <ErrorState message={error.message} onRetry={refetch} />;

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-ink-muted">{tr('waiter.orderCount', { count: orders.length })}</p>
        <button onClick={() => refetch()} className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-black hover:bg-muted transition-colors">
          {tr('waiter.refresh')}
        </button>
      </div>

      {orders.length === 0 ? (
        <EmptyState message={tr('waiter.emptyAll')} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {orders.map((order) => (
            <OrderCard
              key={order.orderId}
              order={order}
              onClaim={() => claimOrder.mutateAsync(order.orderId)}
              onCollect={() => collectOrder.mutateAsync({ orderId: order.orderId, expectedVersion: order.version })}
              onServe={() => serveOrder.mutateAsync({ orderId: order.orderId, expectedVersion: order.version })}
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
  const { tr, formatTime } = useLocale();

  if (isLoading) return <p className="py-16 text-center text-sm font-bold text-ink-muted">{tr('waiter.loadingNotifications')}</p>;
  if (error) return <ErrorState message={error.message} onRetry={refetch} />;

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-ink-muted">{tr('waiter.notificationCount', { count: notifications.length })}</p>
        <button onClick={() => refetch()} className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-black hover:bg-muted transition-colors">
          {tr('waiter.refresh')}
        </button>
      </div>

      {notifications.length === 0 ? (
        <EmptyState message={tr('waiter.emptyNotifications')} />
      ) : (
        <div className="space-y-3">
          {notifications.map((n) => (
            <div key={n.id} className={`rounded-2xl border p-4 ${n.status === 'UNREAD' ? 'border-brand/30 bg-brand/5' : 'border-line bg-white'}`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-black">{n.type === 'STATION_READY' ? tr('waiter.stationReady') : n.type}</p>
                  <p className="mt-1 text-xs text-ink-muted">{tr('waiter.notifOrderPrefix', { id: n.orderId.slice(0, 8), label: n.collectionLabelSnapshot ?? '' })}</p>
                </div>
                <span className="text-[10px] text-ink-muted">{formatTime(n.createdAt)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function serviceRequestChip(s: string): 'idle' | 'active' | 'warning' | 'danger' | 'success' | 'info' {
  switch (s) {
    case 'OPEN': return 'warning';
    case 'CLAIMED': return 'active';
    case 'ESCALATED': return 'danger';
    default: return 'idle';
  }
}

function serviceRequestLabelKey(request: StaffServiceRequest): MessageKey {
  if (request.type === 'CALL_WAITER') return 'ordering.callWaiter';
  if (request.type === 'REQUEST_BILL') return 'ordering.requestBill';
  return 'ordering.assistanceGroup';
}

function ServiceRequestsTab() {
  const { data: requests = [], isLoading, error, refetch } = useServiceRequests();
  const action = useServiceRequestAction();
  const { profile } = useAuth();
  const { tr, formatTime } = useLocale();
  const [actionError, setActionError] = useState<string | null>(null);

  const membership = profile?.memberships?.[0];
  const role = membership?.role;
  const isWaiterOnly = role === 'WAITER';
  const me = profile?.id;

  function run(request: StaffServiceRequest, kind: ServiceRequestActionKind) {
    setActionError(null);
    action.mutate(
      { requestId: request.id, action: kind, expectedVersion: request.version },
      { onError: () => setActionError(tr('waiter.reqActionFailed')) },
    );
  }

  if (isLoading) return <p className="py-16 text-center text-sm font-bold text-ink-muted">{tr('waiter.loadingOrders')}</p>;
  if (error) return <ErrorState message={error.message} onRetry={refetch} />;

  return (
    <div className="mt-4">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-ink-muted">{tr('waiter.reqCount', { count: requests.length })}</p>
        <button onClick={() => refetch()} className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-black transition-colors hover:bg-muted">
          {tr('waiter.refresh')}
        </button>
      </div>
      {actionError && (
        <p role="alert" className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-800">{actionError}</p>
      )}

      {requests.length === 0 ? (
        <EmptyState message={tr('waiter.reqEmpty')} />
      ) : (
        <div className="space-y-3">
          {requests.map((request) => {
            const statusKey =
              request.status === 'CLAIMED'
                ? tr('waiter.reqStatusClaimed')
                : request.status === 'ESCALATED'
                  ? tr('waiter.reqStatusEscalated')
                  : tr('waiter.reqStatusOpen');
            const canClaim =
              (request.status === 'OPEN' || request.status === 'ESCALATED') &&
              (!isWaiterOnly || !request.assignedWaiterUserId || request.assignedWaiterUserId === me);
            const canResolve = request.status === 'CLAIMED' && (!isWaiterOnly || request.claimedByUserId === me);
            const canCancel =
              request.status !== 'RESOLVED' &&
              request.status !== 'CANCELLED' &&
              (!isWaiterOnly || request.claimedByUserId === me || request.assignedWaiterUserId === me);
            const age = Math.max(0, Math.floor((Date.now() - new Date(request.createdAt).getTime()) / 1000));

            return (
              <article key={request.id} className="rounded-2xl border border-line bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-black">{tr(serviceRequestLabelKey(request))}</h3>
                      {request.tableLabel && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-black">{request.tableLabel}</span>
                      )}
                      {request.orderNumber !== null && (
                        <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-black">#{request.orderNumber}</span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-ink-muted">
                      {formatElapsed(age)} · {formatTime(request.createdAt)}
                      {request.claimedByUserId === me ? ` · ${tr('waiter.reqMine')}` : ''}
                    </p>
                    {request.note && <p className="mt-1 text-sm text-ink-muted">{request.note}</p>}
                  </div>
                  <StatusChip status={serviceRequestChip(request.status)}>{statusKey}</StatusChip>
                </div>

                <div className="mt-4 flex gap-2">
                  {canClaim && (
                    <Button onClick={() => run(request, 'claim')} disabled={action.isPending} className="flex-1">
                      {action.isPending ? tr('waiter.claiming') : tr('waiter.claim')}
                    </Button>
                  )}
                  {canResolve && (
                    <Button onClick={() => run(request, 'resolve')} disabled={action.isPending} className="flex-1">
                      {tr('waiter.reqResolve')}
                    </Button>
                  )}
                  {canCancel && (
                    <Button variant="secondary" onClick={() => run(request, 'cancel')} disabled={action.isPending} className="flex-1">
                      {tr('waiter.reqCancel')}
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
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
  const { tr } = useLocale();
  const fKey = fulfillmentKey(order.fulfillmentStatus);

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
              <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-black uppercase">{labelFor(orderTypeKeys, order.orderType, tr)}</span>
            </div>
            {order.assignedWaiterName && (
              <p className="mt-1 text-xs text-ink-muted">{tr('waiter.assignedTo', { name: order.assignedWaiterName })}</p>
            )}
          </div>
          <StatusChip status={chipStatus(order.fulfillmentStatus)}>
            {fKey ? tr(fKey) : order.fulfillmentStatus}
          </StatusChip>
        </div>

        <div className="mt-3 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-ink-muted">{tr('waiter.readyLabel')}</span>
            <span className="font-bold">{order.readyAllocations}/{order.totalAllocations}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-muted">{tr('waiter.collectedLabel')}</span>
            <span className="font-bold">{order.collectedAllocations}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-muted">{tr('waiter.servedLabel')}</span>
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
          <p className="mt-2 text-[10px] font-bold text-ink-muted">{tr('waiter.readyFor', { duration: formatElapsed(order.readyAge) })}</p>
        )}

        <div className="mt-4 flex gap-2">
          {order.canClaim && onClaim && (
            <Button onClick={onClaim} disabled={claimBusy} className="flex-1">
              {claimBusy ? tr('waiter.claiming') : tr('waiter.claim')}
            </Button>
          )}
          {order.canCollect && onCollect && (
            <Button onClick={onCollect} disabled={collectBusy} className="flex-1">
              {collectBusy ? tr('waiter.collecting') : tr('waiter.collect')}
            </Button>
          )}
          {order.canServe && onServe && (
            <Button onClick={onServe} disabled={serveBusy} className="flex-1">
              {serveBusy ? tr('waiter.serving') : tr('waiter.serve')}
            </Button>
          )}
          <Button variant="secondary" onClick={() => setShowDetail(true)} className="flex-1">
            {tr('waiter.details')}
          </Button>
        </div>
      </article>

      {showDetail && (
        <Dialog open onOpenChange={(o) => { if (!o) setShowDetail(false); }}>
          <DialogContent className="max-w-lg" aria-label={tr('waiter.detailAria', { order: order.orderNumber })}>
            <DialogTitle>{tr('waiter.detailTitle', { order: order.orderNumber })}</DialogTitle>
            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs font-black text-ink-muted">{tr('waiter.dType')}</p>
                  <p className="font-bold">{labelFor(orderTypeKeys, order.orderType, tr)}</p>
                </div>
                <div>
                  <p className="text-xs font-black text-ink-muted">{tr('waiter.dTable')}</p>
                  <p className="font-bold">{order.tableLabel ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs font-black text-ink-muted">{tr('waiter.dAssignedWaiter')}</p>
                  <p className="font-bold">{order.assignedWaiterName ?? tr('waiter.unassigned')}</p>
                </div>
                <div>
                  <p className="text-xs font-black text-ink-muted">{tr('waiter.dVersion')}</p>
                  <p className="font-bold">{order.version}</p>
                </div>
              </div>

              <div>
                <p className="text-xs font-black text-ink-muted mb-2">{tr('waiter.allocations')}</p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-surface p-3">
                    <p className="text-lg font-black">{order.readyAllocations}</p>
                    <p className="text-[10px] font-bold text-ink-muted">{tr('waiter.readyShort')}</p>
                  </div>
                  <div className="rounded-xl bg-surface p-3">
                    <p className="text-lg font-black">{order.collectedAllocations}</p>
                    <p className="text-[10px] font-bold text-ink-muted">{tr('waiter.collectedShort')}</p>
                  </div>
                  <div className="rounded-xl bg-surface p-3">
                    <p className="text-lg font-black">{order.servedAllocations}</p>
                    <p className="text-[10px] font-bold text-ink-muted">{tr('waiter.servedShort')}</p>
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
  const { tr } = useLocale();
  return (
    <div className="grid min-h-72 place-items-center rounded-2xl border border-dashed border-line bg-white/60 text-center">
      <div>
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-muted text-xl">🍽</span>
        <p className="mt-4 text-lg font-black">{message}</p>
        <p className="mt-2 text-sm text-ink-muted">{tr('waiter.emptyHint')}</p>
      </div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { tr } = useLocale();
  return (
    <div className="grid min-h-[400px] place-items-center">
      <div className="text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-red-100 text-xl">⚠</span>
        <h2 className="mt-4 font-black">{tr('waiter.failedToLoad')}</h2>
        <p className="mt-2 text-sm text-ink-muted">{message}</p>
        <button onClick={onRetry} className="mt-4 rounded-xl bg-dark px-5 py-3 text-sm font-black text-white">
          {tr('common.tryAgain')}
        </button>
      </div>
    </div>
  );
}
