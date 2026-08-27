'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest, formatEtbMinor, type ApiEnvelope } from '@/lib/api-client';
import { useLocale } from './locale-provider';

interface PublicMenuItem {
  id: string;
  name: string;
  description: string | null;
  variants: Array<{ id: string; name: string; priceMinor: string; isDefault: boolean }>;
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
  priceMinor: string;
  quantity: number;
}

type Entry = { kind: 'pickup'; publicSlug: string } | { kind: 'table'; token: string };

async function loadEntry(entry: Entry): Promise<{ menu: PublicMenu; context: PickupContext | TableContext }> {
  if (entry.kind === 'pickup') {
    const response = await apiRequest<ApiEnvelope<PublicMenu & { context: PickupContext }>>(`/public/restaurants/${encodeURIComponent(entry.publicSlug)}/menu`);
    return { menu: response.data, context: response.data.context };
  }
  const contextResponse = await apiRequest<ApiEnvelope<TableContext>>('/public/table-context/resolve', { method: 'POST', body: { token: entry.token } });
  const { tenant, branch } = contextResponse.data;
  const menuResponse = await apiRequest<ApiEnvelope<PublicMenu>>(`/public/tenants/${encodeURIComponent(tenant.id)}/branches/${encodeURIComponent(branch.id)}/menu`);
  return { menu: menuResponse.data, context: contextResponse.data };
}

