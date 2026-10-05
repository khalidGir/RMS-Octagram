'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ApiError, apiRequest, newIdempotencyKey, type ApiEnvelope } from '@/lib/api-client';
import { normalizePublicMenu } from '@/lib/public-menu';
import { useAuth } from './auth-provider';
import { useLocale } from '@/components/locale-provider';
import { useOnlineStatus } from '@/hooks';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MenuItemPhoto } from './menu-item-photo';
import type { MenuItemImage } from '@/lib/menu-image';

interface ModifierOption { id: string; name: string; priceDeltaMinor: string; }
interface ModifierGroup { id: string; name: string; isRequired: boolean; minSelections: number; maxSelections: number | null; options: ModifierOption[]; }
interface Variant { id: string; name: string; basePriceMinor: string; isDefault: boolean; sku?: string | null; }
interface Item { id: string; name: string; description: string | null; variants: Variant[]; modifierGroups: ModifierGroup[]; image?: MenuItemImage | null; }
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

interface EditOrderLineModifier {
  modifierOptionId: string | null;
}

interface EditOrderLine {
  id: string;
  variantId: string | null;
  quantity: number;
  notes: string | null;
  modifiers: EditOrderLineModifier[];
}

interface EditOrder {
  id: string;
  orderNumber: string;
  status: string;
  version: number;
  notes: string | null;
  lines: EditOrderLine[];
}

function makeLineKey(variantId: string, modifierSelections: Record<string, string[]>, notes: string): string {
  const modParts = Object.entries(modifierSelections)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([gid, opts]) => `${gid}:${[...opts].sort().join(',')}`)
    .join('|');
  return `${variantId}__${modParts}__${notes.trim().slice(0, 200)}`;
}

interface StaleLine {
  variantId: string;
  lineTotal: string;
}

interface StalePriceDetail {
  code?: string;
  serverTotal?: string;
  message?: string;
  lines?: StaleLine[];
}

function findCartLineForVariant(cart: CartLine[], variantId: string): CartLine | undefined {
  return cart.find((l) => l.variant.id === variantId);
}

