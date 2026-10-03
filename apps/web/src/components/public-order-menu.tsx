'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { apiRequest, type ApiEnvelope } from '@/lib/api-client';
import { normalizePublicMenu } from '@/lib/public-menu';
import { useLocale } from './locale-provider';
import { LanguagePicker } from './language-picker';

interface PublicMenuItem {
  id: string;
  name: string;
  description: string | null;
  variants: Array<{ id: string; name: string; basePriceMinor: string; isDefault: boolean }>;
  modifierGroups: Array<{ id: string; name: string; isRequired: boolean; minSelections: number }>;
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
  itemId: string;
  variantId: string;
  name: string;
  basePriceMinor: string;
  quantity: number;
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
  const query = useQuery({ queryKey: ['public-entry', entry], queryFn: () => loadEntry(entry), retry: 1 });

  useEffect(() => {
    if (!categoryId && query.data?.menu.categories[0]) setCategoryId(query.data.menu.categories[0].id);
  }, [categoryId, query.data]);

  const category = query.data?.menu.categories.find((item) => item.id === categoryId) ?? query.data?.menu.categories[0];
  const count = cart.reduce((total, line) => total + line.quantity, 0);
  const subtotal = useMemo(() => cart.reduce((total, line) => total + BigInt(line.basePriceMinor) * BigInt(line.quantity), 0n), [cart]);

  function add(item: PublicMenuItem) {
    const variant = item.variants.find((candidate) => candidate.isDefault) ?? item.variants[0];
    if (!variant || item.modifierGroups.some((group) => group.isRequired || group.minSelections > 0)) return;
    setCart((current) => {
      const existing = current.find((line) => line.variantId === variant.id);
      if (existing) return current.map((line) => line.variantId === variant.id ? { ...line, quantity: line.quantity + 1 } : line);
      return [...current, { itemId: item.id, variantId: variant.id, name: item.name, basePriceMinor: variant.basePriceMinor, quantity: 1 }];
    });
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
              const needsOptions = item.modifierGroups.some((group) => group.isRequired || group.minSelections > 0);
              return <article key={item.id} className="flex min-h-44 flex-col rounded-2xl border border-line bg-white p-5 shadow-card"><h3 className="text-lg font-black">{item.name}</h3><p className="mt-2 flex-1 text-sm leading-6 text-ink-muted">{item.description}</p><div className="mt-4 flex items-center justify-between gap-3"><span className="font-black text-brand">{variant ? formatCurrency(variant.basePriceMinor) : tr('ordering.itemUnavailable')}</span><button disabled={!variant || needsOptions} onClick={() => add(item)} className="min-h-11 rounded-xl bg-dark px-4 text-sm font-black text-white disabled:bg-stone-300">{needsOptions ? tr('ordering.chooseOptions') : tr('ordering.add')}</button></div></article>;
            })}
          </section> : <PublicState title={tr('ordering.noItems')} detail={tr('ordering.checkLater')} />}
        </div>
      )}
      {count > 0 && <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white p-3"><button onClick={continueOrder} className="mx-auto flex min-h-14 w-full max-w-3xl items-center justify-between rounded-2xl bg-brand px-5 font-black text-white"><span>{tr('ordering.reviewOrderCount', { count })}</span><span dir="ltr">{formatCurrency(subtotal)}</span></button></div>}
    </main>
  );
}

function PublicState({ title, detail, retry, retryLabel = 'Try again' }: { title: string; detail: string; retry?: () => void; retryLabel?: string }) {
  return <section className="mx-auto grid min-h-72 max-w-xl place-items-center px-5 text-center"><div><h1 className="text-2xl font-black">{title}</h1><p className="mt-2 text-sm leading-6 text-ink-muted">{detail}</p>{retry && <button onClick={retry} className="mt-5 min-h-11 rounded-xl bg-dark px-5 font-black text-white">{retryLabel}</button>}</div></section>;
}
