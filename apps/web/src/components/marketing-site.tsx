'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

const features = [
  ['01', 'One order flow', 'Counter, table QR, pickup, and waiter orders arrive in one reliable queue.'],
  ['02', 'Kitchen at a glance', 'Live tickets, preparation notes, elapsed-time alerts, bump, and recall.'],
  ['03', 'Payments with context', 'Cash, card, and manual transfer proof review connected to the right order.'],
  ['04', 'Inventory that speaks food', 'Turn bulk stock into portions, map recipes, and see depletion before service suffers.'],
  ['05', 'Every branch, one picture', 'Compare revenue, service time, menu performance, staff, and stock across locations.'],
  ['06', 'Access that fits the team', 'Focused workspaces for owners, managers, cashiers, kitchen staff, waiters, and guests.'],
] as const;

const questions = [
  ['Does RestaurantMS support Ethiopian payment workflows?',
    'Yes. The product is designed around ETB, cash, card, and cashier-verified mobile transfer proofs. Automated gateways can be enabled when a restaurant chooses a supported provider.'],
  ['Can each branch work differently?',
    'Yes. Owners can manage multiple branches while controlling modules, menus, tables, staff assignments, and inventory at the appropriate scope.'],
  ['Does it work on tablets and phones?',
    'RestaurantMS is a responsive web app and installable PWA designed for cashier tablets, kitchen displays, manager phones, and customer QR ordering.'],
  ['Who owns restaurant and customer data?',
    'The restaurant remains responsible for its operational and customer data. RestaurantMS processes that data to provide the service, subject to the applicable agreement and privacy notice.'],
] as const;

const roles = [
  ['Owner', 'All branches, performance, controls'],
  ['Manager', 'Daily operations and assigned teams'],
  ['Cashier', 'Fast orders, payments, and shifts'],
  ['Kitchen', 'Clear tickets and live timing'],
  ['Waiter', 'Tables, service, and handoff'],
  ['Guest', 'QR menu, payment, and tracking'],
] as const;

