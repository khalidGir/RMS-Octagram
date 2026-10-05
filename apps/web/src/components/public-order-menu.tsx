'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { apiRequest, ApiError, type ApiEnvelope } from '@/lib/api-client';
import { useTableServiceRequests, useCreateServiceRequest, type ServiceRequestType } from '@/lib/use-service-requests';
import { normalizePublicMenu } from '@/lib/public-menu';
import { useLocale } from './locale-provider';
import { LanguagePicker } from './language-picker';
import { Button, Dialog, DialogContent, DialogTitle } from './ui';
import { MenuItemPhoto } from './menu-item-photo';
import type { MenuItemImage } from '@/lib/menu-image';

interface PublicModifierOption { id: string; name: string; priceDeltaMinor: string; isActive?: boolean }
interface PublicModifierGroup { id: string; name: string; isRequired: boolean; minSelections: number; maxSelections: number | null; options: PublicModifierOption[] }

interface PublicMenuItem {
  id: string;
  name: string;
  description: string | null;
  variants: Array<{ id: string; name: string; basePriceMinor: string; isDefault: boolean }>;
  modifierGroups: PublicModifierGroup[];
  image?: MenuItemImage | null;
}

interface PublicMenu {
  tenant: { id: string; name: string };
  branch: { id: string; name: string };
  categories: Array<{ id: string; name: string; items: PublicMenuItem[] }>;
}

interface PickupContext {
  tenant: { id: string; name: string };
  branch: { id: string; name: string; publicSlug: string };
  pickupEnabled: boolean;
  availablePaymentMethods: string[];
}

interface TableContext {
  tenant: { id: string; name: string };
  branch: { id: string; name: string };
  table: { id: string; label: string };
  availableOrderTypes: string[];
  availablePaymentMethods: string[];
}

interface CartLine {
  lineKey: string;
  itemId: string;
  variantId: string;
  name: string;
  variantName: string;
  basePriceMinor: string;
  quantity: number;
  modifierOptionIds: string[];
  modifierNames: string[];
  notes: string;
}

type Entry = { kind: 'pickup'; publicSlug: string } | { kind: 'table'; token: string };

async function loadEntry(entry: Entry): Promise<{ menu: PublicMenu; context: PickupContext | TableContext }> {
  if (entry.kind === 'pickup') {
    const response = await apiRequest<ApiEnvelope<PublicMenu & { context: PickupContext }>>(`/public/restaurants/${encodeURIComponent(entry.publicSlug)}/menu`);
    return { menu: normalizePublicMenu(response.data), context: response.data.context };
  }
  const contextResponse = await apiRequest<ApiEnvelope<TableContext>>('/public/table-context/resolve', { method: 'POST', body: { token: entry.token } });
  const { tenant, branch } = contextResponse.data;
  const menuResponse = await apiRequest<ApiEnvelope<PublicMenu>>(`/public/tenants/${encodeURIComponent(tenant.id)}/branches/${encodeURIComponent(branch.id)}/menu`);
  return { menu: normalizePublicMenu(menuResponse.data), context: contextResponse.data };
}

