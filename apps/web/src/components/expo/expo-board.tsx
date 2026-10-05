'use client';

import { useMemo } from 'react';
import { useAuth } from '@/components/auth-provider';
import { useExpoOrders } from '@/lib/use-expo';
import { useFulfillmentLive } from '@/lib/use-fulfillment-live';
import { ExpoOrderCard } from '@/components/expo/expo-order-card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

export function ExpoBoard() {
  const { profile } = useAuth();
  const { data: orders = [], isLoading, error, refetch } = useExpoOrders();

  const allowedRoles = ['OWNER', 'MANAGER', 'KITCHEN_STAFF'];
  const membership = profile?.memberships?.[0];
  const role = membership?.role;
  const permitted = Boolean(role && allowedRoles.includes(role));
  const live = useFulfillmentLive(permitted);

  const releasableOrders = useMemo(() => orders.filter((o) => o.canRelease), [orders]);
  const allOrders = useMemo(() => orders, [orders]);
  const completedOrders = useMemo(() => orders.filter((o) => o.fulfillmentStatus === 'READY_FOR_SERVICE' || o.fulfillmentStatus === 'PARTIALLY_SERVED'), [orders]);
  if (!permitted) {
    return <p role="alert" className="p-8 text-center text-sm font-bold text-red-700">Permission denied.</p>;
  }

  if (isLoading) {
    return <p className="py-16 text-center text-sm font-bold text-ink-muted">Loading expo orders...</p>;
  }

  if (error) {
    return (
      <div className="grid min-h-[400px] place-items-center">
        <div className="text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-red-100 text-xl">⚠</span>
          <h2 className="mt-4 font-black">Failed to load orders</h2>
          <p className="mt-2 text-sm text-ink-muted">{error.message}</p>
          <button onClick={() => refetch()} className="mt-4 rounded-xl bg-dark px-5 py-3 text-sm font-black text-white">
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[.18em] text-brand">Expo</p>
          <h1 className="mt-1 text-2xl font-black tracking-tight">Order Display</h1>
          <p className="mt-1 text-sm text-ink-muted">Monitor and release orders for service.</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={live.reconnect} className="min-h-11 rounded-lg border border-line px-3 text-xs font-bold" aria-label="Reconnect live updates">
            {live.status === 'connected' ? 'Live updates' : 'Polling · reconnect'}
          </button>
          <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-700">
            {releasableOrders.length} ready to release
          </span>
          <button onClick={() => refetch()} className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-black hover:bg-muted transition-colors">
            Refresh
          </button>
        </div>
      </div>

      <Tabs defaultValue="ready">
        <TabsList>
          <TabsTrigger value="ready">Ready ({releasableOrders.length})</TabsTrigger>
          <TabsTrigger value="all">All ({allOrders.length})</TabsTrigger>
          <TabsTrigger value="completed">Completed ({completedOrders.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="ready">
          {releasableOrders.length === 0 ? (
            <EmptyState message="No orders ready for release" />
          ) : (
            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {releasableOrders.map((order) => (
                <ExpoOrderCard key={order.orderId} order={order} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="all">
          {allOrders.length === 0 ? (
            <EmptyState message="No orders in the expo" />
          ) : (
            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {allOrders.map((order) => (
                <ExpoOrderCard key={order.orderId} order={order} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="completed">
          {completedOrders.length === 0 ? (
            <EmptyState message="No completed orders" />
          ) : (
            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {completedOrders.map((order) => (
                <ExpoOrderCard key={order.orderId} order={order} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="mt-4 grid min-h-72 place-items-center rounded-2xl border border-dashed border-line bg-white/60 text-center">
      <div>
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-muted text-xl">👁</span>
        <p className="mt-4 text-lg font-black">{message}</p>
        <p className="mt-2 text-sm text-ink-muted">Orders will appear here when kitchen tickets are ready.</p>
      </div>
    </div>
  );
}