export function MarketingLanding() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState(-1);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuNavRef = useRef<HTMLElement>(null);

  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape' && menuOpen) {
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    }
  }, [menuOpen]);

  useEffect(() => {
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [handleEscape]);

  return (
    <div className="min-h-screen overflow-hidden bg-canvas text-ink">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:m-4 focus:rounded-xl focus:bg-ink focus:px-5 focus:py-3 focus:text-sm focus:text-white">
        Skip to content
      </a>

      <MarketingHeader
        open={menuOpen}
        setOpen={setMenuOpen}
        menuButtonRef={menuButtonRef}
        menuNavRef={menuNavRef}
      />

      <main id="main-content">
        {/* Hero */}
        <section className="relative border-b border-black/[.06] px-5 pb-20 pt-14 sm:px-8 sm:pb-28 sm:pt-20 lg:px-12">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_78%_18%,rgba(180,83,42,.18),transparent_28rem),radial-gradient(circle_at_15%_85%,rgba(49,88,74,.12),transparent_24rem)]" />
          <div className="relative mx-auto grid max-w-[1380px] items-center gap-14 lg:grid-cols-[1.02fr_.98fr]">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/70 px-3 py-2 text-[10px] font-black uppercase tracking-[.16em]">
                <span className="size-2 rounded-full bg-emerald-500" />
                Built for hospitality in Ethiopia
              </div>
              <h1 className="mt-7 max-w-3xl text-[clamp(3.5rem,7vw,7.8rem)] font-black leading-[.86] tracking-[-.075em]">
                Service,<br />
                <span className="text-brand">without chaos.</span>
              </h1>
              <p className="mt-7 max-w-xl text-lg leading-8 text-text-secondary">
                One calm operating system for orders, payments, kitchen flow, inventory, people, and every branch you open next.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/login"
                  className="grid min-h-14 place-items-center rounded-xl bg-ink px-7 text-sm font-black text-white shadow-2xl shadow-black/15"
                >
                  Open staff workspace →
                </Link>
                <a
                  href="#product"
                  className="grid min-h-14 place-items-center rounded-xl border border-black/15 bg-white/60 px-7 text-sm font-black"
                >
                  Explore the product
                </a>
              </div>
              <div className="mt-10 flex flex-wrap gap-x-8 gap-y-3 text-xs font-bold text-text-secondary-light">
                <span>✓ ETB-first</span>
                <span>✓ Multi-branch</span>
                <span>✓ Tablet-ready PWA</span>
                <span>✓ Role-based access</span>
              </div>
            </div>
            <ProductPreview />
          </div>
        </section>

        {/* Capabilities strip */}
        <section className="border-b border-black/[.06] bg-ink px-5 py-7 text-white sm:px-8" aria-label="Capabilities">
          <div className="mx-auto flex max-w-[1380px] flex-wrap items-center justify-between gap-5">
            <p className="text-xs font-black uppercase tracking-[.18em] text-white/55">
              One system from first order to final report
            </p>
            <div className="flex flex-wrap gap-6 text-sm font-black text-white/80">
              {['POS', 'KDS', 'QR ordering', 'Payments', 'Inventory', 'Analytics'].map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </div>
        </section>

        {/* Features grid */}
        <section id="product" className="px-5 py-20 sm:px-8 sm:py-28 lg:px-12">
          <div className="mx-auto max-w-[1380px]">
            <div className="grid gap-8 lg:grid-cols-2 lg:items-end">
              <div>
                <p className="text-xs font-black uppercase tracking-[.2em] text-brand">The operating layer</p>
                <h2 className="mt-4 max-w-3xl text-4xl font-black leading-[.95] tracking-[-.055em] sm:text-6xl">
                  Everything your service needs. Nothing it doesn&apos;t.
                </h2>
              </div>
              <p className="max-w-xl text-base leading-8 text-text-secondary-light lg:justify-self-end">
                RestaurantMS keeps each role focused while connecting the decisions that affect everyone—from the guest at table eight to the owner reviewing both branches.
              </p>
            </div>
            <div className="mt-14 grid gap-px overflow-hidden rounded-3xl border border-black/10 bg-black/10 md:grid-cols-2 xl:grid-cols-3">
              {features.map(([n, title, copy]) => (
                <article className="min-h-64 bg-surface-warm p-7 transition hover:bg-white" key={n}>
                  <span className="text-xs font-black text-brand">{n}</span>
                  <h3 className="mt-12 text-xl font-black tracking-[-.03em]">{title}</h3>
                  <p className="mt-3 text-sm leading-6 text-text-secondary-light">{copy}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Roles */}
        <section id="roles" className="bg-surface-subtle px-5 py-20 sm:px-8 sm:py-28 lg:px-12">
          <div className="mx-auto grid max-w-[1380px] gap-12 lg:grid-cols-[.8fr_1.2fr]">
            <div>
              <p className="text-xs font-black uppercase tracking-[.2em] text-brand-700">Made for the whole room</p>
              <h2 className="mt-4 text-4xl font-black leading-[.96] tracking-[-.055em] sm:text-6xl">
                The right amount of system for every role.
              </h2>
              <p className="mt-6 max-w-md text-base leading-8 text-text-secondary-dark">
                No bloated screens. Each person sees the tools, branch, and decisions their work requires.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {roles.map(([role, copy], i) => (
                <article
                  className={`rounded-2xl p-6 ${i === 0 ? 'bg-ink text-white' : 'border border-black/10 bg-canvas'}`}
                  key={role}
                >
                  <span className="text-[10px] font-black uppercase tracking-[.16em] opacity-65">
                    0{i + 1}
                  </span>
                  <h3 className="mt-6 text-xl font-black">{role}</h3>
                  <p className="mt-2 text-sm opacity-70">{copy}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Security */}
        <section id="security" className="px-5 py-20 sm:px-8 sm:py-28 lg:px-12">
          <div className="mx-auto max-w-[1380px]">
              <div className="rounded-[2rem] bg-accent-teal p-7 text-white sm:p-12 lg:p-16">
              <div className="grid gap-12 lg:grid-cols-2">
                <div>
                  <p className="text-xs font-black uppercase tracking-[.2em] text-accent-gold-muted">Trust is operational</p>
                  <h2 className="mt-4 text-4xl font-black leading-[.98] tracking-[-.05em] sm:text-6xl">
                    Your restaurant data stays in its lane.
                  </h2>
                </div>
                <div className="grid gap-6 sm:grid-cols-2">
                  {[
                    ['Tenant isolation', 'Restaurant and branch context follows every protected request.'],
                    ['Role controls', 'Access is limited by current membership, role, and branch assignment.'],
                    ['Auditability', 'Sensitive team, payment, and configuration actions leave a trail.'],
                    ['Privacy-aware', 'Data handling is designed around Ethiopia\'s Personal Data Protection Proclamation.'],
                  ].map(([title, copy]) => (
                    <div className="border-t border-white/20 pt-5" key={title}>
                      <h3 className="font-black">{title}</h3>
                      <p className="mt-2 text-sm leading-6 text-white/70">{copy}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="px-5 pb-20 sm:px-8 sm:pb-28 lg:px-12">
          <div className="mx-auto grid max-w-[1180px] gap-10 lg:grid-cols-[.65fr_1.35fr]">
            <div>
              <p className="text-xs font-black uppercase tracking-[.2em] text-brand">Questions, answered</p>
              <h2 className="mt-4 text-4xl font-black tracking-[-.05em]">Before the first shift.</h2>
            </div>
            <div className="divide-y divide-black/10 border-y border-black/10" role="list">
              {questions.map(([q, a], i) => {
                const isOpen = openFaq === i;
                const panelId = `faq-panel-${i}`;
                const buttonId = `faq-button-${i}`;
                return (
                  <div role="listitem" key={q}>
                    <button
                      id={buttonId}
                      className="w-full py-6 text-left"
                      aria-expanded={isOpen}
                      aria-controls={panelId}
                      onClick={() => setOpenFaq(isOpen ? -1 : i)}
                    >
                      <span className="flex items-center justify-between gap-4 font-black">
                        <span>{q}</span>
                        <span className="text-xl text-brand" aria-hidden="true">
                          {isOpen ? '−' : '+'}
                        </span>
                      </span>
                    </button>
                    <div
                      id={panelId}
                      role="region"
                      aria-labelledby={buttonId}
                      hidden={!isOpen}
                    >
                      <p className="mb-6 max-w-2xl text-sm leading-7 text-text-secondary-light">{a}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="px-5 pb-20 sm:px-8 sm:pb-28 lg:px-12">
          <div className="mx-auto max-w-[1380px] overflow-hidden rounded-[2rem] bg-brand px-7 py-14 text-center text-white sm:px-12 sm:py-20">
            <p className="text-xs font-black uppercase tracking-[.2em] text-white/95">
              Your next service can feel calmer
            </p>
            <h2 className="mx-auto mt-5 max-w-4xl text-4xl font-black leading-[.95] tracking-[-.06em] sm:text-7xl">
              One restaurant. Every branch. Fully in rhythm.
            </h2>
            <Link
              href="/login"
              className="mx-auto mt-9 grid min-h-14 w-fit place-items-center rounded-xl bg-white px-8 text-sm font-black text-ink"
            >
              Enter RestaurantMS →
            </Link>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}

/* ─── Header ─────────────────────────────────── */

interface MarketingHeaderProps {
  open: boolean;
  setOpen: (value: boolean) => void;
  menuButtonRef: React.RefObject<HTMLButtonElement | null>;
  menuNavRef: React.RefObject<HTMLElement | null>;
}

export function MarketingHeader({ open, setOpen, menuButtonRef, menuNavRef }: MarketingHeaderProps) {
  return (
    <header className="sticky top-0 z-50 border-b border-black/[.06] bg-canvas/90 backdrop-blur-xl">
      <div className="mx-auto flex min-h-[76px] max-w-[1480px] items-center px-5 sm:px-8 lg:px-12">
        <Link href="/" className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-brand text-sm font-black text-white">R</span>
          <span>
            <b className="block leading-none">RestaurantMS</b>
            <span className="mt-1 block text-[9px] font-black uppercase tracking-[.18em] text-text-secondary-light">Hospitality OS</span>
          </span>
        </Link>

        <nav className="ml-auto hidden items-center gap-7 text-xs font-black lg:flex" aria-label="Main navigation">
          <a href="/#product">Product</a>
          <a href="/#roles">Roles</a>
          <a href="/#security">Security</a>
          <a href="/#faq">FAQ</a>
          <Link href="/login" className="rounded-xl bg-ink px-5 py-3 text-white">
            Staff sign in
          </Link>
        </nav>

        <button
          ref={menuButtonRef}
          className="ml-auto grid size-11 place-items-center rounded-xl border border-black/10 lg:hidden"
          aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen(!open)}
        >
          {open ? '✕' : '☰'}
        </button>
      </div>

      {open && (
        <nav
          id="mobile-nav"
          ref={menuNavRef}
          className="border-t border-black/10 bg-canvas p-5 text-sm font-black lg:hidden"
          aria-label="Mobile navigation"
        >
          <div className="grid gap-4">
            <a href="/#product" onClick={() => setOpen(false)}>Product</a>
            <a href="/#roles" onClick={() => setOpen(false)}>Roles</a>
            <a href="/#security" onClick={() => setOpen(false)}>Security</a>
            <a href="/#faq" onClick={() => setOpen(false)}>FAQ</a>
            <Link href="/login">Staff sign in →</Link>
          </div>
        </nav>
      )}
    </header>
  );
}

/* ─── Footer ─────────────────────────────────── */

export function MarketingFooter() {
  return (
    <footer className="bg-dark-deep px-5 py-12 text-white sm:px-8 lg:px-12">
      <div className="mx-auto max-w-[1380px]">
        <div className="grid gap-10 border-b border-white/10 pb-10 md:grid-cols-[1.5fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-brand text-sm font-black">R</span>
              <b>RestaurantMS</b>
            </div>
            <p className="mt-4 max-w-sm text-sm leading-6 text-white/55">
              A modern restaurant operating system designed for hospitality teams in Ethiopia.
            </p>
          </div>
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-white/50">Product</p>
            <div className="mt-4 grid gap-3 text-sm text-white/65">
              <a href="/#product">Features</a>
              <a href="/#roles">Roles</a>
              <a href="/#security">Security</a>
              <Link href="/login">Staff sign in</Link>
            </div>
          </div>
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-white/50">Legal</p>
            <div className="mt-4 grid gap-3 text-sm text-white/65">
              <Link href="/legal/terms">Terms of Service</Link>
              <Link href="/legal/privacy">Privacy Notice</Link>
              <Link href="/legal/cookies">Cookie Policy</Link>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-3 pt-6 text-[11px] text-white/50 sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 RestaurantMS. All rights reserved.</p>
          <p>ETB amounts shown are illustrative. RestaurantMS is not a bank or payment provider.</p>
        </div>
      </div>
    </footer>
  );
}

/* ─── Product Preview (decorative) ───────────── */

function ProductPreview() {
  return (
    <div className="relative mx-auto w-full max-w-2xl" aria-hidden="true">
      <div className="absolute -inset-8 rotate-3 rounded-[2.5rem] bg-border-strong/50" />
      <div className="relative overflow-hidden rounded-[1.75rem] border border-black/10 bg-white p-3 shadow-[0_35px_100px_rgba(32,24,17,.22)]">
        {/* Window chrome */}
        <div className="flex items-center gap-2 border-b border-black/[.06] px-2 pb-3">
          <span className="size-2 rounded-full bg-red-300" />
          <span className="size-2 rounded-full bg-amber-300" />
          <span className="size-2 rounded-full bg-emerald-300" />
          <span className="ml-auto text-[9px] font-black text-black/65">BOLE MAIN · LIVE</span>
        </div>

        <div className="grid min-h-[480px] grid-cols-[82px_1fr] sm:grid-cols-[120px_1fr]">
          {/* Sidebar */}
          <div className="rounded-bl-2xl bg-dark-deep p-3 text-white">
            <span className="grid size-8 place-items-center rounded-lg bg-brand text-xs font-black">R</span>
            <div className="mt-8 space-y-3">
              {['OV', 'PS', 'OR', 'KD', 'IN', 'RP'].map((x, i) => (
                <div
                  className={`rounded-lg px-2 py-2 text-[8px] font-black ${i === 0 ? 'bg-white text-black' : 'text-white/55'}`}
                  key={x}
                >
                  {x}
                </div>
              ))}
            </div>
          </div>

          {/* Dashboard content */}
          <div className="bg-canvas p-4 sm:p-6">
            <p className="text-[9px] font-black uppercase tracking-wider text-brand">Today · Bole Main</p>
            <h2 className="mt-2 text-2xl font-black tracking-[-.04em]">Good morning, Abebe.</h2>

            <div className="mt-5 grid grid-cols-2 gap-2">
              {[['Revenue', 'ETB 48,260'], ['Active orders', '24'], ['Prep time', '18 min'], ['Reviews', '5']].map(([x, y], i) => (
                <div className="rounded-xl border border-black/[.06] bg-white p-3" key={x}>
                  <p className="text-[8px] font-bold text-black/60">{x}</p>
                  <p className={`mt-2 text-sm font-black ${i === 3 ? 'text-brand' : ''}`}>{y}</p>
                </div>
              ))}
            </div>

            {/* Revenue pulse chart */}
            <div className="mt-3 rounded-xl border border-black/[.06] bg-white p-4">
              <div className="flex items-end justify-between">
                <b className="text-xs">Revenue pulse</b>
                <span className="text-[8px] text-emerald-700">↑ 12.4%</span>
              </div>
              <div className="mt-5 flex h-28 items-end gap-2">
                {[35, 55, 46, 78, 60, 90, 72].map((h, i) => (
                  <div
                    className="flex-1 rounded-t bg-accent-teal"
                    style={{ height: `${h}%`, opacity: 0.45 + i * 0.07 }}
                    key={i}
                  />
                ))}
              </div>
            </div>

            {/* Kitchen status pills */}
            <div className="mt-3 grid grid-cols-3 gap-2">
              {['6 queued', '8 cooking', '3 ready'].map((x) => (
                <div className="rounded-xl bg-ink p-3 text-[8px] font-black text-white" key={x}>
                  {x}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
