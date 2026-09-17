'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiRequest, type ApiEnvelope } from '@/lib/api-client';
import { useAuth } from './auth-provider';
import { useBranch } from './shell/branch-provider';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

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
  const membership = profile?.memberships[0];
  const tenantId = membership?.tenant.id ?? '';
  const [tab, setTab] = useState('tables');
  const [notice, setNotice] = useState<string | null>(null);
  const [showCreateArea, setShowCreateArea] = useState(false);
  const [showCreateTable, setShowCreateTable] = useState(false);

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
    return <p role="alert">Permission denied.</p>;
  }

  if (!branchId) {
    return (
      <div className="grid min-h-72 place-items-center">
        <p className="text-sm font-bold text-ink-muted">Select a branch to manage tables.</p>
      </div>
    );
  }

  const isManager = ['OWNER', 'MANAGER'].includes(membership.role);

  return (
    <>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[.18em] text-brand">Dining room</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Tables &amp; sessions</h1>
          <p className="mt-2 text-sm text-ink-muted">
            Manage table availability, dining areas, and active sessions.
          </p>
        </div>
        {isManager && (
          <div className="flex gap-2">
            <button
              onClick={() => { setNotice(null); setShowCreateArea(true); }}
              className="min-h-11 rounded-xl border border-line bg-white px-4 text-sm font-bold"
            >
              + Add area
            </button>
            <button
              onClick={() => { setNotice(null); setShowCreateTable(true); }}
              className="min-h-11 rounded-xl bg-dark px-5 text-sm font-bold text-white shadow-sm transition hover:bg-dark-muted"
            >
              + Add table
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
        <p className="py-16 text-center text-sm font-bold text-ink-muted">Loading tables…</p>
      )}

      {(occupancy.isError || areas.isError) && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">
          Could not load tables. Check the API connection and try again.
        </div>
      )}

      {!occupancy.isLoading && !occupancy.isError && (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="tables">Tables ({occupancy.data?.length ?? 0})</TabsTrigger>
            <TabsTrigger value="sessions">Sessions ({sessions.data?.length ?? 0})</TabsTrigger>
            <TabsTrigger value="areas">Areas ({areas.data?.length ?? 0})</TabsTrigger>
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
            setNotice(`Area "${name}" created.`);
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
          onCreated={async (label) => {
            setShowCreateTable(false);
            await occupancy.refetch();
            await areas.refetch();
            setNotice(`Table "${label}" created with QR code.`);
          }}
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
}: {
  tables: TableOccupancy[];
  accessToken: string;
  csrfToken: string | null;
  tenantId: string;
  branchId: string;
  isManager: boolean;
  onNotice: (msg: string | null) => void;
  onInvalidate: () => void;
}) {
  const [editingTable, setEditingTable] = useState<TableOccupancy | null>(null);

  if (tables.length === 0) {
    return (
      <div className="mt-4 grid min-h-72 place-items-center rounded-2xl border border-dashed border-line bg-white/60 text-center">
        <div>
          <p className="text-lg font-black">No tables yet</p>
          <p className="mt-2 text-sm text-ink-muted">Add your first table to start managing dine-in orders.</p>
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
                  {isOccupied ? 'OCCUPIED' : t.isActive ? 'AVAILABLE' : 'INACTIVE'}
                </span>
              </div>
              <h2 className="mt-4 font-black">Table {t.label}</h2>
              <p className="mt-1 text-sm text-ink-muted">
                {isOccupied
                  ? `${t.openOrderCount} order${t.openOrderCount !== 1 ? 's' : ''} · ${t.capacity} seats`
                  : `Seats ${t.capacity}`}
              </p>
              {isManager && (
                <button
                  onClick={() => setEditingTable(t)}
                  className="mt-4 w-full rounded-xl border border-line py-2 text-xs font-black"
                >
                  Manage
                </button>
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
            onNotice('Table updated.');
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
  const [clearingSession, setClearingSession] = useState<DiningSession | null>(null);

  if (sessions.length === 0) {
    return (
      <div className="mt-4 grid min-h-72 place-items-center rounded-2xl border border-dashed border-line bg-white/60 text-center">
        <div>
          <p className="text-lg font-black">No open sessions</p>
          <p className="mt-2 text-sm text-ink-muted">Sessions open automatically when orders are confirmed.</p>
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
              <p className="text-sm font-black">Session {s.id.slice(0, 8)}…</p>
              <p className="mt-1 text-sm text-ink-muted">
                {s.guestCount} guest{s.guestCount !== 1 ? 's' : ''} · {s.orderCount} order{s.orderCount !== 1 ? 's' : ''} · Opened {new Date(s.openedAt).toLocaleTimeString()}
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
                  Clear
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
            onNotice('Session cleared.');
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
  const [editingArea, setEditingArea] = useState<DiningArea | null>(null);

  if (areas.length === 0) {
    return (
      <div className="mt-4 grid min-h-72 place-items-center rounded-2xl border border-dashed border-line bg-white/60 text-center">
        <div>
          <p className="text-lg font-black">No dining areas</p>
          <p className="mt-2 text-sm text-ink-muted">Create areas to organize your tables (e.g. Main Floor, Terrace).</p>
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
                {area._count?.tables ?? 0} table{area._count?.tables !== 1 ? 's' : ''}
              </p>
            </div>
            {isManager && (
              <button
                onClick={() => setEditingArea(area)}
                className="min-h-9 rounded-lg border border-line px-3 text-xs font-bold"
              >
                Edit
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
            onNotice('Area updated.');
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError('Enter an area name.');
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
      setError(err instanceof ApiError ? err.message : 'Could not create area.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm" aria-label="Add dining area">
        <DialogTitle>Add dining area</DialogTitle>
        <form onSubmit={submit} className="mt-4 grid gap-4">
          <label className="text-sm font-black">
            Area name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              placeholder="e.g. Main Floor"
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
              Cancel
            </button>
            <button disabled={busy || !name.trim()} className="min-h-10 rounded-lg bg-dark px-4 text-sm font-bold text-white disabled:opacity-50">
              {busy ? 'Creating…' : 'Create area'}
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
  onCreated: (label: string) => Promise<void>;
}) {
  const [label, setLabel] = useState('');
  const [capacity, setCapacity] = useState('4');
  const [diningAreaId, setDiningAreaId] = useState(areas[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedLabel = label.trim();
    const cap = parseInt(capacity, 10);
    if (!trimmedLabel) return setError('Enter a table label.');
    if (isNaN(cap) || cap < 1) return setError('Capacity must be at least 1.');
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/branches/${branchId}/tables`, {
        method: 'POST',
        accessToken,
        csrfToken,
        tenantId,
        body: { label: trimmedLabel, capacity: cap, diningAreaId: diningAreaId || undefined },
      });
      await onCreated(trimmedLabel);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create table.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md" aria-label="Add table">
        <DialogTitle>Add table</DialogTitle>
        <form onSubmit={submit} className="mt-4 grid gap-4">
          <label className="text-sm font-black">
            Table label
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={50}
              placeholder="e.g. T1"
              className="mt-2 min-h-12 w-full rounded-xl border border-line bg-white px-4 font-normal outline-none focus:ring-2 focus:ring-brand/20"
              autoFocus
            />
          </label>
          <div className="grid grid-cols-2 gap-4">
            <label className="text-sm font-black">
              Capacity
              <input
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                inputMode="numeric"
                min={1}
                className="mt-2 min-h-12 w-full rounded-xl border border-line bg-white px-4 font-normal tabular-nums outline-none focus:ring-2 focus:ring-brand/20"
              />
            </label>
            <label className="text-sm font-black">
              Dining area
              <select
                value={diningAreaId}
                onChange={(e) => setDiningAreaId(e.target.value)}
                className="mt-2 min-h-12 w-full rounded-xl border border-line bg-white px-3 font-normal"
              >
                <option value="">None</option>
                {areas.map((a) => (
                  <option value={a.id} key={a.id}>{a.name}</option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-xs text-ink-muted">A QR code will be generated automatically for this table.</p>
          {error && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="min-h-10 rounded-lg border border-line px-4 text-sm font-bold">
              Cancel
            </button>
            <button disabled={busy || !label.trim()} className="min-h-10 rounded-lg bg-dark px-4 text-sm font-bold text-white disabled:opacity-50">
              {busy ? 'Creating…' : 'Create table'}
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const cap = parseInt(capacity, 10);
    if (!label.trim()) return setError('Enter a table label.');
    if (isNaN(cap) || cap < 1) return setError('Capacity must be at least 1.');
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
      setError(err instanceof ApiError ? err.message : 'Could not update table.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md" aria-label={`Edit table ${table.label}`}>
        <DialogTitle>Edit table {table.label}</DialogTitle>
        <form onSubmit={submit} className="mt-4 grid gap-4">
          <label className="text-sm font-black">
            Table label
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={50}
              className="mt-2 min-h-12 w-full rounded-xl border border-line bg-white px-4 font-normal outline-none focus:ring-2 focus:ring-brand/20"
            />
          </label>
          <label className="text-sm font-black">
            Capacity
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
              <span className="block">Active</span>
              <span className="mt-1 block text-xs font-normal text-ink-muted">Inactive tables are hidden from POS.</span>
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
              Cancel
            </button>
            <button disabled={busy} className="min-h-10 rounded-lg bg-dark px-4 text-sm font-bold text-white disabled:opacity-50">
              {busy ? 'Saving…' : 'Save'}
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError('Enter an area name.');
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
      setError(err instanceof ApiError ? err.message : 'Could not update area.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm" aria-label={`Edit area ${area.name}`}>
        <DialogTitle>Edit dining area</DialogTitle>
        <form onSubmit={submit} className="mt-4 grid gap-4">
          <label className="text-sm font-black">
            Area name
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
              Cancel
            </button>
            <button disabled={busy || !name.trim()} className="min-h-10 rounded-lg bg-dark px-4 text-sm font-bold text-white disabled:opacity-50">
              {busy ? 'Saving…' : 'Save'}
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
      setError(err instanceof ApiError ? err.message : 'Could not clear session.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm" aria-label="Clear session">
        <DialogTitle>Clear session</DialogTitle>
        <p className="mt-2 text-sm text-ink-muted">
          All linked orders must be completed or cancelled before clearing.
        </p>
        <form onSubmit={submit} className="mt-4 grid gap-4">
          <label className="text-sm font-black">
            Reason <span className="font-normal text-ink-muted">(optional)</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Guests departed"
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
              Cancel
            </button>
            <button disabled={busy} className="min-h-10 rounded-lg bg-red-600 px-4 text-sm font-bold text-white disabled:opacity-50">
              {busy ? 'Clearing…' : 'Clear session'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