export function PublicOrderMenu({ entry }: { entry: Entry }) {
  const { locale, setLocale, t } = useLocale();
  const [categoryId, setCategoryId] = useState<string>('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const query = useQuery({ queryKey: ['public-entry', entry], queryFn: () => loadEntry(entry), retry: 1 });

  useEffect(() => {
    if (!categoryId && query.data?.menu.categories[0]) setCategoryId(query.data.menu.categories[0].id);
  }, [categoryId, query.data]);

  const category = query.data?.menu.categories.find((item) => item.id === categoryId) ?? query.data?.menu.categories[0];
  const count = cart.reduce((total, line) => total + line.quantity, 0);
  const subtotal = useMemo(() => cart.reduce((total, line) => total + BigInt(line.priceMinor) * BigInt(line.quantity), 0n), [cart]);

  function add(item: PublicMenuItem) {
    const variant = item.variants.find((candidate) => candidate.isDefault) ?? item.variants[0];
    if (!variant || item.modifierGroups.some((group) => group.isRequired || group.minSelections > 0)) return;
    setCart((current) => {
      const existing = current.find((line) => line.variantId === variant.id);
      if (existing) return current.map((line) => line.variantId === variant.id ? { ...line, quantity: line.quantity + 1 } : line);
      return [...current, { itemId: item.id, variantId: variant.id, name: item.name, priceMinor: variant.priceMinor, quantity: 1 }];
    });
  }

  function continueOrder() {
    if (!query.data || cart.length === 0) return;
    const payload = { entry, context: query.data.context, lines: cart, quotedSubtotal: subtotal.toString() };
    window.sessionStorage.setItem('rms-public-cart', JSON.stringify(payload));
    window.location.assign(entry.kind === 'pickup' ? `/r/${encodeURIComponent(entry.publicSlug)}/checkout` : `/o/${encodeURIComponent(entry.token)}/checkout`);
  }

  if (query.isLoading) return <PublicState title="Loading menu…" detail="Checking current prices and availability." />;
  if (query.isError || !query.data) return <PublicState title={t.unavailable} detail="Please ask restaurant staff for a current ordering link." retry={() => void query.refetch()} />;

  const context = query.data.context;
  const isPickup = entry.kind === 'pickup';
  const tableLabel = !isPickup && 'table' in context ? context.table.label : null;
  const disabled = isPickup && 'pickupEnabled' in context && !context.pickupEnabled;

  return (
    <main className="min-h-screen bg-[rgb(var(--surface-customer))] pb-28">
      <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex min-h-[68px] max-w-6xl items-center gap-3 px-4">
          <div><p className="font-black">{query.data.menu.tenant.name}</p><p className="text-xs text-ink-muted">{query.data.menu.branch.name}</p></div>
          <label className="ms-auto flex items-center gap-2 text-xs font-bold">
            <span className="sr-only">{t.language}</span>
            <select value={locale} onChange={(event) => setLocale(event.target.value as 'en' | 'am' | 'ar')} className="min-h-11 rounded-xl border border-line bg-white px-3" aria-label={t.language}>
              <option value="en">English</option><option value="am">አማርኛ</option><option value="ar">العربية</option>
            </select>
          </label>
        </div>
      </header>
      <section className="bg-[#14201b] px-4 py-9 text-white">
        <div className="mx-auto max-w-6xl">
          <p className="text-xs font-black uppercase tracking-[.16em] text-[#e3b262]">{isPickup ? 'Pickup pre-order' : `Table ${tableLabel}`}</p>
          <h1 className="mt-3 text-4xl font-black tracking-[-.045em]">Choose your meal</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-white/70">{isPickup ? 'Order ahead for pickup. Payment is available by bank transfer or Telebirr.' : 'Order for this table or choose takeaway using the options configured by the restaurant.'}</p>
        </div>
      </section>
      {disabled ? <PublicState title="Pickup ordering is unavailable." detail="Please contact the restaurant directly." /> : (
        <div className="mx-auto max-w-6xl px-4">
          <nav aria-label="Menu categories" className="hide-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 py-4">
            {query.data.menu.categories.map((item) => <button key={item.id} onClick={() => setCategoryId(item.id)} className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-bold ${item.id === category?.id ? 'bg-brand text-white' : 'border border-line bg-white'}`}>{item.name}</button>)}
          </nav>
          {category?.items.length ? <section className="grid gap-4 pb-6 sm:grid-cols-2" aria-labelledby="menu-heading">
            <h2 id="menu-heading" className="col-span-full py-2 text-2xl font-black">{category.name}</h2>
            {category.items.map((item) => {
              const variant = item.variants.find((candidate) => candidate.isDefault) ?? item.variants[0];
              const needsOptions = item.modifierGroups.some((group) => group.isRequired || group.minSelections > 0);
              return <article key={item.id} className="flex min-h-44 flex-col rounded-2xl border border-line bg-white p-5 shadow-card"><h3 className="text-lg font-black">{item.name}</h3><p className="mt-2 flex-1 text-sm leading-6 text-ink-muted">{item.description}</p><div className="mt-4 flex items-center justify-between gap-3"><span className="font-black text-brand">{variant ? formatEtbMinor(variant.priceMinor) : 'Unavailable'}</span><button disabled={!variant || needsOptions} onClick={() => add(item)} className="min-h-11 rounded-xl bg-[#18241f] px-4 text-sm font-black text-white disabled:bg-stone-300">{needsOptions ? 'Choose options' : 'Add'}</button></div></article>;
            })}
          </section> : <PublicState title="No items available" detail="Please check again later." />}
        </div>
      )}
      {count > 0 && <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white p-3"><button onClick={continueOrder} className="mx-auto flex min-h-14 w-full max-w-3xl items-center justify-between rounded-2xl bg-brand px-5 font-black text-white"><span>Review order · {count} {count === 1 ? 'item' : 'items'}</span><span dir="ltr">{formatEtbMinor(subtotal)}</span></button></div>}
    </main>
  );
}

function PublicState({ title, detail, retry }: { title: string; detail: string; retry?: () => void }) {
  return <section className="mx-auto grid min-h-72 max-w-xl place-items-center px-5 text-center"><div><h1 className="text-2xl font-black">{title}</h1><p className="mt-2 text-sm leading-6 text-ink-muted">{detail}</p>{retry && <button onClick={retry} className="mt-5 min-h-11 rounded-xl bg-[#18241f] px-5 font-black text-white">Try again</button>}</div></section>;
}
