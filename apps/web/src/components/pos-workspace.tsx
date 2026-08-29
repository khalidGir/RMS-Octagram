'use client';

import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError, apiRequest, formatEtbMinor, newIdempotencyKey, type ApiEnvelope } from '@/lib/api-client';
import { useAuth } from './auth-provider';
import { useOnlineStatus } from './connectivity-indicator';

interface ModifierOption { id: string; name: string; priceDeltaMinor: string; }
interface ModifierGroup { id: string; name: string; isRequired: boolean; minSelections: number; maxSelections: number | null; options: ModifierOption[]; }
interface Variant { id: string; name: string; priceMinor: string; isDefault: boolean; sku?: string | null; }
interface Item { id: string; name: string; description: string | null; variants: Variant[]; modifierGroups: ModifierGroup[]; }
interface Menu { categories: Array<{ id: string; name: string; items: Item[] }>; }
interface Table { id: string; label: string; isActive: boolean; }
interface Shift { id: string; status: string; }

interface CartLine {
  lineKey: string;
  item: Item;
  variant: Variant;
  quantity: number;
  selectedModifiers: Record<string, string[]>;
  notes: string;
}

interface CreatedOrder {
  id: string;
  orderNumber: string;
  subtotalMinor: string;
  taxMinor: string;
  totalMinor: string;
  status: string;
  version: number;
}

function makeLineKey(variantId: string, modifierSelections: Record<string, string[]>, notes: string): string {
  const modParts = Object.entries(modifierSelections)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([gid, opts]) => `${gid}:${[...opts].sort().join(',')}`)
    .join('|');
  return `${variantId}__${modParts}__${notes.trim().slice(0, 200)}`;
}

