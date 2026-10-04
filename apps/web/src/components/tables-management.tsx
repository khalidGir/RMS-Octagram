'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiRequest, type ApiEnvelope } from '@/lib/api-client';
import { useAuth } from './auth-provider';
import { useBranch } from './shell/branch-provider';
import { useLocale } from '@/components/locale-provider';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TableQrBatchDialog, TableQrDialog } from './table-qr';

/* -------------------------------------------------------------------------- */
/*                                   Types                                    */
/* -------------------------------------------------------------------------- */

interface DiningArea {
  id: string;
  name: string;
  sortOrder: number;
  _count?: { tables: number };
}
interface TableOccupancy {
  tableId: string;
  label: string;
  capacity: number;
  isActive: boolean;
  sessionId: string | null;
  sessionStatus: string | null;
  openOrderCount: number;
}
interface DiningSession {
  id: string;
  tableId: string;
  status: string;
  guestCount: number;
  openedAt: string;
  orderCount: number;
}

/* -------------------------------------------------------------------------- */
/*                           TablesManagement                                 */
/* -------------------------------------------------------------------------- */

export function TablesManagement() {
  const { accessToken, csrfToken, profile } = useAuth();
  const { branchId } = useBranch();
  const { tr } = useLocale();
  const membership = profile?.memberships[0];
  const tenantId = membership?.tenant.id ?? '';
  const [tab, setTab] = useState('tables');
  const [notice, setNotice] = useState<string | null>(null);
  const [showCreateArea, setShowCreateArea] = useState(false);
  const [showCreateTable, setShowCreateTable] = useState(false);
  const [showBatchQr, setShowBatchQr] = useState(false);
  const [qrTarget, setQrTarget] = useState<{ label: string; tableId: string; raw?: string } | null>(null);

  const queryClient = useQueryClient();
  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['tables', branchId] });
    queryClient.invalidateQueries({ queryKey: ['dining-areas', branchId] });
    queryClient.invalidateQueries({ queryKey: ['table-occupancy', branchId] });
    queryClient.invalidateQueries({ queryKey: ['dining-sessions', branchId] });
  };

  const areas = useQuery({
    queryKey: ['dining-areas', branchId],
    enabled: Boolean(accessToken && branchId),
    queryFn: async () =>
      (await apiRequest<ApiEnvelope<DiningArea[]>>(`/branches/${branchId}/dining-areas`, { accessToken, tenantId })).data,
  });

  const occupancy = useQuery({
    queryKey: ['table-occupancy', branchId],
    enabled: Boolean(accessToken && branchId),
    queryFn: async () =>
      (await apiRequest<ApiEnvelope<TableOccupancy[]>>(`/branches/${branchId}/table-operations`, { accessToken, tenantId })).data,
  });

  const sessions = useQuery({
    queryKey: ['dining-sessions', branchId],
    enabled: Boolean(accessToken && branchId),
    queryFn: async () =>
      (await apiRequest<ApiEnvelope<DiningSession[]>>(`/branches/${branchId}/sessions`, { accessToken, tenantId })).data,
  });

  if (!membership || !['OWNER', 'MANAGER', 'CASHIER', 'WAITER'].includes(membership.role)) {
    return <p role="alert">{tr('tables.permissionDenied')}</p>;
  }

  if (!branchId) {
    return (
      <div className="grid min-h-72 place-items-center">
        <p className="text-sm font-bold text-ink-muted">{tr('tables.selectBranch')}</p>
      </div>
    );
  }

  const isManager = ['OWNER', 'MANAGER'].includes(membership.role);

  return (
    <>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[.18em] text-brand">{tr('tables.eyebrow')}</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">{tr('tables.pageTitle')}</h1>
          <p className="mt-2 text-sm text-ink-muted">
            {tr('tables.pageDescription')}
          </p>
        </div>
        {isManager && (
          <div className="flex gap-2">
            <button
              onClick={() => { setNotice(null); setShowCreateArea(true); }}
              className="min-h-11 rounded-xl border border-line bg-white px-4 text-sm font-bold"
            >
              {tr('tables.addAreaBtn')}
            </button>
            <button
              onClick={() => { setNotice(null); setShowBatchQr(true); }}
              disabled={occupancy.isLoading || (occupancy.data?.length ?? 0) === 0}
              className="min-h-11 rounded-xl border border-line bg-white px-4 text-sm font-bold disabled:opacity-50"
            >
              {tr('tables.batchQrBtn')}
            </button>
            <button
              onClick={() => { setNotice(null); setShowCreateTable(true); }}
              className="min-h-11 rounded-xl bg-dark px-5 text-sm font-bold text-white shadow-sm transition hover:bg-dark-muted"
            >
              {tr('tables.addTableBtn')}
            </button>
          </div>
        )}
      </div>

      {notice && (
        <div role="status" className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-900">
          {notice}
        </div>
      )}

      {(occupancy.isLoading || areas.isLoading) && (
        <p className="py-16 text-center text-sm font-bold text-ink-muted">{tr('tables.loading')}</p>
      )}

      {(occupancy.isError || areas.isError) && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">
          {tr('tables.loadError')}
        </div>
      )}

      {!occupancy.isLoading && !occupancy.isError && (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="tables">{tr('tables.tablesTab', { count: occupancy.data?.length ?? 0 })}</TabsTrigger>
            <TabsTrigger value="sessions">{tr('tables.sessionsTab', { count: sessions.data?.length ?? 0 })}</TabsTrigger>
            <TabsTrigger value="areas">{tr('tables.areasTab', { count: areas.data?.length ?? 0 })}</TabsTrigger>
          </TabsList>

          <TabsContent value="tables">
            <TablesGrid
              tables={occupancy.data ?? []}
              accessToken={accessToken!}
              csrfToken={csrfToken}
              tenantId={tenantId}
              branchId={branchId}
              isManager={isManager}
              onNotice={setNotice}
              onInvalidate={invalidateAll}
              onShowQr={(t) => setQrTarget({ label: t.label, tableId: t.tableId })}
            />
          </TabsContent>

          <TabsContent value="sessions">
            <SessionsList
              sessions={sessions.data ?? []}
              accessToken={accessToken!}
              csrfToken={csrfToken}
              tenantId={tenantId}
              branchId={branchId}
              isManager={isManager}
              onNotice={setNotice}
              onInvalidate={invalidateAll}
            />
          </TabsContent>

          <TabsContent value="areas">
            <AreasList
              areas={areas.data ?? []}
              accessToken={accessToken!}
              csrfToken={csrfToken}
              tenantId={tenantId}
              branchId={branchId}
              isManager={isManager}
              onNotice={setNotice}
              onInvalidate={invalidateAll}
            />
          </TabsContent>
        </Tabs>
      )}

      {showCreateArea && (
        <CreateAreaDialog
          accessToken={accessToken!}
          csrfToken={csrfToken}
          tenantId={tenantId}
          branchId={branchId}
          onClose={() => setShowCreateArea(false)}
          onCreated={async (name) => {
            setShowCreateArea(false);
            await areas.refetch();
            setNotice(tr('tables.areaCreated', { name }));
          }}
        />
      )}
      {showCreateTable && (
        <CreateTableDialog
          areas={areas.data ?? []}
          accessToken={accessToken!}
          csrfToken={csrfToken}
          tenantId={tenantId}
          branchId={branchId}
          onClose={() => setShowCreateTable(false)}
          onCreated={async (label, tableId, qrTokenRaw) => {
            setShowCreateTable(false);
            await occupancy.refetch();
            await areas.refetch();
            setNotice(tr('tables.tableCreated', { label }));
            if (qrTokenRaw) setQrTarget({ label, tableId, raw: qrTokenRaw });
          }}
        />
      )}
      {qrTarget && (
        <TableQrDialog
          label={qrTarget.label}
          tableId={qrTarget.tableId}
          initialRaw={qrTarget.raw}
          accessToken={accessToken!}
          csrfToken={csrfToken}
          tenantId={tenantId}
          branchId={branchId}
          onClose={() => setQrTarget(null)}
        />
      )}
      {showBatchQr && (
        <TableQrBatchDialog
          tables={(occupancy.data ?? []).map((t) => ({ tableId: t.tableId, label: t.label }))}
          accessToken={accessToken!}
          csrfToken={csrfToken}
          tenantId={tenantId}
          branchId={branchId}
          onClose={() => setShowBatchQr(false)}
        />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*                              TablesGrid                                    */
/* -------------------------------------------------------------------------- */

function TablesGrid({
  tables,
  accessToken,
  csrfToken,
  tenantId,
  branchId,
  isManager,
  onNotice,
  onInvalidate,
  onShowQr,
}: {
  tables: TableOccupancy[];
  accessToken: string;
  csrfToken: string | null;
  tenantId: string;
  branchId: string;
  isManager: boolean;
  onNotice: (msg: string | null) => void;
  onInvalidate: () => void;
  onShowQr: (table: TableOccupancy) => void;
}) {
  const { tr } = useLocale();
  const [editingTable, setEditingTable] = useState<TableOccupancy | null>(null);

  if (tables.length === 0) {
    return (
      <div className="mt-4 grid min-h-72 place-items-center rounded-2xl border border-dashed border-line bg-white/60 text-center">
        <div>
          <p className="text-lg font-black">{tr('tables.emptyTitle')}</p>
          <p className="mt-2 text-sm text-ink-muted">{tr('tables.emptyHint')}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {tables.map((t) => {
          const isOccupied = t.sessionStatus === 'OPEN';
        return (
            <div
              key={t.tableId}
              className={`rounded-2xl border bg-white p-5 shadow-sm transition hover:shadow-md ${
                !t.isActive ? 'opacity-50' : ''
              }`}
            >
              <div className="flex items-start justify-between">
                <span className="grid size-11 place-items-center rounded-xl bg-muted text-sm font-black">
                  {t.label}
                </span>
                <span
                  className={`h-fit rounded-full px-2 py-1 text-[10px] font-black ${
                    isOccupied
                      ? 'bg-amber-50 text-amber-800'
                      : 'bg-emerald-50 text-emerald-700'
                  }`}
                >
                  {isOccupied ? tr('tables.occupied') : t.isActive ? tr('tables.availableLabel') : tr('tables.inactiveLabel')}
                </span>
              </div>
              <h2 className="mt-4 font-black">{tr('tables.tableHeading', { label: t.label })}</h2>
              <p className="mt-1 text-sm text-ink-muted">
                {isOccupied
                  ? `${tr('tables.openOrdersCount', { count: t.openOrderCount })} Â· ${tr('tables.seatsCount', { count: t.capacity })}`
                  : tr('tables.seatsLabel', { count: t.capacity })}
              </p>
              {isManager && (
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setEditingTable(t)}
                    className="rounded-xl border border-line py-2 text-xs font-black"
                  >
                    {tr('tables.manageBtn')}
                  </button>
                  <button
                    onClick={() => onShowQr(t)}
                    className="rounded-xl border border-line py-2 text-xs font-black"
                  >
                    {tr('tables.qrBtn')}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {editingTable && (
        <EditTableDialog
          table={editingTable}
          accessToken={accessToken}
          csrfToken={csrfToken}
          tenantId={tenantId}
          branchId={branchId}
          onClose={() => setEditingTable(null)}
          onSaved={async () => {
            setEditingTable(null);
            onNotice(tr('tables.tableUpdated'));
            onInvalidate();
          }}
        />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*                             SessionsList                                   */
/* -------------------------------------------------------------------------- */

function SessionsList({
  sessions,
  accessToken,
  csrfToken,
  tenantId,
  branchId,
  isManager,
  onNotice,
  onInvalidate,
}: {
  sessions: DiningSession[];
  accessToken: string;
  csrfToken: string | null;
  tenantId: string;
  branchId: string;
  isManager: boolean;
  onNotice: (msg: string | null) => void;
  onInvalidate: () => void;
}) {
  const { formatTime, tr } = useLocale();
  const [clearingSession, setClearingSession] = useState<DiningSession | null>(null);

  if (sessions.length === 0) {
    return (
      <div className="mt-4 grid min-h-72 place-items-center rounded-2xl border border-dashed border-line bg-white/60 text-center">
        <div>
          <p className="text-lg font-black">{tr('tables.noSessionsTitle')}</p>
          <p className="mt-2 text-sm text-ink-muted">{tr('tables.noSessionsHint')}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="mt-4 space-y-3">
        {sessions.map((s) => (
          <div
            key={s.id}
            className="flex items-center justify-between rounded-2xl border border-black/[.07] bg-white px-5 py-4 shadow-sm"
          >
            <div>
              <p className="text-sm font-black">{tr('tables.sessionPrefix', { id: s.id.slice(0, 8) })}</p>
              <p className="mt-1 text-sm text-ink-muted">
                {tr('tables.guestCount', { count: s.guestCount })} Â· {tr('tables.sessionOrdersCount', { count: s.orderCount })} Â· {tr('tables.openedAt', { time: formatTime(s.openedAt) })}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-black text-amber-800">
                {s.status}
              </span>
              {isManager && s.status === 'OPEN' && (
                <button
                  onClick={() => setClearingSession(s)}
                  className="min-h-9 rounded-lg border border-line px-3 text-xs font-bold"
                >
                  {tr('tables.clearBtn')}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {clearingSession && (
        <ClearSessionDialog
          session={clearingSession}
          accessToken={accessToken}
          csrfToken={csrfToken}
          tenantId={tenantId}
          branchId={branchId}
          onClose={() => setClearingSession(null)}
          onCleared={async () => {
            setClearingSession(null);
            onNotice(tr('tables.sessionCleared'));
            onInvalidate();
          }}
        />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*                              AreasList                                     */
/* -------------------------------------------------------------------------- */

function AreasList({
  areas,
  accessToken,
  csrfToken,
  tenantId,
  branchId,
  isManager,
  onNotice,
  onInvalidate,
}: {
  areas: DiningArea[];
  accessToken: string;
  csrfToken: string | null;
  tenantId: string;
  branchId: string;
  isManager: boolean;
  onNotice: (msg: string | null) => void;
  onInvalidate: () => void;
}) {
  const { tr } = useLocale();
  const [editingArea, setEditingArea] = useState<DiningArea | null>(null);

  if (areas.length === 0) {
    return (
      <div className="mt-4 grid min-h-72 place-items-center rounded-2xl border border-dashed border-line bg-white/60 text-center">
        <div>
          <p className="text-lg font-black">{tr('tables.noAreasTitle')}</p>
          <p className="mt-2 text-sm text-ink-muted">{tr('tables.noAreasHint')}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="mt-4 space-y-3">
        {areas.map((area) => (
          <div
            key={area.id}
            className="flex items-center justify-between rounded-2xl border border-black/[.07] bg-white px-5 py-4 shadow-sm"
          >
            <div>
              <p className="text-sm font-black">{area.name}</p>
              <p className="mt-1 text-sm text-ink-muted">
                {tr('tables.areaTablesCount', { count: area._count?.tables ?? 0 })}
              </p>
            </div>
            {isManager && (
              <button
                onClick={() => setEditingArea(area)}
                className="min-h-9 rounded-lg border border-line px-3 text-xs font-bold"
              >
                {tr('tables.editBtn')}
              </button>
            )}
          </div>
        ))}
      </div>

      {editingArea && (
        <EditAreaDialog
          area={editingArea}
          accessToken={accessToken}
          csrfToken={csrfToken}
          tenantId={tenantId}
          branchId={branchId}
          onClose={() => setEditingArea(null)}
          onSaved={async () => {
            setEditingArea(null);
            onNotice(tr('tables.areaUpdated'));
            onInvalidate();
          }}
        />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*                            CreateAreaDialog                                */
/* -------------------------------------------------------------------------- */

function CreateAreaDialog({
  accessToken,
  csrfToken,
  tenantId,
  branchId,
  onClose,
  onCreated,
}: {
  accessToken: string;
  csrfToken: string | null;
  tenantId: string;
  branchId: string;
  onClose: () => void;
  onCreated: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { tr } = useLocale();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError(tr('tables.enterAreaName'));
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/branches/${branchId}/dining-areas`, {
        method: 'POST',
        accessToken,
        csrfToken,
        tenantId,
        body: { name: trimmed },
      });
      await onCreated(trimmed);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tr('tables.createAreaError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm" aria-label={tr('tables.addAreaTitle')}>
        <DialogTitle>{tr('tables.addAreaTitle')}</DialogTitle>
        <form onSubmit={submit} className="mt-4 grid gap-4">
          <label className="text-sm font-black">
            {tr('tables.areaNameLabel')}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              placeholder={tr('tables.areaNamePlaceholder')}
              className="mt-2 min-h-12 w-full rounded-xl border border-line bg-white px-4 font-normal outline-none focus:ring-2 focus:ring-brand/20"
              autoFocus
            />
          </label>
          {error && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="min-h-10 rounded-lg border border-line px-4 text-sm font-bold">
              {tr('common.cancel')}
            </button>
            <button disabled={busy || !name.trim()} className="min-h-10 rounded-lg bg-dark px-4 text-sm font-bold text-white disabled:opacity-50">
              {busy ? tr('tables.creating') : tr('tables.createAreaBtn')}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*                            CreateTableDialog                               */
/* -------------------------------------------------------------------------- */

function CreateTableDialog({
  areas,
  accessToken,
  csrfToken,
  tenantId,
  branchId,
  onClose,
  onCreated,
}: {
  areas: DiningArea[];
  accessToken: string;
  csrfToken: string | null;
  tenantId: string;
  branchId: string;
  onClose: () => void;
  onCreated: (label: string, tableId: string, qrTokenRaw?: string) => Promise<void>;
}) {
  const [label, setLabel] = useState('');
  const [capacity, setCapacity] = useState('4');
  const [diningAreaId, setDiningAreaId] = useState(areas[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { tr } = useLocale();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedLabel = label.trim();
    const cap = parseInt(capacity, 10);
    if (!trimmedLabel) return setError(tr('tables.enterTableLabel'));
    if (isNaN(cap) || cap < 1) return setError(tr('tables.capacityMin'));
    setBusy(true);
    setError(null);
    try {
      const response = await apiRequest<ApiEnvelope<{ id: string; qrTokenRaw?: string }>>(
        `/branches/${branchId}/tables`,
        {
          method: 'POST',
          accessToken,
          csrfToken,
          tenantId,
          body: { label: trimmedLabel, capacity: cap, diningAreaId: diningAreaId || undefined },
        },
      );
      await onCreated(trimmedLabel, response.data.id, response.data.qrTokenRaw);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tr('tables.createTableError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md" aria-label={tr('tables.addTableTitle')}>
        <DialogTitle>{tr('tables.addTableTitle')}</DialogTitle>
        <form onSubmit={submit} className="mt-4 grid gap-4">
          <label className="text-sm font-black">
            {tr('tables.tableLabelLabel')}
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={50}
              placeholder={tr('tables.tableLabelPlaceholder')}
              className="mt-2 min-h-12 w-full rounded-xl border border-line bg-white px-4 font-normal outline-none focus:ring-2 focus:ring-brand/20"
              autoFocus
            />
          </label>
          <div className="grid grid-cols-2 gap-4">
            <label className="text-sm font-black">
              {tr('tables.capacityLabel')}
              <input
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                inputMode="numeric"
                min={1}
                className="mt-2 min-h-12 w-full rounded-xl border border-line bg-white px-4 font-normal tabular-nums outline-none focus:ring-2 focus:ring-brand/20"
              />
            </label>
            <label className="text-sm font-black">
              {tr('tables.diningAreaLabel')}
              <div className="mt-2"><Select value={diningAreaId || 'none'} onValueChange={(value) => setDiningAreaId(value === 'none' ? '' : value)}><SelectTrigger className="min-h-12 font-normal"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">{tr('tables.noneOption')}</SelectItem>{areas.map((a) => <SelectItem value={a.id} key={a.id}>{a.name}</SelectItem>)}</SelectContent></Select></div>
            </label>
          </div>
          <p className="text-xs text-ink-muted">{tr('tables.qrHint')}</p>
          {error && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="min-h-10 rounded-lg border border-line px-4 text-sm font-bold">
              {tr('common.cancel')}
            </button>
            <button disabled={busy || !label.trim()} className="min-h-10 rounded-lg bg-dark px-4 text-sm font-bold text-white disabled:opacity-50">
              {busy ? tr('tables.creating') : tr('tables.createTableBtn')}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*                             EditTableDialog                                */
/* -------------------------------------------------------------------------- */

function EditTableDialog({
  table,
  accessToken,
  csrfToken,
  tenantId,
  branchId,
  onClose,
  onSaved,
}: {
  table: TableOccupancy;
  accessToken: string;
  csrfToken: string | null;
  tenantId: string;
  branchId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [label, setLabel] = useState(table.label);
  const [capacity, setCapacity] = useState(String(table.capacity));
  const [isActive, setIsActive] = useState(table.isActive);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { tr } = useLocale();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const cap = parseInt(capacity, 10);
    if (!label.trim()) return setError(tr('tables.enterTableLabel'));
    if (isNaN(cap) || cap < 1) return setError(tr('tables.capacityMin'));
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/branches/${branchId}/tables/${table.tableId}`, {
        method: 'PATCH',
        accessToken,
        csrfToken,
        tenantId,
        body: { label: label.trim(), capacity: cap, isActive },
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tr('tables.updateTableError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md" aria-label={tr('tables.editTable', { label: table.label })}>
        <DialogTitle>{tr('tables.editTable', { label: table.label })}</DialogTitle>
        <form onSubmit={submit} className="mt-4 grid gap-4">
          <label className="text-sm font-black">
            {tr('tables.tableLabelLabel')}
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={50}
              className="mt-2 min-h-12 w-full rounded-xl border border-line bg-white px-4 font-normal outline-none focus:ring-2 focus:ring-brand/20"
            />
          </label>
          <label className="text-sm font-black">
            {tr('tables.capacityLabel')}
            <input
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              inputMode="numeric"
              min={1}
              className="mt-2 min-h-12 w-full rounded-xl border border-line bg-white px-4 font-normal tabular-nums outline-none focus:ring-2 focus:ring-brand/20"
            />
          </label>
          <label className="flex items-center justify-between rounded-xl border border-line bg-white px-4 py-3 text-sm font-black">
            <span>
              <span className="block">{tr('tables.activeLabel')}</span>
              <span className="mt-1 block text-xs font-normal text-ink-muted">{tr('tables.inactiveHint')}</span>
            </span>
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="size-5 accent-brand"
            />
          </label>
          {error && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="min-h-10 rounded-lg border border-line px-4 text-sm font-bold">
              {tr('common.cancel')}
            </button>
            <button disabled={busy} className="min-h-10 rounded-lg bg-dark px-4 text-sm font-bold text-white disabled:opacity-50">
              {busy ? tr('tables.saving') : tr('tables.saveBtn')}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*                             EditAreaDialog                                 */
/* -------------------------------------------------------------------------- */

function EditAreaDialog({
  area,
  accessToken,
  csrfToken,
  tenantId,
  branchId,
  onClose,
  onSaved,
}: {
  area: DiningArea;
  accessToken: string;
  csrfToken: string | null;
  tenantId: string;
  branchId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(area.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { tr } = useLocale();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError(tr('tables.enterAreaName'));
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/branches/${branchId}/dining-areas/${area.id}`, {
        method: 'PATCH',
        accessToken,
        csrfToken,
        tenantId,
        body: { name: trimmed },
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tr('tables.updateAreaError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm" aria-label={tr('tables.editAreaAria', { name: area.name })}>
        <DialogTitle>{tr('tables.editAreaTitle')}</DialogTitle>
        <form onSubmit={submit} className="mt-4 grid gap-4">
          <label className="text-sm font-black">
            {tr('tables.areaNameLabel')}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              className="mt-2 min-h-12 w-full rounded-xl border border-line bg-white px-4 font-normal outline-none focus:ring-2 focus:ring-brand/20"
              autoFocus
            />
          </label>
          {error && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="min-h-10 rounded-lg border border-line px-4 text-sm font-bold">
              {tr('common.cancel')}
            </button>
            <button disabled={busy || !name.trim()} className="min-h-10 rounded-lg bg-dark px-4 text-sm font-bold text-white disabled:opacity-50">
              {busy ? tr('tables.saving') : tr('tables.saveBtn')}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*                            ClearSessionDialog                              */
/* -------------------------------------------------------------------------- */

function ClearSessionDialog({
  session,
  accessToken,
  csrfToken,
  tenantId,
  branchId,
  onClose,
  onCleared,
}: {
  session: DiningSession;
  accessToken: string;
  csrfToken: string | null;
  tenantId: string;
  branchId: string;
  onClose: () => void;
  onCleared: () => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { tr } = useLocale();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/branches/${branchId}/sessions/${session.id}/clear`, {
        method: 'POST',
        accessToken,
        csrfToken,
        tenantId,
        body: { expectedVersion: 1, clearReason: reason.trim() || undefined },
      });
      await onCleared();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tr('tables.clearSessionError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm" aria-label={tr('tables.clearSessionTitle')}>
        <DialogTitle>{tr('tables.clearSessionTitle')}</DialogTitle>
        <p className="mt-2 text-sm text-ink-muted">
          {tr('tables.clearSessionHint')}
        </p>
        <form onSubmit={submit} className="mt-4 grid gap-4">
          <label className="text-sm font-black">
            {tr('tables.reasonLabel')} <span className="font-normal text-ink-muted">{tr('tables.optionalHint')}</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={tr('tables.reasonPlaceholder')}
              className="mt-2 min-h-12 w-full rounded-xl border border-line bg-white px-4 font-normal outline-none focus:ring-2 focus:ring-brand/20"
            />
          </label>
          {error && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="min-h-10 rounded-lg border border-line px-4 text-sm font-bold">
              {tr('common.cancel')}
            </button>
            <button disabled={busy} className="min-h-10 rounded-lg bg-red-600 px-4 text-sm font-bold text-white disabled:opacity-50">
              {busy ? tr('tables.clearing') : tr('tables.clearSessionTitle')}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
