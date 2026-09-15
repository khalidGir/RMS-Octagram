'use client';

import { useState } from 'react';
import { useReleaseOrder, useRecallExpoOrder } from '@/lib/use-expo';
import { Button, Dialog, DialogContent, DialogTitle, TextField, StatusChip } from '@/components/ui';
import type { ExpoOrder } from '@/lib/fulfillment-types';

function formatElapsed(seconds: number | null): string {
  if (seconds === null) return '--';
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

function chipStatus(status: string): 'idle' | 'active' | 'success' | 'warning' | 'danger' | 'info' {
  switch (status) {
    case 'READY': return 'success';
    case 'IN_PROGRESS': return 'active';
    case 'QUEUED': return 'warning';
    case 'COMPLETED': return 'info';
    case 'CANCELLED': return 'danger';
    default: return 'idle';
  }
}

function fulfillmentStatusLabel(s: string): string {
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

interface ExpoOrderCardProps {
  order: ExpoOrder;
}

export function ExpoOrderCard({ order }: ExpoOrderCardProps) {
  const releaseOrder = useReleaseOrder();
  const recallOrder = useRecallExpoOrder();
  const [showDetail, setShowDetail] = useState(false);
  const [recallReason, setRecallReason] = useState('');
  const [showRecallDialog, setShowRecallDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRelease() {
    setBusy(true);
    setError(null);
    try {
      await releaseOrder.mutateAsync({ orderId: order.orderId, expectedVersion: order.version });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not release order.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRecall() {
    if (!recallReason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await recallOrder.mutateAsync({ orderId: order.orderId, reason: recallReason.trim(), expectedVersion: order.version });
      setShowRecallDialog(false);
      setRecallReason('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not recall order.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <article
        className={`rounded-2xl border-2 p-5 shadow-sm transition hover:shadow-md cursor-pointer ${
          order.canRelease ? 'border-emerald-400 bg-emerald-50/50' : 'border-line bg-white'
        }`}
        onClick={() => setShowDetail(true)}
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-black">#{order.orderNumber}</h3>
              {order.tableLabel && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-black">{order.tableLabel}</span>
              )}
              <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-black uppercase">{order.orderType}</span>
            </div>
            {order.customerName && (
              <p className="mt-1 text-sm text-ink-muted">{order.customerName}</p>
            )}
          </div>
          <StatusChip status={chipStatus(order.fulfillmentStatus)}>
            {fulfillmentStatusLabel(order.fulfillmentStatus)}
          </StatusChip>
        </div>

        <div className="mt-4 space-y-2">
          {order.stations.map((station) => (
            <div key={station.stationId} className="flex items-center justify-between rounded-xl bg-surface/50 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className={`size-2 rounded-full ${station.status === 'READY' ? 'bg-emerald-500' : station.status === 'IN_PROGRESS' ? 'bg-blue-500' : 'bg-slate-400'}`} />
                <span className="text-xs font-black">{station.stationName}</span>
                <span className="text-[10px] text-ink-muted">{station.kitchenName}</span>
                {!station.isRequired && (
                  <span className="rounded bg-surface px-1.5 py-0.5 text-[9px] font-black text-ink-muted">OPTIONAL</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-ink-muted">{station.collectionLabel}</span>
                <StatusChip status={chipStatus(station.status ?? 'QUEUED')}>
                  {station.status === 'READY' ? 'Ready' : station.status === 'IN_PROGRESS' ? 'In progress' : String(station.status ?? 'Unknown')}
                </StatusChip>
                <span className="text-[10px] font-bold text-ink-muted">{formatElapsed(station.elapsed)}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between text-xs text-ink-muted">
          <span>{order.readyCount}/{order.totalRequired} ready</span>
          {order.isReleased && <span className="font-bold text-emerald-700">Released</span>}
        </div>

        <div className="mt-3 flex gap-2" onClick={(e) => e.stopPropagation()}>
          {order.canRelease && (
            <Button onClick={handleRelease} disabled={busy} className="flex-1">
              {busy ? 'Releasing...' : 'Release for service'}
            </Button>
          )}
          {order.canRecall && (
            <Button variant="danger" onClick={() => setShowRecallDialog(true)} className="flex-1">
              Recall
            </Button>
          )}
          {!order.canRelease && !order.canRecall && (
            <p className="text-xs text-ink-muted">
              Not ready for release
            </p>
          )}
        </div>

        {error && (
          <div role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">{error}</div>
        )}
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
                  <p className="text-xs font-black text-ink-muted">Status</p>
                  <StatusChip status={chipStatus(order.fulfillmentStatus)}>
                    {fulfillmentStatusLabel(order.fulfillmentStatus)}
                  </StatusChip>
                </div>
                <div>
                  <p className="text-xs font-black text-ink-muted">Version</p>
                  <p className="font-bold">{order.version}</p>
                </div>
              </div>

              <div>
                <p className="text-xs font-black text-ink-muted mb-2">Station tickets</p>
                <div className="space-y-2">
                  {order.stations.map((station) => (
                    <div key={station.stationId} className="rounded-xl border border-line p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`size-2 rounded-full ${station.status === 'READY' ? 'bg-emerald-500' : 'bg-blue-500'}`} />
                          <span className="text-sm font-black">{station.stationName}</span>
                          <span className="text-xs text-ink-muted">{station.kitchenName}</span>
                        </div>
                        <StatusChip status={chipStatus(String(station.status))}>
                          {String(station.status)}
                        </StatusChip>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs text-ink-muted">
                        <span>Collection: {station.collectionLabel}</span>
                        <span>Elapsed: {formatElapsed(station.elapsed)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {showRecallDialog && (
        <Dialog open onOpenChange={(o) => { if (!o) { setShowRecallDialog(false); setRecallReason(''); } }}>
          <DialogContent className="max-w-md" aria-label="Recall order">
            <DialogTitle>Recall order #{order.orderNumber}</DialogTitle>
            <p className="mt-2 text-sm text-ink-muted">Enter a reason for recalling this order from service.</p>
            <TextField
              label="Reason"
              value={recallReason}
              onChange={(e) => setRecallReason(e.target.value)}
              placeholder="e.g. Customer requested change"
              className="mt-4"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => { setShowRecallDialog(false); setRecallReason(''); }}>Cancel</Button>
              <Button variant="danger" onClick={handleRecall} disabled={busy || !recallReason.trim()}>
                {busy ? 'Recalling...' : 'Recall'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
