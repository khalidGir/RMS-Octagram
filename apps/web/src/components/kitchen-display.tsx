'use client';

import { useMemo, useState } from 'react';
import { useKdsTickets, type KdsTicket, type KdsStation } from '@/lib/use-kds-tickets';
import { useKitchens } from '@/lib/use-kitchen-config';
import { useOnlineStatus } from '@/hooks';
import { useLocale, type MessageKey } from '@/components/locale-provider';
import { kdsStatusKeys, labelFor } from '@/lib/status-labels';

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

function ticketAgeMinutes(ticket: KdsTicket): number {
  return ticket.startedAt ? elapsedMinutes(ticket.startedAt) : elapsedMinutes(ticket.createdAt);
}

function slaProgress(startedAt: string | null, targetMinutes: number): number {
  if (!startedAt) return 0;
  const elapsed = elapsedMinutes(startedAt);
  return Math.min(100, Math.round((elapsed / targetMinutes) * 100));
}

function slaColor(progress: number): string {
  if (progress >= 100) return 'bg-red-500';
  if (progress >= 75) return 'bg-amber-500';
  return 'bg-emerald-500';
}

function ticketAgeClass(ticket: KdsTicket): string {
  const mins = ticketAgeMinutes(ticket);
  if (mins >= 20) return 'border-red-300/60 bg-red-50/50';
  if (mins >= 12) return 'border-amber-300/60 bg-amber-50/50';
  return 'border-black/[.06] bg-white';
}

function ageTextClass(mins: number): string {
  if (mins >= 20) return 'text-red-600 font-semibold';
  if (mins >= 12) return 'text-amber-700 font-semibold';
  return 'text-ink-muted font-medium';
}

function statusTint(status: string): string {
  switch (status) {
    case 'READY': return 'bg-emerald-100/80 text-emerald-900';
    case 'QUEUED': return 'bg-slate-100 text-slate-800';
    default: return 'bg-blue-100/80 text-blue-900';
  }
}

function nextBumpKey(status: string): MessageKey {
  switch (status) {
    case 'QUEUED': return 'kitchen.bumpStart';
    case 'IN_PROGRESS': return 'kitchen.bumpReady';
    case 'READY': return 'kitchen.bumpComplete';
    default: return 'kitchen.bumpStart';
  }
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function AlertIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7.5v5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="16.4" r="1.1" fill="currentColor" />
    </svg>
  );
}

function ClocheIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M3 18h18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M5 15.5a7 7 0 0 1 14 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 8.5V6.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="5.6" r="1.2" fill="currentColor" />
    </svg>
  );
}

interface TicketCardProps {
  ticket: KdsTicket;
  onBump: (id: string, version: number) => void;
  onRecall: (id: string, version: number) => void;
  onComplete: (id: string, version: number) => void;
  onCancel: (id: string, version: number) => void;
}

