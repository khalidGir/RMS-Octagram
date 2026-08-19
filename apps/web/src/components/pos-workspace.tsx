'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatEtb, mockMenuApi } from '@/lib/mock-api';
import type { CartLine, MenuItem } from '@/lib/types';

export function PosWorkspace() {
  const { data, isLoading } = useQuery({ queryKey: ['menu'], queryFn: () => mockMenuApi.getMenu() });
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [orderType, setOrderType] = useState<'POS' | 'DINE_IN' | 'PICKUP'>('POS');

  const items = useMemo(() => data?.items.filter((item) => {
    const categoryMatch = category === 'all' || (category === 'popular' ? Boolean(item.badge) : item.categoryId === category);
    return categoryMatch && item.name.toLowerCase().includes(search.toLowerCase());
  }) ?? [], [category, data, search]);

  const subtotal = cart.reduce((sum, line) => sum + line.item.priceMinor * line.quantity, 0);
  const service = Math.round(subtotal * 0.05);
  const total = subtotal + service;
  const count = cart.reduce((sum, line) => sum + line.quantity, 0);

  const add = (item: MenuItem) => {
    if (!item.available) return;
    setCart((current) => {
      const existing = current.find((line) => line.item.id === item.id);
      return existing ? current.map((line) => line.item.id === item.id ? { ...line, quantity: line.quantity + 1 } : line) : [...current, { item, quantity: 1 }];
    });
  };

  const changeQuantity = (itemId: string, delta: number) => setCart((current) => current.map((line) => line.item.id === itemId ? { ...line, quantity: line.quantity + delta } : line).filter((line) => line.quantity > 0));

  return (
    <div className="mx-auto max-w-[1600px]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-xs font-black uppercase tracking-[0.2em] text-brand">Bole Main · Day shift</p><h1 className="mt-2 text-3xl font-black tracking-[-0.045em]">Point of sale</h1><p className="mt-1 text-sm text-ink-muted">Create a fast counter, table, or pickup order.</p></div>
        <button onClick={() => setCartOpen(true)} className="relative min-h-11 rounded-control bg-[#18241f] px-5 text-sm font-black text-white xl:hidden">Current order · {count}<span className="ml-3 text-white/60">{formatEtb(total)}</span></button>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[1fr_390px]">
        <section className="min-w-0">
          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="relative flex min-h-12 flex-1 items-center rounded-control border border-line bg-white shadow-card"><span className="pl-4 text-ink-muted">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search menu items" className="h-full w-full bg-transparent px-3 text-sm font-semibold outline-none" /></label>
            <button className="min-h-12 rounded-control border border-line bg-white px-5 text-sm font-extrabold shadow-card">Scan item</button>
          </div>
          <div className="hide-scrollbar mt-4 flex gap-2 overflow-x-auto pb-1">{data?.categories.map((item) => <button key={item.id} onClick={() => setCategory(item.id)} className={`min-h-10 shrink-0 rounded-full px-4 text-xs font-extrabold transition ${category === item.id ? 'bg-[#18241f] text-white' : 'border border-line bg-white text-ink-muted hover:text-ink'}`}>{item.name}</button>)}</div>

          {isLoading ? <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-56 animate-pulse rounded-card bg-white" />)}</div> : (
            <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-4">
              {items.map((item) => <button key={item.id} disabled={!item.available} onClick={() => add(item)} className="group overflow-hidden rounded-card border border-line bg-white text-left shadow-card transition hover:-translate-y-0.5 hover:shadow-float disabled:cursor-not-allowed disabled:opacity-55">
                <span className="relative grid h-28 place-items-center text-2xl font-black text-white sm:h-32" style={{ background: `linear-gradient(145deg, ${item.tone}, #171d1a)` }}>{item.initials}{item.badge && <span className="absolute left-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-[9px] font-black text-ink">{item.badge}</span>}{!item.available && <span className="absolute inset-0 grid place-items-center bg-black/45 text-xs font-black uppercase tracking-wider">Sold out</span>}</span>
                <span className="block p-4"><span className="block truncate text-sm font-black">{item.name}</span><span className="mt-1 line-clamp-2 min-h-8 text-[11px] leading-4 text-ink-muted">{item.description}</span><span className="mt-3 flex items-center justify-between"><span className="text-sm font-black text-brand">{formatEtb(item.priceMinor)}</span><span className="grid size-8 place-items-center rounded-lg bg-muted text-lg font-bold text-brand group-hover:bg-brand group-hover:text-white">+</span></span></span>
              </button>)}
            </div>
          )}
        </section>

        <aside className={`${cartOpen ? 'fixed inset-0 z-50 flex bg-black/40 p-3' : 'hidden'} xl:sticky xl:top-[92px] xl:block xl:h-[calc(100vh-118px)]`} onClick={(event) => { if (event.currentTarget === event.target) setCartOpen(false); }}>
          <div className="ml-auto flex h-full w-full max-w-[420px] flex-col overflow-hidden rounded-panel border border-line bg-white shadow-float xl:max-w-none">
            <div className="border-b border-line p-5"><div className="flex items-center justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-brand">New order</p><h2 className="mt-1 text-xl font-black">Current ticket</h2></div><button onClick={() => setCartOpen(false)} className="grid size-10 place-items-center rounded-xl border border-line xl:hidden" aria-label="Close cart">×</button></div>
              <div className="mt-4 grid grid-cols-3 rounded-xl bg-muted p-1">{(['POS', 'DINE_IN', 'PICKUP'] as const).map((type) => <button key={type} onClick={() => setOrderType(type)} className={`min-h-9 rounded-lg text-[10px] font-black ${orderType === type ? 'bg-white text-ink shadow-sm' : 'text-ink-muted'}`}>{type === 'DINE_IN' ? 'Dine-in' : type === 'PICKUP' ? 'Pickup' : 'Counter'}</button>)}</div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {cart.length === 0 ? <div className="grid h-full min-h-60 place-items-center text-center"><div><span className="mx-auto grid size-16 place-items-center rounded-2xl bg-muted text-2xl">▦</span><p className="mt-4 font-black">The ticket is empty</p><p className="mt-2 text-xs leading-5 text-ink-muted">Tap a menu item to add it to this order.</p></div></div> : <div className="space-y-4">{cart.map((line) => <div key={line.item.id} className="flex gap-3"><span className="grid size-12 shrink-0 place-items-center rounded-xl text-xs font-black text-white" style={{ backgroundColor: line.item.tone }}>{line.item.initials}</span><div className="min-w-0 flex-1"><div className="flex justify-between gap-2"><p className="truncate text-sm font-black">{line.item.name}</p><p className="text-sm font-black">{formatEtb(line.item.priceMinor * line.quantity)}</p></div><div className="mt-2 flex items-center justify-between"><div className="flex items-center rounded-lg border border-line"><button onClick={() => changeQuantity(line.item.id, -1)} className="grid size-8 place-items-center" aria-label={`Remove one ${line.item.name}`}>−</button><span className="min-w-7 text-center text-xs font-black">{line.quantity}</span><button onClick={() => changeQuantity(line.item.id, 1)} className="grid size-8 place-items-center" aria-label={`Add one ${line.item.name}`}>+</button></div><button className="text-[10px] font-bold text-ink-muted">Add note</button></div></div></div>)}</div>}
            </div>
            <div className="border-t border-line bg-[#fcfaf6] p-5"><div className="space-y-2 text-sm"><div className="flex justify-between text-ink-muted"><span>Subtotal</span><span>{formatEtb(subtotal)}</span></div><div className="flex justify-between text-ink-muted"><span>Service charge</span><span>{formatEtb(service)}</span></div><div className="mt-3 flex justify-between border-t border-line pt-3 text-lg font-black"><span>Total</span><span>{formatEtb(total)}</span></div></div><button disabled={!cart.length} className="mt-5 min-h-12 w-full rounded-control bg-brand text-sm font-black text-white shadow-lg shadow-brand/20 disabled:bg-black/15 disabled:shadow-none">Choose payment</button><button className="mt-2 min-h-10 w-full text-xs font-bold text-ink-muted" onClick={() => setCart([])}>Clear ticket</button></div>
          </div>
        </aside>
      </div>
    </div>
  );
}
