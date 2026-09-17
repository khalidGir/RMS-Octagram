'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { useBranch } from '@/components/shell/branch-provider';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { StatusChip } from '@/components/ui/status-chip';
import { Skeleton } from '@/components/ui/skeleton';
import {
  fetchInventoryItems,
  createInventoryItem,
  updateInventoryItem,
  receiveBatch,
  fetchMovements,
  recordAdjustment,
  recordWaste,
  fetchLowStockAlerts,
  type InventoryItem,
  type InventoryMovement,
  type LowStockAlert,
} from '@/lib/inventory-api';

type Tab = 'items' | 'alerts';

const movementTypeLabels: Record<string, string> = {
  RECEIVE: 'Received',
  DEDUCT: 'Deducted',
  ADJUST: 'Adjusted',
  WASTE: 'Waste',
  VOID_RESTORE: 'Void restore',
  TRANSFER: 'Transfer',
};

const movementTypeBadge: Record<string, string> = {
  RECEIVE: 'bg-emerald-50 text-emerald-700',
  DEDUCT: 'bg-blue-50 text-blue-700',
  ADJUST: 'bg-amber-50 text-amber-800',
  WASTE: 'bg-red-50 text-red-700',
  VOID_RESTORE: 'bg-violet-50 text-violet-700',
  TRANSFER: 'bg-stone-100 text-stone-600',
};