export function PosWorkspace() {
  const { accessToken, csrfToken, profile } = useAuth();
  const membership = profile?.memberships[0];
  const tenantId = membership?.tenant.id ?? '';
  const branchId = typeof window === 'undefined' ? '' : window.sessionStorage.getItem('rms-branch-id') ?? membership?.branchAssignments[0]?.branchId ?? '';
  const isOnline = useOnlineStatus();

  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderType] = useState<'POS' | 'DINE_IN' | 'PICKUP' | 'TAKEAWAY'>('POS');
  const [tableId, setTableId] = useState('');
  const [notes, setNotes] = useState('');
  const [pending, setPending] = useState<CreatedOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const orderKey = useRef(newIdempotencyKey());
  const paymentKey = useRef(newIdempotencyKey());

  const [modifierModal, setModifierModal] = useState<{
    item: Item;
    editLineKey?: string;
  } | null>(null);
  const [variantModal, setVariantModal] = useState<Item | null>(null);

  const menuQuery = useQuery({
    queryKey: ['pos-menu', tenantId, branchId],
    enabled: Boolean(tenantId && branchId),
    queryFn: async () => (await apiRequest<ApiEnvelope<Menu>>(`/public/tenants/${tenantId}/branches/${branchId}/menu`)).data,
  });

  const tablesQuery = useQuery({
    queryKey: ['pos-tables', tenantId, branchId],
    enabled: Boolean(accessToken && tenantId && branchId),
    queryFn: async () => (await apiRequest<ApiEnvelope<Table[]>>(`/branches/${branchId}/tables`, { accessToken, tenantId })).data,
  });

  const shiftQuery = useQuery({
    queryKey: ['current-shift', tenantId, branchId],
    enabled: Boolean(accessToken && tenantId && branchId),
    queryFn: async () => (await apiRequest<ApiEnvelope<Shift | null>>(`/branches/${branchId}/shifts/current`, { accessToken, tenantId })).data,
  });

  const categories = menuQuery.data?.categories ?? [];
  const items = useMemo(
    () =>
      categories
        .flatMap((g) => g.items)
        .filter(
          (item) =>
            (!category || categories.find((g) => g.id === category)?.items.some((c) => c.id === item.id)) &&
            item.name.toLowerCase().includes(search.toLowerCase()),
        ),
    [categories, category, search],
  );

  const cartSubtotal = cart.reduce((sum, line) => {
    const variantPrice = BigInt(line.variant.priceMinor);
    const modDelta = Object.values(line.selectedModifiers)
      .flat()
      .reduce((acc, optId) => {
        const opt = line.item.modifierGroups.flatMap((g) => g.options).find((o) => o.id === optId);
        return acc + (opt ? BigInt(opt.priceDeltaMinor) : 0n);
      }, 0n);
    return sum + (variantPrice + modDelta) * BigInt(line.quantity);
  }, 0n);

  function openModifierSelector(item: Item, editLineKey?: string) {
    if (item.variants.length > 1 && !editLineKey) {
      setVariantModal(item);
      return;
    }
    setModifierModal({ item, editLineKey });
  }

  function selectVariant(_item: Item, _variant: Variant) {
    setVariantModal(null);
    setModifierModal({ item: _item });
  }

  function addToCart(item: Item, variant: Variant, selectedModifiers: Record<string, string[]>, lineNotes: string, editLineKey?: string) {
    const key = makeLineKey(variant.id, selectedModifiers, lineNotes);
    if (editLineKey) {
      setCart((current) => current.filter((l) => l.lineKey !== editLineKey));
    }
    setCart((current) => {
      const existing = current.find((l) => l.lineKey === key);
      if (existing) {
        return current.map((l) => (l.lineKey === key ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...current, { lineKey: key, item, variant, quantity: 1, selectedModifiers, notes: lineNotes }];
    });
  }

  function addQuick(item: Item) {
    const variant = item.variants.find((v) => v.isDefault) ?? item.variants[0];
    if (!variant) return;
    if (item.variants.length > 1) {
      setVariantModal(item);
      return;
    }
    if (item.modifierGroups.length > 0) {
      openModifierSelector(item);
      return;
    }
    addToCart(item, variant, {}, '');
  }

  function updateLineQty(lineKey: string, delta: number) {
    setCart((current) =>
      current
        .map((l) => (l.lineKey === lineKey ? { ...l, quantity: Math.max(0, l.quantity + delta) } : l))
        .filter((l) => l.quantity > 0),
    );
  }

  function removeLine(lineKey: string) {
    setCart((current) => current.filter((l) => l.lineKey !== lineKey));
  }

  async function createOrder() {
    if (!cart.length || !isOnline) return;
    if (orderType === 'DINE_IN' && !tableId) return setMessage('Choose a table for a dine-in order.');
    setBusy(true);
    setMessage(null);
    try {
      const response = await apiRequest<ApiEnvelope<{ order: CreatedOrder }>>(`/branches/${branchId}/orders`, {
        method: 'POST',
        accessToken,
        csrfToken,
        tenantId,
        body: {
          orderType,
          tableId: orderType === 'DINE_IN' ? tableId : undefined,
          notes: notes || undefined,
          idempotencyKey: orderKey.current,
          quotedTotal: cartSubtotal.toString(),
          lines: cart.map((line) => ({
            variantId: line.variant.id,
            quantity: line.quantity,
            modifierOptionIds: Object.values(line.selectedModifiers).flat(),
            notes: line.notes || undefined,
          })),
        },
      });
      setPending(response.data.order);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const details = error.details as { code?: string; serverTotal?: string; message?: string } | undefined;
        if (details?.code === 'PRICE_CHANGED') {
          setMessage(`Prices changed since you added items. Server total: ${details.serverTotal ? formatEtbMinor(details.serverTotal) : 'unknown'}. Please review your cart.`);
        } else {
          setMessage('The menu or order changed. Refresh the menu and review the ticket before retrying.');
        }
      } else {
        setMessage(error instanceof ApiError ? error.message : 'Could not create the order.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmCash() {
    if (!pending || !isOnline) return;
    if (!shiftQuery.data) return setMessage('Open a cash shift before confirming this payment.');
    setBusy(true);
    setMessage(null);
    try {
      const created = await apiRequest<{ data: { id: string } }>(`/branches/${branchId}/payments/cash`, {
        method: 'POST',
        accessToken,
        csrfToken,
        tenantId,
        body: { orderId: pending.id, idempotencyKey: paymentKey.current },
      });
      await apiRequest(`/branches/${branchId}/payments/${created.data.id}/confirm-cash`, {
        method: 'POST',
        accessToken,
        csrfToken,
        tenantId,
      });
      setMessage(`Order #${pending.orderNumber} confirmed and released to the kitchen.`);
      setCart([]);
      setPending(null);
      setNotes('');
      orderKey.current = newIdempotencyKey();
      paymentKey.current = newIdempotencyKey();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Cash confirmation failed. No success has been recorded.');
    } finally {
      setBusy(false);
    }
  }

  if (!membership || !['OWNER', 'MANAGER', 'CASHIER'].includes(membership.role)) return <p role="alert">Permission denied.</p>;

  return (
    <div className="mx-auto max-w-[1500px]">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-wider text-brand">Point of sale</p>
          <h1 className="mt-2 text-3xl font-black">New order</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {shiftQuery.data ? 'Cash shift active' : 'Cash confirmation unavailable until a shift is opened.'}
          </p>
        </div>
        {!shiftQuery.data && (
          <a href="/shifts" className="grid min-h-11 place-items-center rounded-xl bg-[#18241f] px-5 font-black text-white">
            Open shift
          </a>
        )}
      </header>

      {message && (
        <div role="alert" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">
          {message}
        </div>
      )}

      {!isOnline && (
        <div role="status" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-900">
          You are offline. Order creation is disabled until connection is restored.
        </div>
      )}

      <div className="mt-6 grid gap-5 xl:grid-cols-[1fr_390px]">
        <section>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search menu"
            className="min-h-12 w-full rounded-xl border border-line bg-white px-4"
          />
          <div className="hide-scrollbar mt-4 flex gap-2 overflow-auto">
            <button
              onClick={() => setCategory('')}
              className={`min-h-11 shrink-0 rounded-full px-4 font-bold ${!category ? 'bg-[#18241f] text-white' : 'bg-white'}`}
            >
              All
            </button>
            {categories.map((g) => (
              <button
                key={g.id}
                onClick={() => setCategory(g.id)}
                className={`min-h-11 shrink-0 rounded-full px-4 font-bold ${category === g.id ? 'bg-[#18241f] text-white' : 'bg-white'}`}
              >
                {g.name}
              </button>
            ))}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3">
            {items.map((item) => {
              const variant = item.variants.find((v) => v.isDefault) ?? item.variants[0];
              const needsSelection = item.variants.length > 1 || item.modifierGroups.length > 0;
              return (
                <button
                  key={item.id}
                  disabled={!variant}
                  onClick={() => (needsSelection ? openModifierSelector(item) : addQuick(item))}
                  className="min-h-40 rounded-2xl border border-line bg-white p-4 text-left shadow-card"
                >
                  <b>{item.name}</b>
                  <p className="mt-2 line-clamp-2 text-xs text-ink-muted">{item.description}</p>
                  {item.modifierGroups.length > 0 && (
                    <p className="mt-1 text-[10px] font-bold uppercase text-brand">
                      {item.modifierGroups.filter((g) => g.isRequired).length > 0 ? 'Required options' : 'Optional options'}
                    </p>
                  )}
                  <p className="mt-3 font-black text-brand">
                    {variant ? formatEtbMinor(variant.priceMinor) : 'Unavailable'}
                  </p>
                </button>
              );
            })}
          </div>
        </section>

        <aside className="h-fit rounded-2xl border border-line bg-white p-5 shadow-card">
          <div className="flex items-center justify-between">
            <h2 className="font-black">Order</h2>
            {cart.length > 0 && (
              <button onClick={() => { setCart([]); setNotes(''); setPending(null); setMessage(null); }} className="text-xs font-bold text-ink-muted hover:text-red-600">
                Clear all
              </button>
            )}
          </div>
          {cart.length === 0 ? (
            <p className="mt-4 text-sm text-ink-muted">No items yet.</p>
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {cart.map((line) => {
                const modTotal = Object.values(line.selectedModifiers)
                  .flat()
                  .reduce((acc, optId) => {
                    const opt = line.item.modifierGroups.flatMap((g) => g.options).find((o) => o.id === optId);
                    return acc + (opt ? BigInt(opt.priceDeltaMinor) : 0n);
                  }, 0n);
                const unitTotal = BigInt(line.variant.priceMinor) + modTotal;
                return (
                  <li key={line.lineKey} className="py-3">
                    <div className="flex justify-between gap-2">
                      <b className="text-sm">{line.item.name}</b>
                      <span className="text-sm font-black">{formatEtbMinor(unitTotal * BigInt(line.quantity))}</span>
                    </div>
                    <p className="text-xs text-ink-muted">{line.variant.name}</p>
                    {Object.values(line.selectedModifiers).flat().length > 0 && (
                      <p className="text-[10px] text-ink-muted">
                        {Object.entries(line.selectedModifiers).map(([gid, opts]) => {
                          const group = line.item.modifierGroups.find((g) => g.id === gid);
                          return opts.map((optId) => {
                            const opt = group?.options.find((o) => o.id === optId);
                            return opt ? opt.name : '';
                          }).filter(Boolean).join(', ');
                        }).filter(Boolean).join(' · ')}
                      </p>
                    )}
                    {line.notes && <p className="text-[10px] text-ink-muted">Note: {line.notes}</p>}
                    <div className="mt-2 flex items-center gap-2">
                      <button onClick={() => updateLineQty(line.lineKey, -1)} className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-white text-sm font-bold">
                        −
                      </button>
                      <span className="w-8 text-center text-sm font-black">{line.quantity}</span>
                      <button onClick={() => updateLineQty(line.lineKey, 1)} className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-white text-sm font-bold">
                        +
                      </button>
                      <button
                        onClick={() => {
                          setModifierModal({ item: line.item, editLineKey: line.lineKey });
                        }}
                        className="ml-2 text-[10px] font-bold text-brand hover:underline"
                      >
                        Edit
                      </button>
                      <button onClick={() => removeLine(line.lineKey)} className="ml-auto text-[10px] font-bold text-red-600 hover:underline">
                        Remove
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {cart.length > 0 && (
            <div className="mt-4 border-t border-line pt-4">
              <div className="flex justify-between text-sm">
                <span className="text-ink-muted">Subtotal (before VAT)</span>
                <span className="font-black">{formatEtbMinor(cartSubtotal)}</span>
              </div>
              {pending && (
                <>
                  <div className="mt-1 flex justify-between text-sm">
                    <span className="text-ink-muted">VAT</span>
                    <span className="font-black">{formatEtbMinor(pending.taxMinor)}</span>
                  </div>
                  <div className="mt-1 flex justify-between text-lg">
                    <span className="font-black">Total payable</span>
                    <span className="font-black text-brand">{formatEtbMinor(pending.totalMinor)}</span>
                  </div>
                </>
              )}
            </div>
          )}

          {orderType === 'DINE_IN' && (
            <div className="mt-4">
              <label className="text-xs font-bold text-ink-muted">Table</label>
              <select
                value={tableId}
                onChange={(e) => setTableId(e.target.value)}
                className="mt-1 min-h-11 w-full rounded-xl border border-line bg-white px-3"
              >
                <option value="">Select table…</option>
                {tablesQuery.data?.filter((t) => t.isActive).map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </div>
          )}

          {!pending ? (
            <button
              onClick={createOrder}
              disabled={busy || !cart.length || !isOnline}
              className="mt-4 min-h-12 w-full rounded-xl bg-[#18241f] font-black text-white disabled:opacity-50"
            >
              {busy ? 'Creating…' : 'Create order'}
            </button>
          ) : (
            <button
              onClick={confirmCash}
              disabled={busy || !shiftQuery.data || !isOnline}
              className="mt-4 min-h-12 w-full rounded-xl bg-[#18241f] font-black text-white disabled:opacity-50"
            >
              {busy ? 'Confirming…' : `Confirm cash — ${formatEtbMinor(pending.totalMinor)}`}
            </button>
          )}
        </aside>
      </div>

      {variantModal && (
        <VariantSelector
          item={variantModal}
          onSelect={(variant) => selectVariant(variantModal, variant)}
          onClose={() => setVariantModal(null)}
        />
      )}

      {modifierModal && (
        <ModifierSelector
          item={modifierModal.item}
          editLineKey={modifierModal.editLineKey}
          existingLine={modifierModal.editLineKey ? cart.find((l) => l.lineKey === modifierModal.editLineKey) : undefined}
          onConfirm={(variant, selectedModifiers, lineNotes) => {
            addToCart(modifierModal.item, variant, selectedModifiers, lineNotes, modifierModal.editLineKey);
            setModifierModal(null);
          }}
          onClose={() => setModifierModal(null)}
        />
      )}
    </div>
  );
}

function VariantSelector({
  item,
  onSelect,
  onClose,
}: {
  item: Item;
  onSelect: (variant: Variant) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40" role="dialog" aria-modal="true" aria-label={`Select variant for ${item.name}`}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lg">
        <h2 className="text-xl font-black">{item.name}</h2>
        <p className="mt-1 text-sm text-ink-muted">Choose a size or variant</p>
        <div className="mt-4 space-y-2">
          {item.variants.filter((v) => v.isDefault || item.variants.length > 1).map((variant) => (
            <button
              key={variant.id}
              onClick={() => onSelect(variant)}
              className="flex w-full items-center justify-between rounded-xl border border-line p-4 text-left hover:bg-orange-50"
            >
              <span className="font-bold">{variant.name}</span>
              <span className="font-black text-brand">{formatEtbMinor(variant.priceMinor)}</span>
            </button>
          ))}
        </div>
        <button onClick={onClose} className="mt-4 min-h-11 w-full rounded-xl border border-line bg-white font-bold">
          Cancel
        </button>
      </div>
    </div>
  );
}

function ModifierSelector({
  item,
  editLineKey,
  existingLine,
  onConfirm,
  onClose,
}: {
  item: Item;
  editLineKey?: string;
  existingLine?: CartLine;
  onConfirm: (variant: Variant, selectedModifiers: Record<string, string[]>, notes: string) => void;
  onClose: () => void;
}) {
  const defaultVariant = item.variants.find((v) => v.isDefault) ?? item.variants[0];
  const [selectedVariant, setSelectedVariant] = useState<Variant>(existingLine?.variant ?? defaultVariant);
  const [selections, setSelections] = useState<Record<string, string[]>>(
    existingLine?.selectedModifiers ?? Object.fromEntries(item.modifierGroups.map((g) => [g.id, []])),
  );
  const [notes, setNotes] = useState(existingLine?.notes ?? '');
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  function toggleOption(groupId: string, optionId: string) {
    const group = item.modifierGroups.find((g) => g.id === groupId);
    if (!group) return;
    setSelections((prev) => {
      const current = prev[groupId] ?? [];
      const isSelected = current.includes(optionId);
      if (isSelected) {
        return { ...prev, [groupId]: current.filter((id) => id !== optionId) };
      }
      if (group.maxSelections !== null && current.length >= group.maxSelections) {
        return prev;
      }
      return { ...prev, [groupId]: [...current, optionId] };
    });
    setValidationErrors([]);
  }

  function validate(): boolean {
    const errors: string[] = [];
    for (const group of item.modifierGroups) {
      const count = selections[group.id]?.length ?? 0;
      if (group.isRequired && count < 1) {
        errors.push(`${group.name} requires at least one selection`);
      }
      if (count < group.minSelections) {
        errors.push(`${group.name} requires at least ${group.minSelections} selections`);
      }
      if (group.maxSelections !== null && count > group.maxSelections) {
        errors.push(`${group.name} allows at most ${group.maxSelections} selections`);
      }
    }
    setValidationErrors(errors);
    return errors.length === 0;
  }

  function handleConfirm() {
    if (!validate()) return;
    onConfirm(selectedVariant, selections, notes);
  }

  const modifierDelta = Object.values(selections)
    .flat()
    .reduce((acc, optId) => {
      const opt = item.modifierGroups.flatMap((g) => g.options).find((o) => o.id === optId);
      return acc + (opt ? BigInt(opt.priceDeltaMinor) : 0n);
    }, 0n);
  const unitTotal = BigInt(selectedVariant.priceMinor) + modifierDelta;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40" role="dialog" aria-modal="true" aria-label={`Customize ${item.name}`}>
      <div className="w-full max-w-lg max-h-[85vh] overflow-auto rounded-2xl bg-white p-6 shadow-lg">
        <h2 className="text-xl font-black">{item.name}</h2>
        <p className="mt-1 text-sm text-ink-muted">{item.description}</p>

        {item.variants.length > 1 && (
          <div className="mt-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-ink-muted">Size / variant</h3>
            <div className="mt-2 flex gap-2">
              {item.variants.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setSelectedVariant(v)}
                  className={`min-h-10 rounded-xl px-4 text-sm font-bold ${
                    selectedVariant.id === v.id ? 'bg-[#18241f] text-white' : 'border border-line bg-white'
                  }`}
                >
                  {v.name} — {formatEtbMinor(v.priceMinor)}
                </button>
              ))}
            </div>
          </div>
        )}

        {item.modifierGroups.map((group) => (
          <div key={group.id} className="mt-5">
            <h3 className="text-xs font-black uppercase tracking-wider text-ink-muted">
              {group.name}
              {group.isRequired && <span className="ml-1 text-red-600">*</span>}
              {group.maxSelections !== null && <span className="ml-1 text-ink-muted">— max {group.maxSelections}</span>}
            </h3>
            <div className="mt-2 space-y-1">
              {group.options.map((opt) => {
                const checked = selections[group.id]?.includes(opt.id) ?? false;
                return (
                  <label
                    key={opt.id}
                    className={`flex items-center gap-3 rounded-xl border p-3 text-sm cursor-pointer ${
                      checked ? 'border-brand bg-orange-50' : 'border-line bg-white'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleOption(group.id, opt.id)}
                      className="h-4 w-4 accent-brand"
                    />
                    <span className="flex-1 font-bold">{opt.name}</span>
                    {opt.priceDeltaMinor !== '0' && (
                      <span className="text-xs text-ink-muted">
                        {BigInt(opt.priceDeltaMinor) > 0 ? '+' : ''}{formatEtbMinor(opt.priceDeltaMinor)}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        ))}

        <div className="mt-5">
          <label className="text-xs font-black uppercase tracking-wider text-ink-muted">Notes (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, 500))}
            placeholder="Special instructions…"
            rows={2}
            className="mt-2 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm"
          />
        </div>

        {validationErrors.length > 0 && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-800">
            {validationErrors.map((err, i) => <p key={i}>{err}</p>)}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
          <span className="text-lg font-black text-brand">{formatEtbMinor(unitTotal)}</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="min-h-11 rounded-xl border border-line bg-white px-5 font-bold">
              Cancel
            </button>
            <button onClick={handleConfirm} className="min-h-11 rounded-xl bg-[#18241f] px-5 font-black text-white">
              {editLineKey ? 'Update item' : 'Add to order'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
