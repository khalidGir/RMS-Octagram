'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { useBranch } from '@/components/shell/branch-provider';
import { useLocale, type MessageKey } from '@/components/locale-provider';
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

const movementTypeKeys: Record<string, MessageKey> = {
  RECEIVE: 'inventory.mvReceive',
  DEDUCT: 'inventory.mvDeduct',
  ADJUST: 'inventory.mvAdjust',
  WASTE: 'inventory.waste',
  VOID_RESTORE: 'inventory.mvVoidRestore',
  TRANSFER: 'inventory.mvTransfer',
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
  const { tr } = useLocale();
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
      setError(err instanceof Error ? err.message : tr('inventory.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [branchId, accessToken, csrfToken, tenantId, showActiveOnly, search]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  return (
    <div className="mx-auto max-w-[1500px]">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-brand">{tr('inventory.eyebrow')}</p>
          <h1 className="mt-2 text-3xl font-black tracking-[-0.045em] sm:text-4xl">{tr('inventory.title')}</h1>
          <p className="mt-2 text-sm text-ink-muted">{tr('inventory.description')}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>{tr('inventory.addItem')}</Button>
      </header>

      <div className="mt-5 flex gap-2">
        {([['items', tr('inventory.tabItems')], ['alerts', tr('inventory.tabAlerts')]] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} className={cn('min-h-10 rounded-full px-4 text-xs font-black', tab === key ? 'bg-dark text-white' : 'bg-white text-ink-muted hover:text-ink')}>{label}{key === 'alerts' && alerts.length > 0 && <span className="ms-1.5 inline-flex size-5 items-center justify-center rounded-full bg-red-500 text-[10px] text-white">{alerts.length}</span>}</button>
        ))}
      </div>

      {tab === 'items' && (
        <>
          <div className="mt-4 flex flex-wrap gap-3">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tr('inventory.searchPlaceholder')} className="min-h-11 w-full max-w-sm rounded-control border border-line bg-white px-4 text-sm outline-none focus:ring-2 focus:ring-brand/30" />
            <label className="flex items-center gap-2 text-xs font-bold text-ink-muted">
              <input type="checkbox" checked={showActiveOnly === true} onChange={(e) => setShowActiveOnly(e.target.checked ? true : undefined)} className="size-4 accent-brand" />
              {tr('inventory.activeOnly')}
            </label>
          </div>

          {loading ? (
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-card" />)}</div>
          ) : error ? (
            <div className="mt-5 rounded-panel border border-line bg-white p-8 text-center shadow-card">
              <p className="font-extrabold">{error}</p>
              <Button onClick={() => void fetchItems()} className="mt-4">{tr('common.tryAgain')}</Button>
            </div>
          ) : items.length === 0 ? (
            <div className="mt-5 rounded-panel border border-line bg-white p-8 text-center shadow-card">
              <p className="font-extrabold">{tr('inventory.noItems')}</p>
              <p className="mt-2 text-sm text-ink-muted">{tr('inventory.noItemsHint')}</p>
              <Button onClick={() => setCreateOpen(true)} className="mt-4">{tr('inventory.addItem')}</Button>
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
                        {item.sku && <p className="mt-1 text-xs text-ink-muted">{tr('inventory.skuPrefix', { sku: item.sku })}</p>}
                      </div>
                      <StatusChip status={item.isActive ? 'success' : 'idle'}>{item.isActive ? tr('status.active') : tr('status.inactive')}</StatusChip>
                    </div>
                    <div className="mt-4 flex items-baseline gap-2">
                      <span className="text-sm text-ink-muted">{tr('inventory.threshold')}</span>
                      <span className="text-sm font-black">{item.lowStockThreshold} {item.baseUnit}</span>
                    </div>
                    {isLow && <p className="mt-2 text-xs font-bold text-amber-700">⚠ {tr('status.stockLowStock')}</p>}
                    <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
                      <button onClick={() => setEditItem(item)} className="text-xs font-black text-brand">{tr('inventory.edit')}</button>
                      <button onClick={() => setBatchItem(item)} className="text-xs font-black text-brand">{tr('inventory.receiveBatch')}</button>
                      <button onClick={() => setAdjustItem(item)} className="text-xs font-black text-brand">{tr('inventory.adjust')}</button>
                      <button onClick={() => setMovementsItem(item)} className="text-xs font-black text-ink-muted">{tr('inventory.history')}</button>
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
              <p className="font-extrabold">{tr('status.stockAllStocked')}</p>
              <p className="mt-2 text-sm text-ink-muted">{tr('inventory.allStockedHint')}</p>
            </div>
          ) : (
            <div className="rounded-panel border border-line bg-white shadow-card overflow-x-auto">
              <table className="w-full min-w-[600px] text-start">
                <thead><tr className="border-b border-line text-xs uppercase tracking-wider text-ink-muted">
                  <th className="px-5 py-4">{tr('inventory.colItem')}</th>
                  <th className="px-5 py-4">{tr('inventory.colCurrentStock')}</th>
                  <th className="px-5 py-4">{tr('inventory.colThreshold')}</th>
                  <th className="px-5 py-4">{tr('inventory.colUnit')}</th>
                  <th className="px-5 py-4">{tr('inventory.colStatus')}</th>
                </tr></thead>
                <tbody>
                  {alerts.map((a) => (
                    <tr key={a.id} className="border-b border-line last:border-0 text-sm">
                      <td className="px-5 py-4 font-black">{a.name}{a.sku && <span className="ms-2 text-xs text-ink-muted">({a.sku})</span>}</td>
                      <td className="px-5 py-4">{a.currentStock}</td>
                      <td className="px-5 py-4">{a.lowStockThreshold}</td>
                      <td className="px-5 py-4 text-ink-muted">{a.baseUnit}</td>
                      <td className="px-5 py-4">                      <StatusChip status={a.isLow ? 'warning' : 'success'}>{a.isLow ? tr('status.stockLow') : tr('status.stockOk')}</StatusChip></td>
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
  const { tr } = useLocale();

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
      setErr(e instanceof Error ? e.message : tr('inventory.createFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogTitle>{tr('inventory.createTitle')}</DialogTitle>
        <div className="mt-5 space-y-4">
          <label className="block text-xs font-black text-ink-muted">{tr('inventory.name')}<input value={name} onChange={(e) => setName(e.target.value)} className="mt-2 w-full rounded-xl border border-line p-3 text-sm" placeholder={tr('inventory.namePlaceholder')} /></label>
          <label className="block text-xs font-black text-ink-muted">{tr('inventory.skuOptional')}<input value={sku} onChange={(e) => setSku(e.target.value)} className="mt-2 w-full rounded-xl border border-line p-3 text-sm" placeholder={tr('inventory.skuPlaceholder')} /></label>
          <div className="grid grid-cols-2 gap-4">
            <label className="block text-xs font-black text-ink-muted">{tr('inventory.baseUnit')}<input value={baseUnit} onChange={(e) => setBaseUnit(e.target.value)} className="mt-2 w-full rounded-xl border border-line p-3 text-sm" placeholder="kg" /></label>
            <label className="block text-xs font-black text-ink-muted">{tr('inventory.thresholdLabel')}<input value={threshold} onChange={(e) => setThreshold(e.target.value)} type="number" min="0" className="mt-2 w-full rounded-xl border border-line p-3 text-sm" /></label>
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={onClose}>{tr('common.cancel')}</Button>
            <Button onClick={() => void handleSave()} disabled={saving || !name.trim() || !baseUnit.trim()}>{saving ? tr('inventory.saving') : tr('inventory.createItem')}</Button>
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
  const { tr } = useLocale();

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
      setErr(e instanceof Error ? e.message : tr('inventory.updateFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogTitle>{tr('inventory.editTitle')}</DialogTitle>
        <div className="mt-5 space-y-4">
          <label className="block text-xs font-black text-ink-muted">{tr('inventory.name')}<input value={name} onChange={(e) => setName(e.target.value)} className="mt-2 w-full rounded-xl border border-line p-3 text-sm" /></label>
          <label className="block text-xs font-black text-ink-muted">{tr('inventory.skuLabel')}<input value={sku} onChange={(e) => setSku(e.target.value)} className="mt-2 w-full rounded-xl border border-line p-3 text-sm" /></label>
          <label className="block text-xs font-black text-ink-muted">{tr('inventory.thresholdLabel')}<input value={threshold} onChange={(e) => setThreshold(e.target.value)} type="number" min="0" className="mt-2 w-full rounded-xl border border-line p-3 text-sm" /></label>
          <label className="flex items-center gap-3 text-xs font-black text-ink-muted">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="size-4 accent-brand" />
            {tr('status.active')}
          </label>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={onClose}>{tr('common.cancel')}</Button>
            <Button onClick={() => void handleSave()} disabled={saving}>{saving ? tr('inventory.saving') : tr('inventory.saveChanges')}</Button>
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
  const { tr } = useLocale();

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
      setErr(e instanceof Error ? e.message : tr('inventory.receiveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogTitle>{tr('inventory.receiveTitle', { name: item.name })}</DialogTitle>
        <div className="mt-5 space-y-4">
          <label className="block text-xs font-black text-ink-muted">{tr('inventory.batchCode')}<input value={batchCode} onChange={(e) => setBatchCode(e.target.value)} className="mt-2 w-full rounded-xl border border-line p-3 text-sm" placeholder={tr('inventory.batchPlaceholder')} /></label>
          <div className="grid grid-cols-2 gap-4">
            <label className="block text-xs font-black text-ink-muted">{tr('inventory.quantity')}<input value={quantity} onChange={(e) => setQuantity(e.target.value)} type="number" min="0.01" step="0.01" className="mt-2 w-full rounded-xl border border-line p-3 text-sm" /></label>
            <label className="block text-xs font-black text-ink-muted">{tr('inventory.colUnit')}<input value={unit} onChange={(e) => setUnit(e.target.value)} className="mt-2 w-full rounded-xl border border-line p-3 text-sm" /></label>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <label className="block text-xs font-black text-ink-muted">{tr('inventory.costPerUnit')}<input value={cost} onChange={(e) => setCost(e.target.value)} type="number" min="0" step="0.01" className="mt-2 w-full rounded-xl border border-line p-3 text-sm" placeholder={tr('inventory.optional')} /></label>
            <label className="block text-xs font-black text-ink-muted">{tr('inventory.expiresAt')}<input value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} type="date" className="mt-2 w-full rounded-xl border border-line p-3 text-sm" /></label>
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={onClose}>{tr('common.cancel')}</Button>
            <Button onClick={() => void handleSave()} disabled={saving || !batchCode.trim() || !quantity || Number(quantity) <= 0}>{saving ? tr('inventory.saving') : tr('inventory.receiveBatch')}</Button>
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
  const { tr } = useLocale();

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
      setErr(e instanceof Error ? e.message : tr('inventory.recordFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogTitle>{mode === 'adjust' ? tr('inventory.adjustTitle') : tr('inventory.wasteTitle')} — {item.name}</DialogTitle>
        <div className="mt-4 flex gap-2">
          <button onClick={() => setMode('adjust')} className={cn('min-h-9 rounded-full px-4 text-xs font-black', mode === 'adjust' ? 'bg-dark text-white' : 'bg-muted')}>{tr('inventory.adjust')}</button>
          <button onClick={() => setMode('waste')} className={cn('min-h-9 rounded-full px-4 text-xs font-black', mode === 'waste' ? 'bg-dark text-white' : 'bg-muted')}>{tr('inventory.waste')}</button>
        </div>
        <div className="mt-5 space-y-4">
          <label className="block text-xs font-black text-ink-muted">
            {tr('inventory.quantity')} ({mode === 'adjust' ? tr('inventory.qtyHintAdjust') : tr('inventory.qtyHintWaste')})
            <input value={quantity} onChange={(e) => setQuantity(e.target.value)} type="number" step="0.01" className="mt-2 w-full rounded-xl border border-line p-3 text-sm" placeholder={mode === 'waste' ? '1' : '-5'} />
          </label>
          <label className="block text-xs font-black text-ink-muted">{tr('inventory.reason')}<textarea value={reason} onChange={(e) => setReason(e.target.value)} className="mt-2 w-full rounded-xl border border-line p-3 text-sm" rows={3} placeholder={tr('inventory.reasonPlaceholder')} /></label>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={onClose}>{tr('common.cancel')}</Button>
            <Button onClick={() => void handleSave()} disabled={saving || !quantity || !reason.trim()}>{saving ? tr('inventory.saving') : mode === 'adjust' ? tr('inventory.applyAdjustment') : tr('inventory.recordWaste')}</Button>
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
  const { tr, formatDate } = useLocale();

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
        <DialogTitle>{tr('inventory.historyTitle', { name: item.name })}</DialogTitle>
        <div className="mt-4 flex-1 overflow-y-auto">
          {loading ? (
            <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
          ) : movements.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-muted">{tr('inventory.noMovements')}</p>
          ) : (
            <div className="space-y-2">
              {movements.map((m) => {
                const mvKey = movementTypeKeys[m.movementType];
                return (
                <div key={m.id} className="flex items-center justify-between rounded-xl border border-line p-4 text-sm">
                  <div className="flex items-center gap-3">
                    <span className={cn('rounded-full px-2 py-1 text-[10px] font-black', movementTypeBadge[mvKey ? m.movementType : 'ADJUST'] ?? 'bg-muted')}>{mvKey ? tr(mvKey) : m.movementType}</span>
                    <div>
                      <p className="font-black">{m.quantity} {m.unit}</p>
                      <p className="text-xs text-ink-muted">{m.reason}</p>
                    </div>
                  </div>
                  <span className="text-xs text-ink-muted">{formatDate(m.createdAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}</span>
                </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={onClose}>{tr('inventory.close')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