export function InventoryManagement() {
  const { accessToken, csrfToken, profile } = useAuth();
  const { branchId } = useBranch();
  const tenantId = profile?.memberships?.[0]?.tenant.id;

  const [tab, setTab] = useState<Tab>('items');
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [alerts, setAlerts] = useState<LowStockAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showActiveOnly, setShowActiveOnly] = useState<boolean | undefined>(undefined);

  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  const [batchItem, setBatchItem] = useState<InventoryItem | null>(null);
  const [adjustItem, setAdjustItem] = useState<InventoryItem | null>(null);
  const [movementsItem, setMovementsItem] = useState<InventoryItem | null>(null);

  const fetchItems = useCallback(async () => {
    if (!branchId || !accessToken || !tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const [itemRes, alertRes] = await Promise.all([
        fetchInventoryItems(branchId, accessToken, csrfToken, tenantId, { isActive: showActiveOnly, search: search || undefined }),
        fetchLowStockAlerts(branchId, accessToken, csrfToken, tenantId),
      ]);
      setItems(itemRes.items);
      setAlerts(alertRes.alerts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load inventory');
    } finally {
      setLoading(false);
    }
  }, [branchId, accessToken, csrfToken, tenantId, showActiveOnly, search]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  return (
    <div className="mx-auto max-w-[1500px]">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-brand">Stock control</p>
          <h1 className="mt-2 text-3xl font-black tracking-[-0.045em] sm:text-4xl">Inventory</h1>
          <p className="mt-2 text-sm text-ink-muted">Manage stock items, receive batches, and track consumption.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>+ Add item</Button>
      </header>

      <div className="mt-5 flex gap-2">
        {([['items', 'Items'], ['alerts', 'Alerts']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} className={cn('min-h-10 rounded-full px-4 text-xs font-black', tab === key ? 'bg-dark text-white' : 'bg-white text-ink-muted hover:text-ink')}>{label}{key === 'alerts' && alerts.length > 0 && <span className="ml-1.5 inline-flex size-5 items-center justify-center rounded-full bg-red-500 text-[10px] text-white">{alerts.length}</span>}</button>
        ))}
      </div>

      {tab === 'items' && (
        <>
          <div className="mt-4 flex flex-wrap gap-3">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items..." className="min-h-11 w-full max-w-sm rounded-control border border-line bg-white px-4 text-sm outline-none focus:ring-2 focus:ring-brand/30" />
            <label className="flex items-center gap-2 text-xs font-bold text-ink-muted">
              <input type="checkbox" checked={showActiveOnly === true} onChange={(e) => setShowActiveOnly(e.target.checked ? true : undefined)} className="size-4 accent-brand" />
              Active only
            </label>
          </div>

          {loading ? (
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-card" />)}</div>
          ) : error ? (
            <div className="mt-5 rounded-panel border border-line bg-white p-8 text-center shadow-card">
              <p className="font-extrabold">{error}</p>
              <Button onClick={() => void fetchItems()} className="mt-4">Try again</Button>
            </div>
          ) : items.length === 0 ? (
            <div className="mt-5 rounded-panel border border-line bg-white p-8 text-center shadow-card">
              <p className="font-extrabold">No inventory items</p>
              <p className="mt-2 text-sm text-ink-muted">Create your first inventory item to start tracking stock.</p>
              <Button onClick={() => setCreateOpen(true)} className="mt-4">+ Add item</Button>
            </div>
          ) : (
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((item) => {
                const alert = alerts.find((a) => a.id === item.id);
                const isLow = alert?.isLow ?? false;
  if (!branchId || !accessToken || !tenantId) return null;

  return (
                  <article key={item.id} className="rounded-panel border border-line bg-white p-5 shadow-card">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-black">{item.name}</h3>
                        {item.sku && <p className="mt-1 text-xs text-ink-muted">SKU: {item.sku}</p>}
                      </div>
                      <StatusChip status={item.isActive ? 'success' : 'idle'}>{item.isActive ? 'Active' : 'Inactive'}</StatusChip>
                    </div>
                    <div className="mt-4 flex items-baseline gap-2">
                      <span className="text-sm text-ink-muted">Threshold:</span>
                      <span className="text-sm font-black">{item.lowStockThreshold} {item.baseUnit}</span>
                    </div>
                    {isLow && <p className="mt-2 text-xs font-bold text-amber-700">⚠ Low stock</p>}
                    <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
                      <button onClick={() => setEditItem(item)} className="text-xs font-black text-brand">Edit</button>
                      <button onClick={() => setBatchItem(item)} className="text-xs font-black text-brand">Receive batch</button>
                      <button onClick={() => setAdjustItem(item)} className="text-xs font-black text-brand">Adjust</button>
                      <button onClick={() => setMovementsItem(item)} className="text-xs font-black text-ink-muted">History</button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === 'alerts' && (
        <div className="mt-5">
          {alerts.length === 0 ? (
            <div className="rounded-panel border border-line bg-white p-8 text-center shadow-card">
              <p className="font-extrabold">All stocked</p>
              <p className="mt-2 text-sm text-ink-muted">No items are below their low-stock threshold.</p>
            </div>
          ) : (
            <div className="rounded-panel border border-line bg-white shadow-card overflow-x-auto">
              <table className="w-full min-w-[600px] text-left">
                <thead><tr className="border-b border-line text-xs uppercase tracking-wider text-ink-muted">
                  <th className="px-5 py-4">Item</th>
                  <th className="px-5 py-4">Current stock</th>
                  <th className="px-5 py-4">Threshold</th>
                  <th className="px-5 py-4">Unit</th>
                  <th className="px-5 py-4">Status</th>
                </tr></thead>
                <tbody>
                  {alerts.map((a) => (
                    <tr key={a.id} className="border-b border-line last:border-0 text-sm">
                      <td className="px-5 py-4 font-black">{a.name}{a.sku && <span className="ml-2 text-xs text-ink-muted">({a.sku})</span>}</td>
                      <td className="px-5 py-4">{a.currentStock}</td>
                      <td className="px-5 py-4">{a.lowStockThreshold}</td>
                      <td className="px-5 py-4 text-ink-muted">{a.baseUnit}</td>
                      <td className="px-5 py-4">                      <StatusChip status={a.isLow ? 'warning' : 'success'}>{a.isLow ? 'Low' : 'OK'}</StatusChip></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {createOpen && <CreateItemDialog branchId={branchId} accessToken={accessToken!} csrfToken={csrfToken} tenantId={tenantId!} onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); void fetchItems(); }} />}
      {editItem && <EditItemDialog item={editItem} branchId={branchId} accessToken={accessToken!} csrfToken={csrfToken} tenantId={tenantId!} onClose={() => setEditItem(null)} onSaved={() => { setEditItem(null); void fetchItems(); }} />}
      {batchItem && <BatchReceiveDialog item={batchItem} branchId={branchId} accessToken={accessToken!} csrfToken={csrfToken} tenantId={tenantId!} onClose={() => setBatchItem(null)} onSaved={() => { setBatchItem(null); void fetchItems(); }} />}
      {adjustItem && <AdjustmentDialog item={adjustItem} branchId={branchId} accessToken={accessToken!} csrfToken={csrfToken} tenantId={tenantId!} onClose={() => setAdjustItem(null)} onSaved={() => { setAdjustItem(null); void fetchItems(); }} />}
      {movementsItem && <MovementsDialog item={movementsItem} branchId={branchId} accessToken={accessToken!} csrfToken={csrfToken} tenantId={tenantId!} onClose={() => setMovementsItem(null)} />}
    </div>
  );
}

/* ─────────────────────────── Create Item Dialog ─────────────────────────── */

function CreateItemDialog({ branchId, accessToken, csrfToken, tenantId, onClose, onCreated }: {
  branchId: string; accessToken: string; csrfToken: string | null; tenantId: string; onClose: () => void; onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [baseUnit, setBaseUnit] = useState('kg');
  const [threshold, setThreshold] = useState('0');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSave() {
    if (!name.trim() || !baseUnit.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      await createInventoryItem(branchId, {
        name: name.trim(),
        sku: sku.trim() || undefined,
        baseUnit: baseUnit.trim(),
        lowStockThreshold: Number(threshold) || 0,
      }, accessToken, csrfToken, tenantId);
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create item');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogTitle>Create inventory item</DialogTitle>
        <div className="mt-5 space-y-4">
          <label className="block text-xs font-black text-ink-muted">Name<input value={name} onChange={(e) => setName(e.target.value)} className="mt-2 w-full rounded-xl border border-line p-3 text-sm" placeholder="e.g. Tomatoes" /></label>
          <label className="block text-xs font-black text-ink-muted">SKU (optional)<input value={sku} onChange={(e) => setSku(e.target.value)} className="mt-2 w-full rounded-xl border border-line p-3 text-sm" placeholder="e.g. TOM-001" /></label>
          <div className="grid grid-cols-2 gap-4">
            <label className="block text-xs font-black text-ink-muted">Base unit<input value={baseUnit} onChange={(e) => setBaseUnit(e.target.value)} className="mt-2 w-full rounded-xl border border-line p-3 text-sm" placeholder="kg" /></label>
            <label className="block text-xs font-black text-ink-muted">Low-stock threshold<input value={threshold} onChange={(e) => setThreshold(e.target.value)} type="number" min="0" className="mt-2 w-full rounded-xl border border-line p-3 text-sm" /></label>
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={() => void handleSave()} disabled={saving || !name.trim() || !baseUnit.trim()}>{saving ? 'Saving...' : 'Create item'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────────────── Edit Item Dialog ─────────────────────────── */

function EditItemDialog({ item, branchId, accessToken, csrfToken, tenantId, onClose, onSaved }: {
  item: InventoryItem; branchId: string; accessToken: string; csrfToken: string | null; tenantId: string; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(item.name);
  const [sku, setSku] = useState(item.sku ?? '');
  const [threshold, setThreshold] = useState(item.lowStockThreshold);
  const [isActive, setIsActive] = useState(item.isActive);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setErr(null);
    try {
      await updateInventoryItem(branchId, item.id, {
        name: name.trim() || undefined,
        sku: sku.trim() || undefined,
        lowStockThreshold: Number(threshold) || undefined,
        isActive,
      }, accessToken, csrfToken, tenantId);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to update item');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogTitle>Edit inventory item</DialogTitle>
        <div className="mt-5 space-y-4">
          <label className="block text-xs font-black text-ink-muted">Name<input value={name} onChange={(e) => setName(e.target.value)} className="mt-2 w-full rounded-xl border border-line p-3 text-sm" /></label>
          <label className="block text-xs font-black text-ink-muted">SKU<input value={sku} onChange={(e) => setSku(e.target.value)} className="mt-2 w-full rounded-xl border border-line p-3 text-sm" /></label>
          <label className="block text-xs font-black text-ink-muted">Low-stock threshold<input value={threshold} onChange={(e) => setThreshold(e.target.value)} type="number" min="0" className="mt-2 w-full rounded-xl border border-line p-3 text-sm" /></label>
          <label className="flex items-center gap-3 text-xs font-black text-ink-muted">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="size-4 accent-brand" />
            Active
          </label>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={() => void handleSave()} disabled={saving}>{saving ? 'Saving...' : 'Save changes'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────────────── Batch Receive Dialog ─────────────────────────── */

function BatchReceiveDialog({ item, branchId, accessToken, csrfToken, tenantId, onClose, onSaved }: {
  item: InventoryItem; branchId: string; accessToken: string; csrfToken: string | null; tenantId: string; onClose: () => void; onSaved: () => void;
}) {
  const [batchCode, setBatchCode] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState(item.baseUnit);
  const [cost, setCost] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSave() {
    if (!batchCode.trim() || !quantity || Number(quantity) <= 0) return;
    setSaving(true);
    setErr(null);
    try {
      await receiveBatch(branchId, item.id, {
        batchCode: batchCode.trim(),
        receivedQuantity: Number(quantity),
        unit: unit.trim(),
        costMinor: cost ? Math.round(Number(cost) * 100) : undefined,
        expiresAt: expiresAt || undefined,
        idempotencyKey: crypto.randomUUID(),
      }, accessToken, csrfToken, tenantId);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to receive batch');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogTitle>Receive batch — {item.name}</DialogTitle>
        <div className="mt-5 space-y-4">
          <label className="block text-xs font-black text-ink-muted">Batch code<input value={batchCode} onChange={(e) => setBatchCode(e.target.value)} className="mt-2 w-full rounded-xl border border-line p-3 text-sm" placeholder="e.g. BATCH-2026-001" /></label>
          <div className="grid grid-cols-2 gap-4">
            <label className="block text-xs font-black text-ink-muted">Quantity<input value={quantity} onChange={(e) => setQuantity(e.target.value)} type="number" min="0.01" step="0.01" className="mt-2 w-full rounded-xl border border-line p-3 text-sm" /></label>
            <label className="block text-xs font-black text-ink-muted">Unit<input value={unit} onChange={(e) => setUnit(e.target.value)} className="mt-2 w-full rounded-xl border border-line p-3 text-sm" /></label>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <label className="block text-xs font-black text-ink-muted">Cost per unit (ETB)<input value={cost} onChange={(e) => setCost(e.target.value)} type="number" min="0" step="0.01" className="mt-2 w-full rounded-xl border border-line p-3 text-sm" placeholder="Optional" /></label>
            <label className="block text-xs font-black text-ink-muted">Expires at<input value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} type="date" className="mt-2 w-full rounded-xl border border-line p-3 text-sm" /></label>
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={() => void handleSave()} disabled={saving || !batchCode.trim() || !quantity || Number(quantity) <= 0}>{saving ? 'Saving...' : 'Receive batch'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────────────── Adjustment / Waste Dialog ─────────────────────────── */

function AdjustmentDialog({ item, branchId, accessToken, csrfToken, tenantId, onClose, onSaved }: {
  item: InventoryItem; branchId: string; accessToken: string; csrfToken: string | null; tenantId: string; onClose: () => void; onSaved: () => void;
}) {
  const [mode, setMode] = useState<'adjust' | 'waste'>('adjust');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSave() {
    if (!quantity || !reason.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      const payload = { quantity: Number(quantity), unit: item.baseUnit, reason: reason.trim(), idempotencyKey: crypto.randomUUID() };
      if (mode === 'adjust') {
        await recordAdjustment(branchId, item.id, payload, accessToken, csrfToken, tenantId);
      } else {
        await recordWaste(branchId, item.id, { ...payload, quantity: Math.abs(Number(quantity)) }, accessToken, csrfToken, tenantId);
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to record');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogTitle>{mode === 'adjust' ? 'Stock adjustment' : 'Record waste'} — {item.name}</DialogTitle>
        <div className="mt-4 flex gap-2">
          <button onClick={() => setMode('adjust')} className={cn('min-h-9 rounded-full px-4 text-xs font-black', mode === 'adjust' ? 'bg-dark text-white' : 'bg-muted')}>Adjust</button>
          <button onClick={() => setMode('waste')} className={cn('min-h-9 rounded-full px-4 text-xs font-black', mode === 'waste' ? 'bg-dark text-white' : 'bg-muted')}>Waste</button>
        </div>
        <div className="mt-5 space-y-4">
          <label className="block text-xs font-black text-ink-muted">
            Quantity ({mode === 'adjust' ? 'positive = add, negative = subtract' : 'positive only'})
            <input value={quantity} onChange={(e) => setQuantity(e.target.value)} type="number" step="0.01" className="mt-2 w-full rounded-xl border border-line p-3 text-sm" placeholder={mode === 'waste' ? '1' : '-5'} />
          </label>
          <label className="block text-xs font-black text-ink-muted">Reason<textarea value={reason} onChange={(e) => setReason(e.target.value)} className="mt-2 w-full rounded-xl border border-line p-3 text-sm" rows={3} placeholder="e.g. Stock count correction" /></label>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={() => void handleSave()} disabled={saving || !quantity || !reason.trim()}>{saving ? 'Saving...' : mode === 'adjust' ? 'Apply adjustment' : 'Record waste'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────────────── Movements History Dialog ─────────────────────────── */

function MovementsDialog({ item, branchId, accessToken, csrfToken, tenantId, onClose }: {
  item: InventoryItem; branchId: string; accessToken: string; csrfToken: string | null; tenantId: string; onClose: () => void;
}) {
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!branchId || !accessToken || !tenantId) return;
    setLoading(true);
    fetchMovements(branchId, item.id, accessToken, csrfToken, tenantId)
      .then((res) => setMovements(res.movements))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [branchId, item.id, accessToken, csrfToken, tenantId]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogTitle>Movement history — {item.name}</DialogTitle>
        <div className="mt-4 flex-1 overflow-y-auto">
          {loading ? (
            <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
          ) : movements.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-muted">No movements recorded yet.</p>
          ) : (
            <div className="space-y-2">
              {movements.map((m) => (
                <div key={m.id} className="flex items-center justify-between rounded-xl border border-line p-4 text-sm">
                  <div className="flex items-center gap-3">
                    <span className={cn('rounded-full px-2 py-1 text-[10px] font-black', movementTypeBadge[movementTypeLabels[m.movementType] ? m.movementType : 'ADJUST'] ?? 'bg-muted')}>{movementTypeLabels[m.movementType] ?? m.movementType}</span>
                    <div>
                      <p className="font-black">{m.quantity} {m.unit}</p>
                      <p className="text-xs text-ink-muted">{m.reason}</p>
                    </div>
                  </div>
                  <span className="text-xs text-ink-muted">{new Date(m.createdAt).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
