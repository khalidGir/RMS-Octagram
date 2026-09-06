'use client';

import { useMemo, useState } from 'react';
import { useKdsTickets, type KdsTicket, type KdsStation } from '@/lib/use-kds-tickets';
import { useOnlineStatus } from '@/hooks';

function elapsedMinutes(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}

function formatElapsed(iso: string | null): string {
  if (!iso) return '--';
  const mins = elapsedMinutes(iso);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

function ticketAgeClass(ticket: KdsTicket): string {
  const mins = ticket.startedAt ? elapsedMinutes(ticket.startedAt) : elapsedMinutes(ticket.createdAt);
  if (mins >= 20) return 'border-red-400 bg-red-50';
  if (mins >= 12) return 'border-amber-400 bg-amber-50/50';
  return 'border-line bg-white';
}

function statusLabel(status: string): string {
  switch (status) {
    case 'QUEUED': return 'Queued';
    case 'IN_PROGRESS': return 'In progress';
    case 'READY': return 'Ready';
    case 'COMPLETED': return 'Completed';
    case 'CANCELLED': return 'Cancelled';
    default: return status;
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'QUEUED': return 'bg-slate-100 text-slate-700';
    case 'IN_PROGRESS': return 'bg-blue-100 text-blue-700';
    case 'READY': return 'bg-emerald-100 text-emerald-700';
    case 'COMPLETED': return 'bg-stone-100 text-stone-600';
    case 'CANCELLED': return 'bg-red-100 text-red-600';
    default: return 'bg-stone-100 text-stone-600';
  }
}

function nextBumpLabel(status: string): string {
  switch (status) {
    case 'QUEUED': return 'Start';
    case 'IN_PROGRESS': return 'Ready';
    case 'READY': return 'Complete';
    default: return '';
  }
}

interface TicketCardProps {
  ticket: KdsTicket;
  onBump: (id: string, version: number) => void;
  onRecall: (id: string, version: number) => void;
  onComplete: (id: string, version: number) => void;
  onCancel: (id: string, version: number) => void;
}

function TicketCard({ ticket, onBump, onRecall, onComplete, onCancel }: TicketCardProps) {
  const age = ticket.startedAt ? formatElapsed(ticket.startedAt) : formatElapsed(ticket.createdAt);
  const canBump = ticket.status === 'QUEUED' || ticket.status === 'IN_PROGRESS';
  const canRecall = ticket.status === 'READY';
  const canComplete = ticket.status === 'READY';
  const canCancel = ticket.status === 'QUEUED' || ticket.status === 'IN_PROGRESS';
  const ageClass = ticketAgeClass(ticket);

  return (
    <div className={`rounded-xl border-2 overflow-hidden shadow-sm ${ageClass}`}>
      <div className={`flex items-center justify-between px-4 py-3 ${ticket.status === 'READY' ? 'bg-emerald-600 text-white' : ticket.status === 'QUEUED' ? 'bg-dark-muted text-white' : 'bg-blue-600 text-white'}`}>
        <div className="flex items-center gap-3">
          <span className="text-lg font-black">#{ticket.ticketNumber}</span>
          {ticket.orderNumber && (
            <span className="text-xs font-bold opacity-80">Order {ticket.orderNumber}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {ticket.estimatedReadyAt && (
            <span className="text-xs font-bold opacity-70">Est. {formatElapsed(ticket.estimatedReadyAt)}</span>
          )}
          <span className="text-sm font-black">{age}</span>
        </div>
      </div>

      <div className="px-4 py-3">
        <div className="flex items-center gap-2 mb-2">
          {ticket.tableId && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-black">Table</span>
          )}
          {ticket.customerName && (
            <span className="text-xs font-bold text-ink-muted">{ticket.customerName}</span>
          )}
          <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-black ${statusColor(ticket.status)}`}>
            {statusLabel(ticket.status)}
          </span>
        </div>

        <div className="space-y-1.5">
          {(ticket.lines ?? []).map((line) => (
            <div key={line.id} className="flex items-start justify-between text-sm">
              <div className="flex-1 min-w-0">
                <span className="font-black">{line.quantity}×</span>{' '}
                <span className="font-bold">{line.itemName ?? 'Item'}</span>
                {line.variantName && line.variantName !== 'Regular' && (
                  <span className="text-ink-muted"> ({line.variantName})</span>
                )}
                {line.notes && (
                  <p className="mt-0.5 rounded bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800 truncate">
                    {line.notes}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex border-t border-line divide-x divide-line">
        {canBump && (
          <button
            onClick={() => onBump(ticket.id, ticket.version)}
            aria-label={`${nextBumpLabel(ticket.status)} ticket ${ticket.orderNumber}`}
            className="flex-1 bg-dark-muted py-3 text-xs font-black text-white hover:bg-dark-muted transition-colors"
          >
            {nextBumpLabel(ticket.status)} →
          </button>
        )}
        {canComplete && (
          <button
            onClick={() => onComplete(ticket.id, ticket.version)}
            aria-label={`Complete ticket ${ticket.orderNumber}`}
            className="flex-1 bg-emerald-600 py-3 text-xs font-black text-white hover:bg-emerald-700 transition-colors"
          >
            Complete ✓
          </button>
        )}
        {canRecall && (
          <button
            onClick={() => onRecall(ticket.id, ticket.version)}
            aria-label={`Recall ticket ${ticket.orderNumber}`}
            className="flex-1 bg-amber-500 py-3 text-xs font-black text-white hover:bg-amber-600 transition-colors"
          >
            Recall ←
          </button>
        )}
        {canCancel && (
          <button
            onClick={() => onCancel(ticket.id, ticket.version)}
            aria-label={`Cancel ticket ${ticket.orderNumber}`}
            className="flex-1 bg-white py-3 text-xs font-black text-red-600 hover:bg-red-50 transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

interface ConnectionBarProps {
  socketStatus: string;
  isOnline: boolean;
  onReconnect: () => void;
}

function ConnectionBar({ socketStatus, isOnline, onReconnect }: ConnectionBarProps) {
  if (socketStatus === 'connected' && isOnline) return null;

  const message = !isOnline
    ? 'Offline — changes will sync when connection returns'
    : socketStatus === 'connecting'
    ? 'Reconnecting…'
    : socketStatus === 'error'
    ? 'Connection error — retry'
    : 'Disconnected — retry';

  return (
    <div className={`flex items-center justify-between px-4 py-2.5 text-sm font-bold ${!isOnline ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
      <span>{message}</span>
      <button onClick={onReconnect} className="rounded-lg bg-white/60 px-3 py-1 text-xs font-black hover:bg-white/80 transition-colors">
        Retry
      </button>
    </div>
  );
}

interface ConnectionStateProps {
  loading: boolean;
  error: string | null;
  tickets: KdsTicket[];
  onRetry: () => void;
}

function ConnectionState({ loading, error, tickets, onRetry }: ConnectionStateProps) {
  if (loading && tickets.length === 0) {
    return (
      <div className="grid min-h-[400px] place-items-center">
        <div className="text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-muted text-xl animate-pulse">◇</span>
          <h2 className="mt-4 font-black">Loading tickets…</h2>
          <p className="mt-2 text-sm text-ink-muted">Synchronizing kitchen display</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="grid min-h-[400px] place-items-center">
        <div className="text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-red-100 text-xl">⚠</span>
          <h2 className="mt-4 font-black">Failed to load tickets</h2>
          <p className="mt-2 text-sm text-ink-muted">{error}</p>
          <button onClick={onRetry} className="mt-4 rounded-xl bg-dark px-5 py-3 text-sm font-black text-white">
            Try again
          </button>
        </div>
      </div>
    );
  }

  return null;
}

interface KitchenDisplayProps {
  branchId: string;
}

const LANE_CONFIGS = [
  { status: 'QUEUED', label: 'Queued', color: 'bg-slate-500' },
  { status: 'IN_PROGRESS', label: 'In progress', color: 'bg-blue-500' },
  { status: 'READY', label: 'Ready', color: 'bg-emerald-500' },
] as const;

export function KitchenDisplay({ branchId }: KitchenDisplayProps) {
  const isOnline = useOnlineStatus();

  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);

  const {
    tickets,
    stations,
    loading,
    error,
    socketStatus,
    refetch,
    reconnect,
    bumpTicket,
    recallTicket,
    completeTicket,
    cancelTicket,
  } = useKdsTickets({
    branchId,
    stationId: selectedStationId,
  });

  const stationMap = useMemo(() => {
    const map = new Map<string, KdsStation>();
    for (const s of stations) map.set(s.id, s);
    return map;
  }, [stations]);

  const activeStation = selectedStationId ? stationMap.get(selectedStationId) : null;

  const ticketsByStatus = useMemo(() => {
    const grouped: Record<string, KdsTicket[]> = {
      QUEUED: [],
      IN_PROGRESS: [],
      READY: [],
    };
    for (const ticket of tickets) {
      if (ticket.status in grouped) {
        grouped[ticket.status].push(ticket);
      }
    }
    return grouped;
  }, [tickets]);

  const handleBump = async (id: string, version: number) => {
    try { await bumpTicket(id, version); } catch { /* handled in hook */ }
  };
  const handleRecall = async (id: string, version: number) => {
    try { await recallTicket(id, version, 'Kitchen recall'); } catch { /* handled in hook */ }
  };
  const handleComplete = async (id: string, version: number) => {
    try { await completeTicket(id, version); } catch { /* handled in hook */ }
  };
  const handleCancel = async (id: string, version: number) => {
    try { await cancelTicket(id, version, 'Cancelled by kitchen'); } catch { /* handled in hook */ }
  };

  return (
    <div className="flex flex-col h-full">
      <ConnectionBar socketStatus={socketStatus} isOnline={isOnline} onReconnect={reconnect} />

      <div className="flex items-center justify-between px-4 py-3 border-b border-line bg-white/60">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-black">Kitchen Display</h1>
          {activeStation && (
            <span className="rounded-full bg-brand px-3 py-1 text-xs font-black text-white">{activeStation.name}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refetch()} className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-black hover:bg-muted transition-colors">
            Refresh
          </button>
          <span className={`rounded-full px-3 py-1.5 text-xs font-black ${socketStatus === 'connected' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
            {socketStatus === 'connected' ? '● Live' : '○ Polling'}
          </span>
        </div>
      </div>

      {stations.length > 0 && (
        <div className="flex gap-2 px-4 py-3 border-b border-line bg-white/40 overflow-x-auto">
          <button
            onClick={() => setSelectedStationId(null)}
            aria-pressed={selectedStationId === null}
            className={`whitespace-nowrap rounded-full px-4 py-2 text-xs font-black transition-colors ${selectedStationId === null ? 'bg-dark text-white' : 'bg-white border border-line hover:bg-muted'}`}
          >
            All stations
          </button>
          {stations.map((station) => (
            <button
              key={station.id}
              onClick={() => setSelectedStationId(station.id)}
              aria-pressed={selectedStationId === station.id}
              className={`whitespace-nowrap rounded-full px-4 py-2 text-xs font-black transition-colors ${selectedStationId === station.id ? 'bg-dark text-white' : 'bg-white border border-line hover:bg-muted'}`}
            >
              {station.name}
            </button>
          ))}
        </div>
      )}

      <ConnectionState loading={loading} error={error} tickets={tickets} onRetry={refetch} />

      {!loading && !error && tickets.length === 0 && (
        <div className="grid min-h-[400px] place-items-center">
          <div className="text-center">
            <span className="mx-auto grid size-12 place-items-center rounded-full bg-muted text-xl">🍳</span>
            <h2 className="mt-4 font-black">No tickets yet</h2>
            <p className="mt-2 text-sm text-ink-muted">Kitchen tickets will appear here when orders are confirmed</p>
          </div>
        </div>
      )}

      {tickets.length > 0 && (
        <div className="flex-1 overflow-x-auto p-4">
          <div className="grid grid-cols-3 gap-4 min-w-[900px] h-full">
            {LANE_CONFIGS.map((lane) => (
              <div key={lane.status} className="flex flex-col min-h-0">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className={`size-2.5 rounded-full ${lane.color}`} />
                    <h2 className="text-xs font-black tracking-wider uppercase">{lane.label}</h2>
                  </div>
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs font-black shadow-sm">
                    {ticketsByStatus[lane.status].length}
                  </span>
                </div>
                <div className="flex-1 space-y-3 overflow-y-auto hide-scrollbar">
                  {ticketsByStatus[lane.status].length === 0 && (
                    <div className="grid min-h-[120px] place-items-center rounded-xl border-2 border-dashed border-line bg-white/50">
                      <p className="text-xs font-bold text-ink-muted">Empty</p>
                    </div>
                  )}
                  {ticketsByStatus[lane.status].map((ticket) => (
                    <TicketCard
                      key={ticket.id}
                      ticket={ticket}
                      onBump={handleBump}
                      onRecall={handleRecall}
                      onComplete={handleComplete}
                      onCancel={handleCancel}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
