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
  const itemCount = query.data?.menu.categories.reduce((total, item) => total + item.items.length, 0) ?? 0;

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
  const tenantInitial = query.data.menu.tenant.name.trim().slice(0, 1).toUpperCase() || 'R';

  return (
    <main className="min-h-screen bg-[#fff8ef] pb-32 text-[#17120f]">
      <header className="sticky top-0 z-40 border-b border-black/5 bg-[#fffaf2]/90 shadow-[0_10px_30px_rgba(47,35,24,0.06)] backdrop-blur-xl">
        <div className="mx-auto flex min-h-[72px] max-w-6xl items-center gap-3 px-4">
          <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[#241812] text-base font-black text-[#ffdba8] shadow-[0_10px_24px_rgba(80,45,20,0.22)]">
            {tenantInitial}
          </div>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-black leading-5">{query.data.menu.tenant.name}</p>
            <p className="truncate text-xs font-semibold text-[#7d6b5b]">{query.data.menu.branch.name}</p>
          </div>
          <LanguagePicker compact className="ms-auto shrink-0" />
        </div>
      </header>

      <section className="relative isolate overflow-hidden bg-[#241f1f] px-4 py-8 text-white sm:py-12">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_18%_10%,rgba(255,196,112,0.34),transparent_34%),radial-gradient(circle_at_92%_20%,rgba(255,255,255,0.12),transparent_24%),linear-gradient(135deg,#2a2525_0%,#171514_100%)]" />
        <div className="absolute -bottom-24 -right-20 -z-10 size-56 rounded-full bg-[#b65b2e]/25 blur-3xl" />
        <div className="mx-auto max-w-6xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-2 text-[11px] font-black uppercase tracking-[.16em] text-[#ffd28a] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
            <span className="size-2 rounded-full bg-[#7ee787]" />
            {isPickup ? tr('ordering.pickupPreorder') : tr('ordering.table', { table: tableLabel ?? '' })}
          </div>
          <h1 className="mt-5 max-w-2xl text-4xl font-black leading-[0.94] tracking-[-.055em] sm:text-6xl">
            {tr('ordering.chooseMeal')}
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-7 text-white/76">
            {isPickup ? tr('ordering.pickupIntro') : tr('ordering.tableIntro')}
          </p>
          <div className="mt-5 flex flex-wrap gap-2 text-xs font-black text-white/80">
            <span className="rounded-full border border-white/15 bg-white/10 px-3 py-2">{tr('ordering.categoryCount', { count: query.data.menu.categories.length })}</span>
            <span className="rounded-full border border-white/15 bg-white/10 px-3 py-2">{tr('ordering.menuItemCount', { count: itemCount })}</span>
            <span className="rounded-full border border-white/15 bg-white/10 px-3 py-2">{tr('ordering.heroLine1')}</span>
          </div>
          {entry.kind === 'table' && <TableAssistance qrToken={entry.token} />}
        </div>
      </section>

      {disabled ? <PublicState title={tr('ordering.pickupUnavailable')} detail={tr('ordering.contactRestaurant')} /> : (
        <div className="mx-auto max-w-6xl px-4">
          <nav aria-label={tr('ordering.menuCategories')} className="hide-scrollbar sticky top-[72px] z-30 -mx-4 flex gap-2 overflow-x-auto border-b border-black/5 bg-[#fff8ef]/92 px-4 py-3 backdrop-blur-xl">
            {query.data.menu.categories.map((item) => (
              <button
                key={item.id}
                onClick={() => setCategoryId(item.id)}
                className={`min-h-12 shrink-0 rounded-full px-4 text-sm font-black transition-all ${
                  item.id === category?.id
                    ? 'bg-[#0877ed] text-white shadow-[0_10px_24px_rgba(8,119,237,0.24)]'
                    : 'border border-[#eadccd] bg-white/82 text-[#241812] shadow-[0_6px_18px_rgba(47,35,24,0.06)]'
                }`}
              >
                <span>{item.name}</span>
                <span className={`ms-2 rounded-full px-2 py-0.5 text-[11px] ${item.id === category?.id ? 'bg-white/18 text-white' : 'bg-[#f5eee5] text-[#7d6b5b]'}`}>{item.items.length}</span>
              </button>
            ))}
          </nav>

          {category?.items.length ? <section className="grid gap-3 pb-6 pt-4 sm:grid-cols-2 lg:grid-cols-3" aria-labelledby="menu-heading">
            <div className="col-span-full mb-1 flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[.16em] text-[#b4532a]">{tr('ordering.exploreMenu')}</p>
                <h2 id="menu-heading" className="mt-1 text-3xl font-black tracking-[-.04em]">{category.name}</h2>
              </div>
              <p className="hidden rounded-full bg-white px-3 py-2 text-xs font-black text-[#7d6b5b] shadow-[0_8px_24px_rgba(47,35,24,0.06)] sm:block">
                {tr('ordering.categoryItemCount', { count: category.items.length })}
              </p>
            </div>
            {category.items.map((item) => {
              const variant = item.variants.find((candidate) => candidate.isDefault) ?? item.variants[0];
              const needsOptions = item.modifierGroups.length > 0 || item.variants.length > 1;
              return (
                <article key={item.id} className="group overflow-hidden rounded-[1.7rem] border border-[#eadccd] bg-white shadow-[0_18px_48px_rgba(47,35,24,0.10)] transition-transform duration-200 hover:-translate-y-0.5">
                  <div className="relative">
                    <MenuItemPhoto image={item.image} name={item.name} className="h-36 sm:h-44" eager />
                    <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/38 to-transparent" />
                    {variant && (
                      <span className="absolute bottom-3 start-3 rounded-full bg-white/92 px-3 py-1.5 text-sm font-black text-[#0877ed] shadow-[0_8px_18px_rgba(0,0,0,0.15)]" dir="ltr">
                        {formatCurrency(variant.basePriceMinor)}
                      </span>
                    )}
                  </div>
                  <div className="flex min-h-40 flex-col p-5">
                    <h3 className="text-xl font-black tracking-[-.025em]">{item.name}</h3>
                    <p className="mt-2 line-clamp-2 flex-1 text-sm leading-6 text-[#6f6257]">
                      {item.description || tr('ordering.heroLine2')}
                    </p>
                    <div className="mt-5 flex items-center justify-between gap-3">
                      <span className="text-xs font-black uppercase tracking-[.12em] text-[#b4532a]">
                        {needsOptions ? tr('ordering.chooseOptions') : tr('ordering.add')}
                      </span>
                      <button
                        disabled={!variant}
                        onClick={() => add(item)}
                        className="min-h-12 rounded-2xl bg-[#17120f] px-5 text-sm font-black text-white shadow-[0_12px_28px_rgba(23,18,15,0.22)] transition-colors hover:bg-[#2c211b] disabled:bg-stone-300"
                      >
                        {needsOptions ? tr('ordering.chooseOptions') : tr('ordering.add')}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </section> : <PublicState title={tr('ordering.noItems')} detail={tr('ordering.checkLater')} />}
        </div>
      )}
      {count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-black/5 bg-[#fffaf2]/90 p-3 shadow-[0_-18px_48px_rgba(47,35,24,0.16)] backdrop-blur-xl">
          <button onClick={continueOrder} className="mx-auto flex min-h-16 w-full max-w-3xl items-center justify-between rounded-[1.35rem] bg-[#0877ed] px-5 font-black text-white shadow-[0_16px_36px_rgba(8,119,237,0.32)]">
            <span>{tr('ordering.reviewOrderCount', { count })}</span>
            <span className="rounded-full bg-white/18 px-3 py-1.5" dir="ltr">{formatCurrency(subtotal)}</span>
          </button>
        </div>
      )}
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