function TicketCard({ ticket, onBump, onRecall, onComplete, onCancel }: TicketCardProps) {
  const { tr } = useLocale();
  const age = ticket.startedAt ? formatElapsed(ticket.startedAt) : formatElapsed(ticket.createdAt);
  const ageMins = ticketAgeMinutes(ticket);
  const canBump = ticket.status === 'QUEUED' || ticket.status === 'IN_PROGRESS';
  const canRecall = ticket.status === 'READY';
  const canComplete = ticket.status === 'READY';
  const canCancel = ticket.status === 'QUEUED' || ticket.status === 'IN_PROGRESS';
  const ageClass = ticketAgeClass(ticket);

  const progress = slaProgress(ticket.startedAt, 15);

  return (
    <div
      data-ticket={ticket.id}
      className={`rounded-xl border-2 overflow-hidden shadow-card transition-shadow hover:shadow-[0_2px_6px_rgba(0,0,0,0.06),0_12px_28px_rgba(0,0,0,0.08)] ${ageClass}`}
    >
      <div className={`flex items-center justify-between gap-2 border-b border-black/[.05] px-4 py-2.5 ${statusTint(ticket.status)}`}>
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[17px] font-semibold leading-none tabular-nums">#{ticket.ticketNumber}</span>
          {ticket.orderNumber && (
            <span className="truncate text-[11px] font-medium opacity-75">{tr('kitchen.orderPrefix', { order: ticket.orderNumber })}</span>
          )}
          {ticket.tableId && (
            <span className="rounded-md bg-black/[.06] px-1.5 py-0.5 text-[10px] font-medium">{tr('kitchen.tableBadge')}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {ticket.estimatedReadyAt && (
            <span className="text-[10px] font-medium opacity-60">{tr('kitchen.estPrefix', { value: formatElapsed(ticket.estimatedReadyAt) })}</span>
          )}
          <span className={`rounded-md bg-white/70 px-1.5 py-0.5 text-xs tabular-nums ${ageTextClass(ageMins)}`}>{age}</span>
        </div>
      </div>

      {ticket.status === 'IN_PROGRESS' && (
        <div className="h-1 w-full bg-black/[.05]" aria-hidden="true">
          <div className={`h-full transition-all duration-500 ${slaColor(progress)}`} style={{ width: `${progress}%` }} />
        </div>
      )}

      <div className="px-4 py-3">
        <div className="mb-2.5 flex flex-wrap items-center gap-2">
          {ticket.stationName && (
            <span className="rounded-md bg-black/[.05] px-2 py-0.5 text-[10px] font-medium text-ink-muted">{ticket.stationName}</span>
          )}
          {ticket.customerName && (
            <span className="text-[11px] font-medium text-ink-muted">{ticket.customerName}</span>
          )}
        </div>

        <ul className="space-y-2">
          {(ticket.lines ?? []).map((line) => (
            <li key={line.id} className="flex items-start gap-2.5 text-sm">
              <span className="mt-0.5 rounded-md bg-black/[.06] px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-ink">
                {line.quantity}×
              </span>
              <div className="min-w-0 flex-1">
                <span className="font-semibold text-[15px]">{line.itemName ?? tr('kitchen.itemFallback')}</span>
                {line.variantName && line.variantName !== 'Regular' && (
                  <span className="font-medium text-ink-muted"> ({line.variantName})</span>
                )}
                {line.notes && (
                  <p className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-amber-500/[.08] px-2.5 py-1.5 text-[11px] font-medium text-amber-800">
                    <AlertIcon className="mt-px size-3.5 shrink-0" />
                    <span className="min-w-0 truncate">{line.notes}</span>
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex gap-1.5 border-t border-black/[.05] p-2">
        {canBump && (
          <button
            onClick={() => onBump(ticket.id, ticket.version)}
            aria-label={tr('kitchen.bumpTicketAria', { action: tr(nextBumpKey(ticket.status)), order: ticket.orderNumber ?? '' })}
            className="flex-1 rounded-lg bg-blue-600 py-2.5 text-xs font-semibold text-white transition hover:bg-blue-700 active:scale-[0.98]"
          >
            {tr(nextBumpKey(ticket.status))} →
          </button>
        )}
        {canComplete && (
          <button
            onClick={() => onComplete(ticket.id, ticket.version)}
            aria-label={tr('kitchen.completeTicketAria', { order: ticket.orderNumber ?? '' })}
            className="flex-1 rounded-lg bg-emerald-700 py-2.5 text-xs font-semibold text-white transition hover:bg-emerald-800 active:scale-[0.98]"
          >
            {tr('kitchen.completeBtn')}
          </button>
        )}
        {canRecall && (
          <button
            onClick={() => onRecall(ticket.id, ticket.version)}
            aria-label={tr('kitchen.recallTicketAria', { order: ticket.orderNumber ?? '' })}
            className="flex-1 rounded-lg py-2.5 text-xs font-semibold text-amber-700 transition hover:bg-amber-500/[.08] active:scale-[0.98]"
          >
            {tr('kitchen.recallBtn')}
          </button>
        )}
        {canCancel && (
          <button
            onClick={() => onCancel(ticket.id, ticket.version)}
            aria-label={tr('kitchen.cancelTicketAria', { order: ticket.orderNumber ?? '' })}
            className="flex-1 rounded-lg py-2.5 text-xs font-semibold text-red-600 transition hover:bg-red-500/[.08] active:scale-[0.98]"
          >
            {tr('kitchen.cancel')}
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
  const { tr } = useLocale();
  if (socketStatus === 'connected' && isOnline) return null;

  const message = !isOnline
    ? tr('kitchen.connOffline')
    : socketStatus === 'connecting'
    ? tr('kitchen.connReconnecting')
    : socketStatus === 'error'
    ? tr('kitchen.connError')
    : tr('kitchen.connDisconnected');

  return (
    <div className={`flex items-center justify-between gap-3 border-b border-black/[.05] px-4 py-2.5 text-[13px] font-medium ${!isOnline ? 'bg-red-500/[.07] text-red-700' : 'bg-amber-500/[.08] text-amber-800'}`}>
      <span>{message}</span>
      <button onClick={onReconnect} className="rounded-lg bg-white px-3 py-1 text-xs font-semibold shadow-sm transition hover:bg-black/[.03]">
        {tr('kitchen.connRetry')}
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
  const { tr } = useLocale();
  if (loading && tickets.length === 0) {
    return (
      <div className="grid min-h-[400px] place-items-center">
        <div className="text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-black/[.04] text-ink-muted">
            <SpinnerIcon className="size-6" />
          </span>
          <h2 className="mt-4 text-base font-semibold">{tr('kitchen.loadingTickets')}</h2>
          <p className="mt-1.5 text-sm text-ink-muted">{tr('kitchen.syncDisplay')}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="grid min-h-[400px] place-items-center">
        <div className="text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-red-500/10 text-red-600">
            <AlertIcon className="size-7" />
          </span>
          <h2 className="mt-4 text-base font-semibold">{tr('kitchen.ticketsLoadFailed')}</h2>
          <p className="mt-1.5 text-sm text-ink-muted">{error}</p>
          <button onClick={onRetry} className="mt-4 rounded-xl bg-dark px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-dark-deep">
            {tr('common.tryAgain')}
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
  { status: 'QUEUED', label: 'Queued', color: 'bg-slate-400' },
  { status: 'IN_PROGRESS', label: 'In progress', color: 'bg-blue-500' },
  { status: 'READY', label: 'Ready', color: 'bg-emerald-500' },
] as const;

export function KitchenDisplay({ branchId }: KitchenDisplayProps) {
  const isOnline = useOnlineStatus();
  const { tr } = useLocale();

  const [selectedKitchenId, setSelectedKitchenId] = useState<string | null>(null);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);

  const { data: kitchens = [] } = useKitchens();

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
    kitchenId: selectedKitchenId,
    stationId: selectedStationId,
  });

  const stationMap = useMemo(() => {
    const map = new Map<string, KdsStation>();
    for (const s of stations) map.set(s.id, s);
    return map;
  }, [stations]);

  const filteredStations = useMemo(() => {
    if (!selectedKitchenId) return stations;
    return stations.filter((s) => s.kitchenId === selectedKitchenId);
  }, [stations, selectedKitchenId]);

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

  const totalByStatus = useMemo(() => ({
    QUEUED: ticketsByStatus.QUEUED.length,
    IN_PROGRESS: ticketsByStatus.IN_PROGRESS.length,
    READY: ticketsByStatus.READY.length,
  }), [ticketsByStatus]);

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
    <div className="flex h-full flex-col bg-canvas">
      <ConnectionBar socketStatus={socketStatus} isOnline={isOnline} onReconnect={reconnect} />

      <header className="flex items-center justify-between gap-3 border-b border-black/[.06] bg-white/70 px-4 py-2.5 backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="text-[17px] font-semibold tracking-tight">{tr('kitchen.displayTitle')}</h1>
          {activeStation && (
            <span className="rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-semibold text-brand">{activeStation.name}</span>
          )}
          <div className="flex items-center gap-3 ms-1">
            {LANE_CONFIGS.map((lane) => (
              <span key={lane.status} className="flex items-center gap-1.5 text-[11px] font-medium text-ink-muted">
                <span className={`size-1.5 rounded-full ${lane.color}`} aria-hidden="true" />
                {totalByStatus[lane.status]} {labelFor(kdsStatusKeys, lane.status, tr)}
              </span>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button onClick={() => refetch()} className="rounded-lg bg-black/[.05] px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-black/[.09]">
            {tr('kitchen.refresh')}
          </button>
          <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${socketStatus === 'connected' ? 'bg-emerald-500/10 text-emerald-700' : 'bg-amber-500/10 text-amber-700'}`}>
            <span className={`size-1.5 rounded-full ${socketStatus === 'connected' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} aria-hidden="true" />
            {socketStatus === 'connected' ? tr('kitchen.live') : tr('kitchen.polling')}
          </span>
        </div>
      </header>

      <nav className="overflow-x-auto border-b border-black/[.05] px-4 py-2.5">
        <div className="flex w-max gap-1 rounded-full bg-black/[.05] p-1">
          <button
            onClick={() => { setSelectedKitchenId(null); setSelectedStationId(null); }}
            aria-pressed={selectedKitchenId === null && selectedStationId === null}
            className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-[12px] font-medium transition ${selectedKitchenId === null && selectedStationId === null ? 'bg-white text-ink shadow-[0_1px_3px_rgba(0,0,0,0.1)]' : 'text-ink-muted hover:text-ink'}`}
          >
            {tr('kitchen.allKitchens')}
          </button>
          {kitchens.map((kitchen) => (
            <button
              key={kitchen.id}
              onClick={() => { setSelectedKitchenId(kitchen.id); setSelectedStationId(null); }}
              aria-pressed={selectedKitchenId === kitchen.id}
              className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-[12px] font-medium transition ${selectedKitchenId === kitchen.id ? 'bg-white text-ink shadow-[0_1px_3px_rgba(0,0,0,0.1)]' : 'text-ink-muted hover:text-ink'}`}
            >
              {kitchen.name}
            </button>
          ))}
        </div>
      </nav>

      {selectedKitchenId && filteredStations.length > 0 && (
        <nav className="overflow-x-auto border-b border-black/[.05] px-4 py-2">
          <div className="flex w-max gap-1 rounded-full bg-black/[.05] p-1">
            <button
              onClick={() => setSelectedStationId(null)}
              aria-pressed={selectedStationId === null}
              className={`whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-medium transition ${selectedStationId === null ? 'bg-white text-ink shadow-[0_1px_3px_rgba(0,0,0,0.1)]' : 'text-ink-muted hover:text-ink'}`}
            >
              {tr('kitchen.allStations')}
            </button>
            {filteredStations.map((station) => (
              <button
                key={station.id}
                onClick={() => setSelectedStationId(station.id)}
                aria-pressed={selectedStationId === station.id}
                className={`whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-medium transition ${selectedStationId === station.id ? 'bg-white text-ink shadow-[0_1px_3px_rgba(0,0,0,0.1)]' : 'text-ink-muted hover:text-ink'}`}
              >
                {station.name}
              </button>
            ))}
          </div>
        </nav>
      )}

      <ConnectionState loading={loading} error={error} tickets={tickets} onRetry={refetch} />

      {!loading && !error && tickets.length === 0 && (
        <div className="grid min-h-[400px] place-items-center">
          <div className="text-center">
            <span className="mx-auto grid size-16 place-items-center rounded-full bg-black/[.04] text-ink-muted">
              <ClocheIcon className="size-7" />
            </span>
            <h2 className="mt-4 text-base font-semibold">{tr('kitchen.noTickets')}</h2>
            <p className="mt-1.5 text-sm text-ink-muted">{tr('kitchen.noTicketsHint')}</p>
          </div>
        </div>
      )}

      {tickets.length > 0 && (
        <div className="flex-1 overflow-x-auto p-4">
          <div className="grid grid-cols-3 gap-4 min-w-[900px] h-full">
            {LANE_CONFIGS.map((lane) => (
              <section
                key={lane.status}
                aria-label={labelFor(kdsStatusKeys, lane.status, tr)}
                className="flex min-h-0 flex-col"
              >
                <div className="mb-3 flex items-center justify-between px-1">
                  <div className="flex items-center gap-2">
                    <span className={`size-2 rounded-full ${lane.color}`} aria-hidden="true" />
                    <h2 className="text-[13px] font-semibold text-ink">{labelFor(kdsStatusKeys, lane.status, tr)}</h2>
                  </div>
                  <span className="text-[13px] font-medium tabular-nums text-ink-muted">{ticketsByStatus[lane.status].length}</span>
                </div>
                <div className="hide-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto pe-1">
                  {ticketsByStatus[lane.status].length === 0 && (
                    <div className="rounded-xl bg-black/[.03] px-4 py-10 text-center">
                      <p className="text-[13px] font-medium text-ink-muted">{tr('kitchen.laneEmpty')}</p>
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
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
