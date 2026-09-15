'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { apiRequest } from '@/lib/api-client';

interface KitchenTicketTimeline {
  ticketId: string;
  stationName: string;
  kitchenName: string;
  ticketNumber: string;
  status: string;
  startedAt: string | null;
  readyAt: string | null;
  collectedAt: string | null;
  servedAt: string | null;
  completedAt: string | null;
  lines: Array<{
    itemName: string;
    quantity: number;
    isRequired: boolean;
  }>;
}

interface FulfillmentTimelineProps {
  orderId: string;
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function elapsedMinutes(start: string | null, end: string | null): string | null {
  if (!start) return null;
  const endTime = end ? new Date(end).getTime() : Date.now();
  const mins = Math.floor((endTime - new Date(start).getTime()) / 60000);
  if (mins < 1) return '<1m';
  return `${mins}m`;
}

function statusStep(status: string): number {
  switch (status) {
    case 'QUEUED': return 0;
    case 'IN_PROGRESS': return 1;
    case 'READY': return 2;
    case 'COLLECTED': return 3;
    case 'SERVED': return 4;
    case 'COMPLETED': return 5;
    default: return 0;
  }
}

const TIMELINE_STEPS = [
  { key: 'QUEUED', label: 'Queued', icon: '📋' },
  { key: 'IN_PROGRESS', label: 'Preparing', icon: '🔥' },
  { key: 'READY', label: 'Ready', icon: '✅' },
  { key: 'COLLECTED', label: 'Collected', icon: '🤝' },
  { key: 'SERVED', label: 'Served', icon: '🍽' },
];

export function FulfillmentTimeline({ orderId }: FulfillmentTimelineProps) {
  const { accessToken, csrfToken, profile } = useAuth();
  const [tickets, setTickets] = useState<KitchenTicketTimeline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const tenantId = profile?.memberships?.[0]?.tenant.id;

  useEffect(() => {
    if (!accessToken || !tenantId) return;
    let cancelled = false;

    async function fetchTickets() {
      try {
        const res = await apiRequest<{ data: KitchenTicketTimeline[] }>(
          `/orders/${orderId}/kitchen-tickets`,
          { accessToken, csrfToken, tenantId }
        );
        if (!cancelled) setTickets(res.data);
      } catch {
        if (!cancelled) setError('Could not load fulfillment timeline');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchTickets();
    return () => { cancelled = true; };
  }, [orderId, accessToken, csrfToken, tenantId]);

  if (loading) {
    return (
      <div className="rounded-panel border border-line bg-white shadow-card p-6">
        <h3 className="text-sm font-black">Fulfillment timeline</h3>
        <p className="mt-4 text-sm text-ink-muted animate-pulse">Loading timeline...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-panel border border-line bg-white shadow-card p-6">
        <h3 className="text-sm font-black">Fulfillment timeline</h3>
        <p className="mt-4 text-sm text-ink-muted">{error}</p>
      </div>
    );
  }

  if (tickets.length === 0) {
    return (
      <div className="rounded-panel border border-line bg-white shadow-card p-6">
        <h3 className="text-sm font-black">Fulfillment timeline</h3>
        <p className="mt-4 text-sm text-ink-muted">No kitchen tickets for this order yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-panel border border-line bg-white shadow-card p-6">
      <h3 className="text-sm font-black">Fulfillment timeline</h3>
      <div className="mt-4 space-y-4">
        {tickets.map((ticket) => {
          const currentStep = statusStep(ticket.status);
          return (
            <div key={ticket.ticketId} className="rounded-xl border border-line p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-black">#{ticket.ticketNumber}</span>
                  <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-black">{ticket.stationName}</span>
                  <span className="text-[10px] text-ink-muted">{ticket.kitchenName}</span>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
                  currentStep >= 4 ? 'bg-emerald-100 text-emerald-700' :
                  currentStep >= 2 ? 'bg-blue-100 text-blue-700' :
                  'bg-slate-100 text-slate-700'
                }`}>
                  {ticket.status.replace('_', ' ')}
                </span>
              </div>

              <div className="flex items-center gap-1 mb-3">
                {TIMELINE_STEPS.map((step, i) => {
                  const isComplete = currentStep >= i;
                  const isCurrent = currentStep === i;
                  return (
                    <div key={step.key} className="flex items-center flex-1">
                      <div className={`flex items-center gap-1 ${i > 0 ? 'ml-1' : ''}`}>
                        <span className={`text-xs ${isCurrent ? 'font-black' : isComplete ? 'font-bold' : 'font-normal text-ink-muted'}`}>
                          {step.icon}
                        </span>
                      </div>
                      {i < TIMELINE_STEPS.length - 1 && (
                        <div className={`flex-1 h-0.5 mx-1 rounded ${isComplete ? 'bg-brand' : 'bg-line'}`} />
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="grid grid-cols-4 gap-2 text-[10px] text-ink-muted">
                <div>
                  <p className="font-black">Started</p>
                  <p>{formatTime(ticket.startedAt)}</p>
                  {ticket.startedAt && <p className="text-brand font-bold">{elapsedMinutes(ticket.startedAt, ticket.readyAt)} prep</p>}
                </div>
                <div>
                  <p className="font-black">Ready</p>
                  <p>{formatTime(ticket.readyAt)}</p>
                </div>
                <div>
                  <p className="font-black">Collected</p>
                  <p>{formatTime(ticket.collectedAt)}</p>
                </div>
                <div>
                  <p className="font-black">Served</p>
                  <p>{formatTime(ticket.servedAt)}</p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-1">
                {ticket.lines.map((line, i) => (
                  <span key={i} className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${line.isRequired ? 'bg-surface text-ink' : 'bg-surface text-ink-muted'}`}>
                    {line.quantity}× {line.itemName}
                    {!line.isRequired && <span className="ml-0.5 text-ink-muted">(opt)</span>}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
