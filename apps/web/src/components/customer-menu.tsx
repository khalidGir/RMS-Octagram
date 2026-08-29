'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest, formatEtbMinor, type ApiEnvelope } from '@/lib/api-client';

interface ApiVariant { id: string; name: string; priceMinor: string; isDefault: boolean }
interface ApiModifierOption { id: string; name: string; priceDeltaMinor: string }
interface ApiModifierGroup { id: string; name: string; isRequired: boolean; minSelections: number; maxSelections: number | null; options: ApiModifierOption[] }
interface ApiMenuItem { id: string; name: string; description: string | null; variants: ApiVariant[]; modifierGroups: ApiModifierGroup[] }
interface ApiCategory { id: string; name: string; items: ApiMenuItem[] }
interface ApiMenu { tenant: { id: string; name: string }; branch: { id: string; name: string }; categories: ApiCategory[] }

interface CartLine {
  itemId: string;
  variantId: string;
  name: string;
  priceMinor: string;
  quantity: number;
  modifierOptionIds?: string[];
  notes?: string;
}

const tones = ['#B4532A','#D39A3E','#31584A','#8E4A38','#B77B3B','#49362D','#D16C3B','#A67C45'];

function initialsFor(name: string): string {
  return name.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function toneFor(index: number): string {
  return tones[index % tones.length];
}

export function CustomerMenu() {
  const params = useParams<{ branchSlug: string }>();
  const branchSlug = params.branchSlug;
  const [categoryId, setCategoryId] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);

  const query = useQuery({
    queryKey: ['public-menu', branchSlug],
    queryFn: () => apiRequest<ApiEnvelope<ApiMenu>>(`/public/restaurants/${encodeURIComponent(branchSlug!)}/menu`),
    enabled: !!branchSlug,
    retry: 1,
  });

  const menu = query.data?.data;

  useEffect(() => {
    if (!categoryId && menu?.categories[0]) setCategoryId(menu.categories[0].id);
  }, [categoryId, menu]);

  const category = menu?.categories.find(c => c.id === categoryId) ?? menu?.categories[0];

  const count = cart.reduce((sum, x) => sum + x.quantity, 0);
  const subtotal = useMemo(
    () => cart.reduce((sum, x) => sum + BigInt(x.priceMinor) * BigInt(x.quantity), 0n),
    [cart],
  );

  function add(item: ApiMenuItem) {
    const variant = item.variants.find(v => v.isDefault) ?? item.variants[0];
    if (!variant) return;
    if (item.modifierGroups.some(g => g.isRequired || g.minSelections > 0)) return;
    setCart(v => {
      const existing = v.find(line => line.variantId === variant.id);
      if (existing) return v.map(line => line.variantId === variant.id ? { ...line, quantity: line.quantity + 1 } : line);
      return [...v, { itemId: item.id, variantId: variant.id, name: item.name, priceMinor: variant.priceMinor, quantity: 1 }];
    });
  }

  function change(variantId: string, delta: number) {
    setCart(v => v.map(line => line.variantId === variantId ? { ...line, quantity: line.quantity + delta } : line).filter(line => line.quantity > 0));
  }

  function continueOrder() {
    if (!menu || cart.length === 0) return;
    const payload = {
      entry: { kind: 'pickup' as const, publicSlug: branchSlug },
      context: {
        branch: menu.branch,
        pickupEnabled: true,
        availablePaymentMethods: ['BANK_TRANSFER', 'TELEBIRR'],
      },
      lines: cart,
      quotedSubtotal: subtotal.toString(),
    };
    window.sessionStorage.setItem('rms-public-cart', JSON.stringify(payload));
    window.location.assign(`/r/${encodeURIComponent(branchSlug!)}/checkout`);
  }

  if (query.isLoading) return <StateScreen title="Loading menu…" detail="Checking current prices and availability." />;
  if (query.isError || !menu) return <StateScreen title="Menu unavailable" detail="Please ask restaurant staff for a current ordering link." retry={() => void query.refetch()} />;

  return (
    <main className="min-h-screen bg-[#fffaf3] pb-24 lg:pb-8">
      <header className="sticky top-0 z-30 border-b border-line bg-[#fffaf3]/90 backdrop-blur-xl">
        <div className="mx-auto flex min-h-[72px] max-w-7xl items-center justify-between px-4 sm:px-7">
          <Link href={`/r/${encodeURIComponent(branchSlug)}`} className="flex items-center gap-3" aria-label={menu.tenant.name}>
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand text-sm font-black text-white shadow-lg shadow-brand/20">{menu.tenant.name[0]}</span>
            <span className="leading-none"><span className="block text-[15px] font-extrabold tracking-[-0.02em]">{menu.tenant.name}</span><span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-muted">{menu.branch.name}</span></span>
          </Link>
          <button onClick={() => setCartOpen(true)} aria-label={`Open cart with ${count} items`} className="relative grid size-11 place-items-center rounded-xl bg-[#18241f] text-white">
            ▢{count > 0 && <span className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-brand text-[9px] font-black">{count}</span>}
          </button>
        </div>
      </header>

      <section className="bg-[#14201b] px-4 py-10 text-white">
        <div className="mx-auto max-w-7xl">
          <p className="text-xs font-black uppercase tracking-[.18em] text-[#e3b262]">{menu.branch.name} · Pickup</p>
          <h1 className="mt-3 max-w-2xl text-4xl font-black tracking-[-.05em] sm:text-5xl">Made with warmth.<br/>Served with pride.</h1>
          <p className="mt-4 text-sm text-white/60">Order ahead for pickup · Payment by bank transfer or Telebirr</p>
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-4 sm:px-7">
        <div className="hide-scrollbar sticky top-[72px] z-20 -mx-4 flex gap-2 overflow-auto border-b border-line bg-[#fffaf3]/95 px-4 py-4 sm:-mx-7 sm:px-7">
          {menu.categories.map(c => <button key={c.id} onClick={() => setCategoryId(c.id)} className={`shrink-0 rounded-full px-4 py-2 text-xs font-black ${c.id === category?.id ? 'bg-brand text-white' : 'border border-line bg-white text-ink-muted'}`}>{c.name}</button>)}
        </div>
        <div className="grid gap-6 py-7 lg:grid-cols-[1fr_360px]">
          <section>
            <p className="text-xs font-black uppercase tracking-[.16em] text-brand">Explore the menu</p>
            <h2 className="mt-2 text-2xl font-black">{category?.name}</h2>
            {query.isLoading ? <div className="mt-5 grid gap-4 sm:grid-cols-2">{Array.from({ length: 6 }, (_, i) => <div className="h-40 animate-pulse rounded-xl bg-white" key={i} />)}</div>
              : <div className="mt-5 grid gap-4 sm:grid-cols-2">{category?.items.map((item, idx) => {
                const variant = item.variants.find(v => v.isDefault) ?? item.variants[0];
                const needsOptions = item.modifierGroups.some(g => g.isRequired || g.minSelections > 0);
                return <article className={`flex min-h-40 overflow-hidden rounded-2xl border border-line bg-white shadow-card ${variant ? '' : 'opacity-50'}`} key={item.id}>
                  <div className="relative grid w-2/5 place-items-center text-xl font-black text-white" style={{ background: `linear-gradient(145deg,${toneFor(idx)},#18201d)` }}>
                    {initialsFor(item.name)}
                  </div>
                  <div className="flex flex-1 flex-col p-4">
                    <h3 className="font-black">{item.name}</h3>
                    <p className="mt-1 text-xs leading-5 text-ink-muted">{item.description}</p>
                    <div className="mt-auto flex items-center justify-between">
                      <b className="text-brand">{variant ? formatEtbMinor(variant.priceMinor) : 'Unavailable'}</b>
                      <button disabled={!variant || needsOptions} onClick={() => add(item)} aria-label={`Add ${item.name}`} className="grid size-10 place-items-center rounded-xl bg-muted text-xl font-black text-brand disabled:bg-stone-200 disabled:text-stone-400">{variant && !needsOptions ? '+' : '...'}</button>
                    </div>
                  </div>
                </article>;
              })}</div>}
          </section>
          <div className="hidden lg:block"><CartSidebar cart={cart} subtotal={subtotal} change={change} onContinue={continueOrder} /></div>
        </div>
      </div>

      {count > 0 && <button onClick={() => setCartOpen(true)} className="fixed inset-x-4 bottom-4 z-30 flex min-h-14 items-center justify-between rounded-2xl bg-brand px-5 font-black text-white shadow-float lg:hidden">
        <span>View order · {count} items</span><span dir="ltr">{formatEtbMinor(subtotal)}</span>
      </button>}

      {cartOpen && <div className="fixed inset-0 z-50 flex items-end bg-black/45 lg:hidden" onClick={e => { if (e.currentTarget === e.target) setCartOpen(false); }}>
        <div className="max-h-[88vh] w-full overflow-auto rounded-t-3xl bg-[#fffaf3] p-4">
          <div className="mb-3 flex justify-between"><h2 className="text-xl font-black">Your order</h2><button onClick={() => setCartOpen(false)} aria-label="Close cart">×</button></div>
          <CartSidebar cart={cart} subtotal={subtotal} change={change} onContinue={continueOrder} />
        </div>
      </div>}
    </main>
  );
}

function CartSidebar({ cart, subtotal, change, onContinue }: { cart: CartLine[]; subtotal: bigint; change: (id: string, d: number) => void; onContinue: () => void }) {
  return <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-card">
    <div className="border-b border-line p-5"><h2 className="text-xl font-black">Your order</h2></div>
    <div className="p-5">{cart.length === 0 ? <p className="py-10 text-center text-sm font-bold text-ink-muted">Add something delicious.</p>
      : <div className="space-y-4">{cart.map(line => <div key={line.variantId}>
        <div className="flex justify-between text-sm"><b>{line.name}</b><b dir="ltr">{formatEtbMinor(BigInt(line.priceMinor) * BigInt(line.quantity))}</b></div>
        <div className="mt-2 flex justify-end"><div className="flex items-center rounded-lg border border-line">
          <button onClick={() => change(line.variantId, -1)} className="grid size-8 place-items-center">−</button>
          <span className="w-7 text-center text-xs font-black">{line.quantity}</span>
          <button onClick={() => change(line.variantId, 1)} className="grid size-8 place-items-center">+</button>
        </div></div>
      </div>)}</div>}
    </div>
    {cart.length > 0 && <div className="border-t border-line bg-muted/50 p-5">
      <div className="flex justify-between"><span>Subtotal</span><b dir="ltr">{formatEtbMinor(subtotal)}</b></div>
      <button onClick={onContinue} className="mt-4 grid min-h-12 w-full place-items-center rounded-xl bg-brand text-sm font-black text-white">Review order</button>
    </div>}
  </div>;
}

function StateScreen({ title, detail, retry }: { title: string; detail: string; retry?: () => void }) {
  return <main className="grid min-h-screen place-items-center bg-[#fffaf3] p-6 text-center"><div><h1 className="text-2xl font-black">{title}</h1><p className="mt-2 max-w-md text-sm text-ink-muted">{detail}</p>{retry && <button onClick={retry} className="mt-5 min-h-11 rounded-xl bg-[#18241f] px-5 font-black text-white">Try again</button>}</div></main>;
}