export function PublicOrderMenu({ entry }: { entry: Entry }) {
  const { tr, formatCurrency } = useLocale();
  const router = useRouter();
  const [categoryId, setCategoryId] = useState<string>('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customizing, setCustomizing] = useState<PublicMenuItem | null>(null);
  const query = useQuery({ queryKey: ['public-entry', entry], queryFn: () => loadEntry(entry), retry: 1 });

  useEffect(() => {
    if (!categoryId && query.data?.menu.categories[0]) setCategoryId(query.data.menu.categories[0].id);
  }, [categoryId, query.data]);

  const category = query.data?.menu.categories.find((item) => item.id === categoryId) ?? query.data?.menu.categories[0];
  const count = cart.reduce((total, line) => total + line.quantity, 0);
  const subtotal = useMemo(() => cart.reduce((total, line) => total + BigInt(line.basePriceMinor) * BigInt(line.quantity), 0n), [cart]);

  function add(item: PublicMenuItem) {
    const variant = item.variants.find((candidate) => candidate.isDefault) ?? item.variants[0];
    if (!variant) return;
    if (item.modifierGroups.length > 0 || item.variants.length > 1) {
      setCustomizing(item);
      return;
    }
    addConfigured(item, variant, [], [], '');
  }

  function addConfigured(item: PublicMenuItem, variant: PublicMenuItem['variants'][number], modifierOptionIds: string[], modifierNames: string[], notes: string) {
    const modifierTotal = item.modifierGroups.flatMap((group) => group.options)
      .filter((option) => modifierOptionIds.includes(option.id))
      .reduce((total, option) => total + BigInt(option.priceDeltaMinor), 0n);
    const unitPriceMinor = (BigInt(variant.basePriceMinor) + modifierTotal).toString();
    const lineKey = [variant.id, [...modifierOptionIds].sort().join(','), notes.trim()].join('|');
    setCart((current) => {
      const existing = current.find((line) => line.lineKey === lineKey);
      if (existing) return current.map((line) => line.lineKey === lineKey ? { ...line, quantity: line.quantity + 1 } : line);
      return [...current, { lineKey, itemId: item.id, variantId: variant.id, name: item.name, variantName: variant.name, basePriceMinor: unitPriceMinor, quantity: 1, modifierOptionIds, modifierNames, notes: notes.trim() }];
    });
    setCustomizing(null);
  }

  function continueOrder() {
    if (!query.data || cart.length === 0) return;
    const payload = { entry, context: query.data.context, lines: cart, quotedSubtotal: subtotal.toString() };
    window.sessionStorage.setItem('rms-public-cart', JSON.stringify(payload));
    router.push((entry.kind === 'pickup' ? `/r/${encodeURIComponent(entry.publicSlug)}/checkout` : `/o/${encodeURIComponent(entry.token)}/checkout`) as Route);
  }

  if (query.isLoading) return <PublicState title={tr('ordering.loadingMenu')} detail={tr('ordering.loadingMenuDetail')} />;
  if (query.isError || !query.data) return <PublicState title={tr('ordering.unavailable')} detail={tr('ordering.linkHelp')} retry={() => void query.refetch()} retryLabel={tr('common.tryAgain')} />;

  const context = query.data.context;
  const isPickup = entry.kind === 'pickup';
  const tableLabel = !isPickup && 'table' in context ? context.table.label : null;
  const disabled = isPickup && 'pickupEnabled' in context && !context.pickupEnabled;

  return (
    <main className="min-h-screen bg-[rgb(var(--surface-customer))] pb-28">
      <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex min-h-[68px] max-w-6xl items-center gap-3 px-4">
          <div><p className="font-black">{query.data.menu.tenant.name}</p><p className="text-xs text-ink-muted">{query.data.menu.branch.name}</p></div>
          <LanguagePicker compact className="ms-auto" />
        </div>
      </header>
      <section className="bg-dark-muted px-4 py-9 text-white">
        <div className="mx-auto max-w-6xl">
          <p className="text-xs font-black uppercase tracking-[.16em] text-accent-gold">{isPickup ? tr('ordering.pickupPreorder') : tr('ordering.table', { table: tableLabel ?? '' })}</p>
          <h1 className="mt-3 text-4xl font-black tracking-[-.045em]">{tr('ordering.chooseMeal')}</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-white/70">{isPickup ? tr('ordering.pickupIntro') : tr('ordering.tableIntro')}</p>
          {entry.kind === 'table' && <TableAssistance qrToken={entry.token} />}
        </div>
      </section>
      {disabled ? <PublicState title={tr('ordering.pickupUnavailable')} detail={tr('ordering.contactRestaurant')} /> : (
        <div className="mx-auto max-w-6xl px-4">
          <nav aria-label={tr('ordering.menuCategories')} className="hide-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 py-4">
            {query.data.menu.categories.map((item) => <button key={item.id} onClick={() => setCategoryId(item.id)} className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-bold ${item.id === category?.id ? 'bg-brand text-white' : 'border border-line bg-white'}`}>{item.name}</button>)}
          </nav>
          {category?.items.length ? <section className="grid gap-4 pb-6 sm:grid-cols-2" aria-labelledby="menu-heading">
            <h2 id="menu-heading" className="col-span-full py-2 text-2xl font-black">{category.name}</h2>
            {category.items.map((item) => {
              const variant = item.variants.find((candidate) => candidate.isDefault) ?? item.variants[0];
              const needsOptions = item.modifierGroups.length > 0 || item.variants.length > 1;
              return <article key={item.id} className="overflow-hidden rounded-2xl border border-line bg-white shadow-card"><MenuItemPhoto image={item.image} name={item.name} className="max-h-64" eager /><div className="flex min-h-44 flex-col p-5"><h3 className="text-lg font-black">{item.name}</h3><p className="mt-2 flex-1 text-sm leading-6 text-ink-muted">{item.description}</p><div className="mt-4 flex items-center justify-between gap-3"><span className="font-black text-brand">{variant ? formatCurrency(variant.basePriceMinor) : tr('ordering.itemUnavailable')}</span><button disabled={!variant} onClick={() => add(item)} className="min-h-11 rounded-xl bg-dark px-4 text-sm font-black text-white disabled:bg-stone-300">{needsOptions ? tr('ordering.chooseOptions') : tr('ordering.add')}</button></div></div></article>;
            })}
          </section> : <PublicState title={tr('ordering.noItems')} detail={tr('ordering.checkLater')} />}
        </div>
      )}
      {count > 0 && <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white p-3"><button onClick={continueOrder} className="mx-auto flex min-h-14 w-full max-w-3xl items-center justify-between rounded-2xl bg-brand px-5 font-black text-white"><span>{tr('ordering.reviewOrderCount', { count })}</span><span dir="ltr">{formatCurrency(subtotal)}</span></button></div>}
      {customizing && <CustomerItemOptions item={customizing} onClose={() => setCustomizing(null)} onConfirm={(variant, ids, names, notes) => addConfigured(customizing, variant, ids, names, notes)} />}
    </main>
  );
}

function TableAssistance({ qrToken }: { qrToken: string }) {
  const { tr } = useLocale();
  const requests = useTableServiceRequests(qrToken, true);
  const create = useCreateServiceRequest();
  const [error, setError] = useState<string | null>(null);
  const active = requests.data ?? [];

  function send(type: ServiceRequestType) {
    setError(null);
    create.mutate(
      { qrToken, type },
      {
        onError: (cause) => {
          const code = cause instanceof ApiError ? (cause.details as { code?: string } | undefined)?.code : undefined;
          setError(code === 'NO_ACTIVE_SESSION' ? tr('ordering.serviceNoSession') : tr('ordering.serviceError'));
        },
      },
    );
  }

  const options: Array<{ type: ServiceRequestType; label: string }> = [
    { type: 'CALL_WAITER', label: tr('ordering.callWaiter') },
    { type: 'REQUEST_BILL', label: tr('ordering.requestBill') },
  ];

  return (
    <div className="mt-6" role="group" aria-label={tr('ordering.assistanceGroup')}>
      <div className="flex flex-wrap gap-3">
        {options.map(({ type, label }) => {
          const state = active.find((request) => request.type === type);
          if (state) {
            const statusText =
              state.status === 'CLAIMED'
                ? tr('ordering.serviceOnTheWay')
                : state.status === 'ESCALATED'
                  ? tr('ordering.serviceEscalated')
                  : tr('ordering.serviceWaiting');
            return (
              <span
                key={type}
                aria-live="polite"
                className="inline-flex min-h-11 items-center rounded-xl border border-accent-gold/40 bg-accent-gold/10 px-4 text-sm font-black text-accent-gold"
              >
                {label} · {statusText}
              </span>
            );
          }
          return (
            <button
              key={type}
              type="button"
              onClick={() => send(type)}
              disabled={create.isPending}
              className="min-h-11 rounded-xl border border-white/30 bg-white/10 px-4 text-sm font-black text-white transition-colors hover:bg-white/20 disabled:opacity-60"
            >
              {label}
            </button>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}

function CustomerItemOptions({ item, onClose, onConfirm }: { item: PublicMenuItem; onClose: () => void; onConfirm: (variant: PublicMenuItem['variants'][number], ids: string[], names: string[], notes: string) => void }) {
  const { formatCurrency, tr } = useLocale();
  const defaultVariant = item.variants.find((candidate) => candidate.isDefault) ?? item.variants[0];
  const [variantId, setVariantId] = useState(defaultVariant?.id ?? '');
  const [selected, setSelected] = useState<Record<string, string[]>>(() => Object.fromEntries(item.modifierGroups.map((group) => [group.id, []])));
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const variant = item.variants.find((candidate) => candidate.id === variantId) ?? defaultVariant;

  function toggle(group: PublicModifierGroup, optionId: string) {
    setSelected((current) => {
      const values = current[group.id] ?? [];
      if (values.includes(optionId)) return { ...current, [group.id]: values.filter((id) => id !== optionId) };
      if (group.maxSelections === 1) return { ...current, [group.id]: [optionId] };
      if (group.maxSelections !== null && values.length >= group.maxSelections) return current;
      return { ...current, [group.id]: [...values, optionId] };
    });
    setError(null);
  }

  function submit() {
    for (const group of item.modifierGroups) {
      const count = selected[group.id]?.length ?? 0;
      if (count < group.minSelections || (group.isRequired && count === 0) || (group.maxSelections !== null && count > group.maxSelections)) {
        setError(tr('ordering.modifierSelectionError', { group: group.name }));
        return;
      }
    }
    if (!variant) return;
    const ids = Object.values(selected).flat();
    const names = item.modifierGroups.flatMap((group) => group.options).filter((option) => ids.includes(option.id)).map((option) => option.name);
    onConfirm(variant, ids, names, notes);
  }

  const selectedIds = Object.values(selected).flat();
  const modifierTotal = item.modifierGroups.flatMap((group) => group.options).filter((option) => selectedIds.includes(option.id)).reduce((sum, option) => sum + BigInt(option.priceDeltaMinor), 0n);
  const total = variant ? BigInt(variant.basePriceMinor) + modifierTotal : 0n;

  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogTitle>{item.name}</DialogTitle><MenuItemPhoto image={item.image} name={item.name} className="mt-3 max-h-72 rounded-2xl" eager />
    {item.description && <p className="mt-1 text-sm text-ink-muted">{item.description}</p>}
    {item.variants.length > 1 && <fieldset className="mt-5"><legend className="font-black">{tr('pos.sizeVariant')}</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{item.variants.map((candidate) => <label key={candidate.id} className="flex min-h-12 items-center gap-3 rounded-xl border border-line p-3"><input type="radio" name="customer-variant" checked={variantId === candidate.id} onChange={() => setVariantId(candidate.id)} /><span className="flex-1 font-bold">{candidate.name}</span><span>{formatCurrency(candidate.basePriceMinor)}</span></label>)}</div></fieldset>}
    {item.modifierGroups.map((group) => <fieldset className="mt-5" key={group.id}><legend className="font-black">{group.name}{(group.isRequired || group.minSelections > 0) && <span className="ms-1 text-red-600">*</span>}</legend><p className="mt-1 text-xs text-ink-muted">{group.maxSelections === null ? tr('ordering.selectionMinimum', { min: group.minSelections }) : tr('ordering.selectionRange', { min: group.minSelections, max: group.maxSelections })}</p><div className="mt-2 space-y-2">{group.options.filter((option) => option.isActive !== false).map((option) => <label key={option.id} className="flex min-h-12 items-center gap-3 rounded-xl border border-line p-3"><input type={group.maxSelections === 1 ? 'radio' : 'checkbox'} name={`modifier-${group.id}`} checked={selected[group.id]?.includes(option.id) ?? false} onChange={() => toggle(group, option.id)} /><span className="flex-1 font-bold">{option.name}</span>{option.priceDeltaMinor !== '0' && <span>{BigInt(option.priceDeltaMinor) > 0 ? '+' : ''}{formatCurrency(option.priceDeltaMinor)}</span>}</label>)}</div></fieldset>)}
    <label className="mt-5 block font-bold">{tr('ordering.specialInstructions')}<textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500} className="mt-2 min-h-24 w-full rounded-xl border border-line p-3" /></label>
    {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800">{error}</p>}
    <div className="mt-6 flex gap-3"><Button variant="secondary" onClick={onClose}>{tr('common.cancel')}</Button><Button className="flex-1" onClick={submit}>{tr('ordering.addConfiguredItem', { price: formatCurrency(total) })}</Button></div>
  </DialogContent></Dialog>;
}

function PublicState({ title, detail, retry, retryLabel = 'Try again' }: { title: string; detail: string; retry?: () => void; retryLabel?: string }) {
  return <section className="mx-auto grid min-h-72 max-w-xl place-items-center px-5 text-center"><div><h1 className="text-2xl font-black">{title}</h1><p className="mt-2 text-sm leading-6 text-ink-muted">{detail}</p>{retry && <button onClick={retry} className="mt-5 min-h-11 rounded-xl bg-dark px-5 font-black text-white">{retryLabel}</button>}</div></section>;
}