export function PosWorkspace() {
  const { accessToken, csrfToken, profile } = useAuth();
  const { formatCurrency, tr } = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const editOrderId = searchParams.get('edit');
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
  const [staleDetail, setStaleDetail] = useState<StalePriceDetail | null>(null);
  const [editVersion, setEditVersion] = useState<number | null>(null);

  const orderKey = useRef(newIdempotencyKey());
  const paymentKey = useRef(newIdempotencyKey());
  const editKey = useRef(newIdempotencyKey());
  const initializedEditRef = useRef<string | null>(null);

  const [modifierModal, setModifierModal] = useState<{
    item: Item;
    editLineKey?: string;
  } | null>(null);
  const [variantModal, setVariantModal] = useState<Item | null>(null);

  const menuQuery = useQuery({
    queryKey: ['pos-menu', tenantId, branchId],
    enabled: Boolean(tenantId && branchId),
    queryFn: async () => normalizePublicMenu((await apiRequest<ApiEnvelope<Menu>>(`/public/tenants/${tenantId}/branches/${branchId}/menu`)).data),
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

  const editQuery = useQuery({
    queryKey: ['pos-edit-order', editOrderId],
    enabled: Boolean(editOrderId && accessToken && tenantId),
    queryFn: async () =>
      (await apiRequest<ApiEnvelope<EditOrder>>(`/orders/${editOrderId}`, { accessToken, csrfToken, tenantId })).data,
    staleTime: 0,
  });

  // Load an existing order into the cart when opened in edit mode (?edit=<orderId>).
  // The cart is initialised exactly once per order so later refetches (for example
  // after a VERSION_CONFLICT) only refresh the optimistic-lock version.
  useEffect(() => {
    if (!editOrderId || !editQuery.data) return;
    if (initializedEditRef.current === editOrderId) {
      setEditVersion(editQuery.data.version);
      return;
    }
    const categories = menuQuery.data?.categories;
    if (!categories) return;

    const allItems = categories.flatMap((group) => group.items);
    const nextCart: CartLine[] = [];
    for (const line of editQuery.data.lines) {
      const item = line.variantId
        ? allItems.find((candidate) => candidate.variants.some((variant) => variant.id === line.variantId))
        : undefined;
      const variantObj = item?.variants.find((variant) => variant.id === line.variantId);
      if (!item || !variantObj) {
        initializedEditRef.current = editOrderId;
        setCart([]);
        setMessage(tr('pos.editVariantMissing'));
        return;
      }
      const optionIds = line.modifiers
        .map((modifier) => modifier.modifierOptionId)
        .filter((optionId): optionId is string => Boolean(optionId));
      const selectedModifiers: Record<string, string[]> = {};
      for (const optionId of optionIds) {
        const group = item.modifierGroups.find((candidate) => candidate.options.some((option) => option.id === optionId));
        if (group) {
          selectedModifiers[group.id] = [...(selectedModifiers[group.id] ?? []), optionId];
        }
      }
      nextCart.push({
        lineKey: makeLineKey(variantObj.id, selectedModifiers, line.notes ?? ''),
        item,
        variant: variantObj,
        quantity: line.quantity,
        selectedModifiers,
        notes: line.notes ?? '',
      });
    }
    initializedEditRef.current = editOrderId;
    setCart(nextCart);
    setNotes(editQuery.data.notes ?? '');
    setEditVersion(editQuery.data.version);
  }, [editOrderId, editQuery.data, menuQuery.data, tr]);

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
    const variantPrice = BigInt(line.variant.basePriceMinor);
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
    if (orderType === 'DINE_IN' && !tableId) return setMessage(tr('pos.chooseTable'));
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
        const details = error.details as StalePriceDetail | undefined;
        if (details?.code === 'PRICE_CHANGED') {
          setStaleDetail(details);
          setMessage(tr('pos.priceChanged'));
          void menuQuery.refetch();
        } else {
          setMessage(tr('pos.menuOrderChanged'));
        }
      } else {
        setMessage(error instanceof ApiError ? error.message : tr('pos.createOrderFailed'));
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    if (!editOrderId || !cart.length || editVersion === null || !isOnline) return;
    setBusy(true);
    setMessage(null);
    try {
      await apiRequest(`/orders/${editOrderId}`, {
        method: 'PATCH',
        accessToken,
        csrfToken,
        tenantId,
        body: {
          lines: cart.map((line) => ({
            variantId: line.variant.id,
            quantity: line.quantity,
            modifierOptionIds: Object.values(line.selectedModifiers).flat(),
            notes: line.notes || undefined,
          })),
          notes: notes || undefined,
          expectedVersion: editVersion,
          quotedTotal: cartSubtotal.toString(),
          idempotencyKey: editKey.current,
        },
      });
      router.push(`/orders/${editOrderId}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const details = error.details as StalePriceDetail | undefined;
        if (details?.code === 'PRICE_CHANGED') {
          setStaleDetail(details);
          setMessage(tr('pos.priceChanged'));
          void menuQuery.refetch();
        } else if (details?.code === 'VERSION_CONFLICT') {
          setMessage(tr('pos.editVersionConflict'));
          void editQuery.refetch();
        } else {
          setMessage(error.message);
        }
      } else {
        setMessage(error instanceof ApiError ? error.message : tr('pos.editSaveFailed'));
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmCash() {
    if (!pending || !isOnline) return;
    if (!shiftQuery.data) return setMessage(tr('pos.openShiftFirst'));
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
      setMessage(tr('pos.orderConfirmed', { number: pending.orderNumber }));
      setCart([]);
      setPending(null);
      setNotes('');
      orderKey.current = newIdempotencyKey();
      paymentKey.current = newIdempotencyKey();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : tr('pos.cashConfirmFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (!membership || !['OWNER', 'MANAGER', 'CASHIER'].includes(membership.role)) return <p role="alert">{tr('pos.permissionDenied')}</p>;

  return (
    <div className="mx-auto max-w-[1500px]">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-wider text-brand">{editOrderId ? tr('pos.editEyebrow') : tr('pos.eyebrow')}</p>
          <h1 className="text-3xl font-black">{editOrderId ? tr('pos.editTitle', { number: editQuery.data?.orderNumber ?? '' }) : tr('pos.title')}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {shiftQuery.data ? tr('pos.shiftActive') : tr('pos.shiftUnavailable')}
          </p>
        </div>
        {editOrderId ? (
          <button
            type="button"
            onClick={() => router.push(`/orders/${editOrderId}`)}
            className="grid min-h-11 place-items-center rounded-xl border border-line bg-white px-5 font-black"
          >
            {tr('pos.editBack')}
          </button>
        ) : (
          !shiftQuery.data && (
            <a href="/shifts" className="grid min-h-11 place-items-center rounded-xl bg-dark px-5 font-black text-white">
              {tr('pos.openShift')}
            </a>
          )
        )}
      </header>

      {editOrderId && editQuery.isError && (
        <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-900">
          {tr('pos.editLoadFailed')}
        </div>
      )}

      {message && (
        <div role="alert" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">
          {message}
        </div>
      )}

      {staleDetail?.lines && staleDetail.lines.length > 0 && (
        <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="text-xs font-black uppercase tracking-wider text-amber-800">{tr('pos.affectedLines')}</p>
          <ul className="mt-2 divide-y divide-amber-200">
            {staleDetail.lines.map((sl) => {
              const cartLine = findCartLineForVariant(cart, sl.variantId);
              return (
                <li key={sl.variantId} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span>
                    <b>{cartLine?.item.name ?? tr('pos.unknownItem')}</b>
                    <span className="ms-1 text-ink-muted">{cartLine?.variant.name ?? sl.variantId}</span>
                  </span>
                  <span className="font-black text-amber-900">{formatCurrency(sl.lineTotal)}</span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-ink-muted">
            {tr('pos.staleServerTotal', { total: staleDetail.serverTotal ? formatCurrency(staleDetail.serverTotal) : tr('pos.staleUnknownTotal') })}{' '}
            {tr('pos.staleInstruction')}
          </p>
          <button
            onClick={() => setStaleDetail(null)}
            className="mt-3 min-h-9 rounded-lg border border-amber-300 bg-white px-4 text-xs font-bold text-amber-800 hover:bg-amber-100"
          >
            {tr('pos.dismiss')}
          </button>
        </div>
      )}

      {!isOnline && (
        <div role="status" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-900">
          {tr('pos.offlineNotice')}
        </div>
      )}

      <div className="mt-6 grid gap-5 xl:grid-cols-[1fr_390px]">
        <section>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tr('pos.searchMenu')}
            aria-label={tr('pos.searchMenu')}
            className="min-h-12 w-full rounded-xl border border-line bg-white px-4"
          />
          <div className="hide-scrollbar mt-4 flex gap-2 overflow-auto">
            <button
              onClick={() => setCategory('')}
              className={`min-h-11 shrink-0 rounded-full px-4 font-bold ${!category ? 'bg-dark text-white' : 'bg-white'}`}
            >
              {tr('orders.filterAll')}
            </button>
            {categories.map((g) => (
              <button
                key={g.id}
                onClick={() => setCategory(g.id)}
                className={`min-h-11 shrink-0 rounded-full px-4 font-bold ${category === g.id ? 'bg-dark text-white' : 'bg-white'}`}
              >
                {g.name}
              </button>
            ))}
          </div>
          {menuQuery.isLoading ? (
            <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-40 animate-pulse rounded-2xl bg-white" />
              ))}
            </div>
          ) : menuQuery.isError ? (
            <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-6 text-center">
              <p className="text-sm font-bold text-red-800">{tr('pos.loadMenuFailed')}</p>
              <button onClick={() => void menuQuery.refetch()} className="mt-3 min-h-9 rounded-lg bg-red-700 px-4 text-xs font-black text-white">{tr('pos.retry')}</button>
            </div>
          ) : items.length === 0 ? (
            <div className="mt-5 rounded-xl border border-line bg-white p-6 text-center">
              <p className="text-sm font-bold text-ink-muted">{tr('pos.noMenuItems')}</p>
            </div>
          ) : (
            <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3">
              {items.map((item) => {
              const variant = item.variants.find((v) => v.isDefault) ?? item.variants[0];
              const needsSelection = item.variants.length > 1 || item.modifierGroups.length > 0;
              return (
                <button
                  key={item.id}
                  disabled={!variant}
                  onClick={() => (needsSelection ? openModifierSelector(item) : addQuick(item))}
                  className="min-h-40 overflow-hidden rounded-2xl border border-line bg-white text-start shadow-card"
                >
                  <MenuItemPhoto image={item.image} name={item.name} className="h-24" />
                  <div className="p-4"><b>{item.name}</b>
                  <p className="mt-2 line-clamp-2 text-xs text-ink-muted">{item.description}</p>
                  {item.modifierGroups.length > 0 && (
                    <p className="mt-1 text-[10px] font-bold uppercase text-brand">
                      {item.modifierGroups.filter((g) => g.isRequired).length > 0 ? tr('pos.requiredOptions') : tr('pos.optionalOptions')}
                    </p>
                  )}
                  <p className="mt-3 font-black text-brand">
                    {variant ? formatCurrency(variant.basePriceMinor) : tr('pos.unavailable')}
                  </p>
                  </div>
                </button>
              );
            })}
            </div>
          )}
        </section>

        <aside className="h-fit rounded-2xl border border-line bg-white p-5 shadow-card">
          <div className="flex items-center justify-between">
            <h2 className="font-black">{tr('pos.orderTitle')}</h2>
            {cart.length > 0 && (
              <button onClick={() => { setCart([]); setNotes(''); setPending(null); setMessage(null); }} className="text-xs font-bold text-ink-muted hover:text-red-600">
                {tr('pos.clearAll')}
              </button>
            )}
          </div>
          {cart.length === 0 ? (
            <p className="mt-4 text-sm text-ink-muted">{tr('pos.emptyCart')}</p>
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {cart.map((line) => {
                const modTotal = Object.values(line.selectedModifiers)
                  .flat()
                  .reduce((acc, optId) => {
                    const opt = line.item.modifierGroups.flatMap((g) => g.options).find((o) => o.id === optId);
                    return acc + (opt ? BigInt(opt.priceDeltaMinor) : 0n);
                  }, 0n);
                const unitTotal = BigInt(line.variant.basePriceMinor) + modTotal;
                return (
                  <li key={line.lineKey} className="py-3">
                    <div className="flex justify-between gap-2">
                      <b className="text-sm">{line.item.name}</b>
                      <span className="text-sm font-black">{formatCurrency(unitTotal * BigInt(line.quantity))}</span>
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
                    {line.notes && <p className="text-[10px] text-ink-muted">{tr('pos.notePrefix', { note: line.notes })}</p>}
                    <div className="mt-2 flex items-center gap-2">
                      <button onClick={() => updateLineQty(line.lineKey, -1)} aria-label={tr('pos.decreaseQty', { name: line.item.name })} className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-white text-sm font-bold">
                        −
                      </button>
                      <span className="w-8 text-center text-sm font-black">{line.quantity}</span>
                      <button onClick={() => updateLineQty(line.lineKey, 1)} aria-label={tr('pos.increaseQty', { name: line.item.name })} className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-white text-sm font-bold">
                        +
                      </button>
                      <button
                        onClick={() => {
                          setModifierModal({ item: line.item, editLineKey: line.lineKey });
                        }}
                        className="ms-2 text-[10px] font-bold text-brand hover:underline"
                      >
                        {tr('pos.edit')}
                      </button>
                      <button onClick={() => removeLine(line.lineKey)} className="ms-auto text-[10px] font-bold text-red-600 hover:underline">
                        {tr('pos.remove')}
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
                <span className="text-ink-muted">{tr('pos.subtotalLabel')}</span>
                <span className="font-black">{formatCurrency(cartSubtotal)}</span>
              </div>
              {pending && (
                <>
                  <div className="mt-1 flex justify-between text-sm">
                    <span className="text-ink-muted">{tr('pos.vatLabel')}</span>
                    <span className="font-black">{formatCurrency(pending.taxMinor)}</span>
                  </div>
                  <div className="mt-1 flex justify-between text-lg">
                    <span className="font-black">{tr('pos.totalLabel')}</span>
                    <span className="font-black text-brand">{formatCurrency(pending.totalMinor)}</span>
                  </div>
                </>
              )}
            </div>
          )}

          {orderType === 'DINE_IN' && (
            <div className="mt-4">
              <label className="text-xs font-bold text-ink-muted">{tr('pos.tableLabel')}</label>
              <Select value={tableId || undefined} onValueChange={setTableId}><SelectTrigger className="mt-1"><SelectValue placeholder={tr('pos.selectTable')} /></SelectTrigger><SelectContent>{tablesQuery.data?.filter((t) => t.isActive).map((t) => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}</SelectContent></Select>
            </div>
          )}

          {editOrderId ? (
            <button
              onClick={() => void saveEdit()}
              disabled={busy || !cart.length || editVersion === null || !isOnline}
              className="mt-4 min-h-12 w-full rounded-xl bg-dark font-black text-white disabled:opacity-50"
            >
              {busy ? tr('pos.editSaving') : tr('pos.editSave')}
            </button>
          ) : !pending ? (
            <button
              onClick={createOrder}
              disabled={busy || !cart.length || !isOnline}
              className="mt-4 min-h-12 w-full rounded-xl bg-dark font-black text-white disabled:opacity-50"
            >
              {busy ? tr('pos.creating') : tr('pos.createOrder')}
            </button>
          ) : (
            <button
              onClick={confirmCash}
              disabled={busy || !shiftQuery.data || !isOnline}
              className="mt-4 min-h-12 w-full rounded-xl bg-dark font-black text-white disabled:opacity-50"
            >
              {busy ? tr('pos.confirming') : tr('pos.confirmCash', { total: formatCurrency(pending.totalMinor) })}
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
  const { formatCurrency, tr } = useLocale();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;
    cancelRef.current?.focus();
    const root = document.getElementById('__next');
    if (root) root.inert = true;
    const dialog = dialogRef.current;
    if (!dialog) return;
    function getFocusable(): HTMLElement[] {
      return Array.from(dialog!.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const focusable = getFocusable();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      if (root) root.inert = false;
      previousFocusRef.current?.focus();
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40" role="dialog" aria-modal="true" aria-label={tr('pos.selectVariant', { name: item.name })}>
      <div ref={dialogRef} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lg">
        <h2 className="text-xl font-black">{item.name}</h2>
        <p className="mt-1 text-sm text-ink-muted">{tr('pos.chooseVariant')}</p>
        <div className="mt-4 space-y-2">
          {item.variants.filter((v) => v.isDefault || item.variants.length > 1).map((variant) => (
            <button
              key={variant.id}
              onClick={() => onSelect(variant)}
              className="flex w-full items-center justify-between rounded-xl border border-line p-4 text-start hover:bg-orange-50"
            >
              <span className="font-bold">{variant.name}</span>
              <span className="font-black text-brand">{formatCurrency(variant.basePriceMinor)}</span>
            </button>
          ))}
        </div>
        <button ref={cancelRef} onClick={onClose} className="mt-4 min-h-11 w-full rounded-xl border border-line bg-white font-bold">
          {tr('pos.cancel')}
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
  const { formatCurrency, tr } = useLocale();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;
    cancelRef.current?.focus();
    const root = document.getElementById('__next');
    if (root) root.inert = true;
    const dialog = dialogRef.current;
    if (!dialog) return;
    function getFocusable(): HTMLElement[] {
      return Array.from(dialog!.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const focusable = getFocusable();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      if (root) root.inert = false;
      previousFocusRef.current?.focus();
    };
  }, [onClose]);
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
        errors.push(tr('pos.requiresOne', { group: group.name }));
      }
      if (count < group.minSelections) {
        errors.push(tr('pos.requiresMin', { group: group.name, count: group.minSelections }));
      }
      if (group.maxSelections !== null && count > group.maxSelections) {
        errors.push(tr('pos.allowsMax', { group: group.name, count: group.maxSelections }));
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
  const unitTotal = BigInt(selectedVariant.basePriceMinor) + modifierDelta;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40" role="dialog" aria-modal="true" aria-label={tr('pos.customize', { name: item.name })}>
      <div ref={dialogRef} className="w-full max-w-lg max-h-[85vh] overflow-auto rounded-2xl bg-white p-6 shadow-lg">
        <h2 className="text-xl font-black">{item.name}</h2>
        <p className="mt-1 text-sm text-ink-muted">{item.description}</p>

        {item.variants.length > 1 && (
          <div className="mt-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-ink-muted">{tr('pos.sizeVariant')}</h3>
            <div className="mt-2 flex gap-2">
              {item.variants.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setSelectedVariant(v)}
                  className={`min-h-10 rounded-xl px-4 text-sm font-bold ${
                    selectedVariant.id === v.id ? 'bg-dark text-white' : 'border border-line bg-white'
                  }`}
                >
                  {v.name} — {formatCurrency(v.basePriceMinor)}
                </button>
              ))}
            </div>
          </div>
        )}

        {item.modifierGroups.map((group) => (
          <div key={group.id} className="mt-5">
            <h3 className="text-xs font-black uppercase tracking-wider text-ink-muted">
              {group.name}
              {group.isRequired && <span className="ms-1 text-red-600">*</span>}
              {group.maxSelections !== null && <span className="ms-1 text-ink-muted">{tr('pos.maxSuffix', { count: group.maxSelections })}</span>}
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
                        {BigInt(opt.priceDeltaMinor) > 0 ? '+' : ''}{formatCurrency(opt.priceDeltaMinor)}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        ))}

        <div className="mt-5">
          <label className="text-xs font-black uppercase tracking-wider text-ink-muted">{tr('pos.notesLabel')}</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, 500))}
            placeholder={tr('pos.notesPlaceholder')}
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
          <span className="text-lg font-black text-brand">{formatCurrency(unitTotal)}</span>
          <div className="flex gap-2">
            <button ref={cancelRef} onClick={onClose} className="min-h-11 rounded-xl border border-line bg-white px-5 font-bold">
              {tr('pos.cancel')}
            </button>
            <button onClick={handleConfirm} className="min-h-11 rounded-xl bg-dark px-5 font-black text-white">
              {editLineKey ? tr('pos.updateItem') : tr('pos.addToOrder')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
