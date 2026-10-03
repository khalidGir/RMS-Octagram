'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { LanguagePicker } from './language-picker';
import { useLocale, type MessageKey } from '@/components/locale-provider';

const FEATURE_KEYS: { n: string; titleKey: MessageKey; copyKey: MessageKey }[] = [
  { n: '01', titleKey: 'marketing.feat1Title', copyKey: 'marketing.feat1Copy' },
  { n: '02', titleKey: 'marketing.feat2Title', copyKey: 'marketing.feat2Copy' },
  { n: '03', titleKey: 'marketing.feat3Title', copyKey: 'marketing.feat3Copy' },
  { n: '04', titleKey: 'marketing.feat4Title', copyKey: 'marketing.feat4Copy' },
  { n: '05', titleKey: 'marketing.feat5Title', copyKey: 'marketing.feat5Copy' },
  { n: '06', titleKey: 'marketing.feat6Title', copyKey: 'marketing.feat6Copy' },
];

const ROLE_KEYS: { nameKey: MessageKey; copyKey: MessageKey }[] = [
  { nameKey: 'marketing.role1Name', copyKey: 'marketing.role1Copy' },
  { nameKey: 'marketing.role2Name', copyKey: 'marketing.role2Copy' },
  { nameKey: 'marketing.role3Name', copyKey: 'marketing.role3Copy' },
  { nameKey: 'marketing.role4Name', copyKey: 'marketing.role4Copy' },
  { nameKey: 'marketing.role5Name', copyKey: 'marketing.role5Copy' },
  { nameKey: 'marketing.role6Name', copyKey: 'marketing.role6Copy' },
];

const SECURITY_KEYS: { titleKey: MessageKey; copyKey: MessageKey }[] = [
  { titleKey: 'marketing.sec1Title', copyKey: 'marketing.sec1Copy' },
  { titleKey: 'marketing.sec2Title', copyKey: 'marketing.sec2Copy' },
  { titleKey: 'marketing.sec3Title', copyKey: 'marketing.sec3Copy' },
  { titleKey: 'marketing.sec4Title', copyKey: 'marketing.sec4Copy' },
];

const FAQ_KEYS: { qKey: MessageKey; aKey: MessageKey }[] = [
  { qKey: 'marketing.faqQ1', aKey: 'marketing.faqA1' },
  { qKey: 'marketing.faqQ2', aKey: 'marketing.faqA2' },
  { qKey: 'marketing.faqQ3', aKey: 'marketing.faqA3' },
  { qKey: 'marketing.faqQ4', aKey: 'marketing.faqA4' },
];

export function MarketingLanding() {
  const { tr } = useLocale();
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
        {tr('marketing.skipToContent')}
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
                {tr('marketing.heroBadge')}
              </div>
              <h1 className="mt-7 max-w-3xl text-[clamp(3.5rem,7vw,7.8rem)] font-black leading-[.86] tracking-[-.075em]">
                {tr('marketing.heroTitle1')}<br />
                <span className="text-brand">{tr('marketing.heroTitle2')}</span>
              </h1>
              <p className="mt-7 max-w-xl text-lg leading-8 text-text-secondary">
                {tr('marketing.heroSubtitle')}
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/login"
                  className="grid min-h-14 place-items-center rounded-xl bg-ink px-7 text-sm font-black text-white shadow-2xl shadow-black/15"
                >
                  {tr('marketing.ctaStaff')}
                </Link>
                <a
                  href="#product"
                  className="grid min-h-14 place-items-center rounded-xl border border-black/15 bg-white/60 px-7 text-sm font-black"
                >
                  {tr('marketing.ctaExplore')}
                </a>
              </div>
              <div className="mt-10 flex flex-wrap gap-x-8 gap-y-3 text-xs font-bold text-text-secondary-light">
                <span>{tr('marketing.tickEtb')}</span>
                <span>{tr('marketing.tickMulti')}</span>
                <span>{tr('marketing.tickTablet')}</span>
                <span>{tr('marketing.tickRole')}</span>
              </div>
            </div>
            <ProductPreview />
          </div>
        </section>

        {/* Capabilities strip */}
        <section className="border-b border-black/[.06] bg-ink px-5 py-7 text-white sm:px-8" aria-label={tr('marketing.capAria')}>
          <div className="mx-auto flex max-w-[1380px] flex-wrap items-center justify-between gap-5">
            <p className="text-xs font-black uppercase tracking-[.18em] text-white/55">
              {tr('marketing.capLine')}
            </p>
            <div className="flex flex-wrap gap-6 text-sm font-black text-white/80">
              {['POS', 'KDS', tr('marketing.capQr'), tr('marketing.capPayments'), tr('marketing.capInventory'), tr('marketing.capAnalytics')].map((item) => (
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
                <p className="text-xs font-black uppercase tracking-[.2em] text-brand">{tr('marketing.featEyebrow')}</p>
                <h2 className="mt-4 max-w-3xl text-4xl font-black leading-[.95] tracking-[-.055em] sm:text-6xl">
                  {tr('marketing.featTitle')}
                </h2>
              </div>
              <p className="max-w-xl text-base leading-8 text-text-secondary-light lg:justify-self-end">
                {tr('marketing.featIntro')}
              </p>
            </div>
            <div className="mt-14 grid gap-px overflow-hidden rounded-3xl border border-black/10 bg-black/10 md:grid-cols-2 xl:grid-cols-3">
              {FEATURE_KEYS.map(({ n, titleKey, copyKey }) => (
                <article className="min-h-64 bg-surface-warm p-7 transition hover:bg-white" key={n}>
                  <span className="text-xs font-black text-brand">{n}</span>
                  <h3 className="mt-12 text-xl font-black tracking-[-.03em]">{tr(titleKey)}</h3>
                  <p className="mt-3 text-sm leading-6 text-text-secondary-light">{tr(copyKey)}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Roles */}
        <section id="roles" className="bg-surface-subtle px-5 py-20 sm:px-8 sm:py-28 lg:px-12">
          <div className="mx-auto grid max-w-[1380px] gap-12 lg:grid-cols-[.8fr_1.2fr]">
            <div>
              <p className="text-xs font-black uppercase tracking-[.2em] text-brand-700">{tr('marketing.rolesEyebrow')}</p>
              <h2 className="mt-4 text-4xl font-black leading-[.96] tracking-[-.055em] sm:text-6xl">
                {tr('marketing.rolesTitle')}
              </h2>
              <p className="mt-6 max-w-md text-base leading-8 text-text-secondary-dark">
                {tr('marketing.rolesIntro')}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {ROLE_KEYS.map(({ nameKey, copyKey }, i) => (
                <article
                  className={`rounded-2xl p-6 ${i === 0 ? 'bg-ink text-white' : 'border border-black/10 bg-canvas'}`}
                  key={nameKey}
                >
                  <span className="text-[10px] font-black uppercase tracking-[.16em] opacity-65">
                    0{i + 1}
                  </span>
                  <h3 className="mt-6 text-xl font-black">{tr(nameKey)}</h3>
                  <p className="mt-2 text-sm opacity-70">{tr(copyKey)}</p>
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
                  <p className="text-xs font-black uppercase tracking-[.2em] text-accent-gold-muted">{tr('marketing.secEyebrow')}</p>
                  <h2 className="mt-4 text-4xl font-black leading-[.98] tracking-[-.05em] sm:text-6xl">
                    {tr('marketing.secTitle')}
                  </h2>
                </div>
                <div className="grid gap-6 sm:grid-cols-2">
                  {SECURITY_KEYS.map(({ titleKey, copyKey }) => (
                    <div className="border-t border-white/20 pt-5" key={titleKey}>
                      <h3 className="font-black">{tr(titleKey)}</h3>
                      <p className="mt-2 text-sm leading-6 text-white/70">{tr(copyKey)}</p>
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
              <p className="text-xs font-black uppercase tracking-[.2em] text-brand">{tr('marketing.faqEyebrow')}</p>
              <h2 className="mt-4 text-4xl font-black tracking-[-.05em]">{tr('marketing.faqTitle')}</h2>
            </div>
            <div className="divide-y divide-black/10 border-y border-black/10" role="list">
              {FAQ_KEYS.map(({ qKey, aKey }, i) => {
                const isOpen = openFaq === i;
                const panelId = `faq-panel-${i}`;
                const buttonId = `faq-button-${i}`;
                return (
                  <div role="listitem" key={qKey}>
                    <button
                      id={buttonId}
                      className="w-full py-6 text-start"
                      aria-expanded={isOpen}
                      aria-controls={panelId}
                      onClick={() => setOpenFaq(isOpen ? -1 : i)}
                    >
                      <span className="flex items-center justify-between gap-4 font-black">
                        <span>{tr(qKey)}</span>
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
                      <p className="mb-6 max-w-2xl text-sm leading-7 text-text-secondary-light">{tr(aKey)}</p>
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
              {tr('marketing.ctaEyebrow')}
            </p>
            <h2 className="mx-auto mt-5 max-w-4xl text-4xl font-black leading-[.95] tracking-[-.06em] sm:text-7xl">
              {tr('marketing.ctaTitle')}
            </h2>
            <Link
              href="/login"
              className="mx-auto mt-9 grid min-h-14 w-fit place-items-center rounded-xl bg-white px-8 text-sm font-black text-ink"
            >
              {tr('marketing.ctaBtn')}
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
  const { tr } = useLocale();
  return (
    <header className="sticky top-0 z-50 border-b border-black/[.06] bg-canvas/90 backdrop-blur-xl">
      <div className="mx-auto flex min-h-[76px] max-w-[1480px] items-center px-5 sm:px-8 lg:px-12">
        <Link href="/" className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-brand text-sm font-black text-white">R</span>
          <span>
            <b className="block leading-none">RestaurantMS</b>
            <span className="mt-1 block text-[9px] font-black uppercase tracking-[.18em] text-text-secondary-light">{tr('marketing.brandTagline')}</span>
          </span>
        </Link>

        <nav className="ms-auto hidden items-center gap-7 text-xs font-black lg:flex" aria-label={tr('marketing.ariaMainNav')}>
          <a href="/#product">{tr('marketing.navProduct')}</a>
          <a href="/#roles">{tr('marketing.navRoles')}</a>
          <a href="/#security">{tr('marketing.navSecurity')}</a>
          <a href="/#faq">{tr('marketing.navFaq')}</a>
          <Link href="/login" className="rounded-xl bg-ink px-5 py-3 text-white">
            {tr('marketing.navSignIn')}
          </Link>
          <LanguagePicker compact />
        </nav>

        <button
          ref={menuButtonRef}
          className="ms-auto grid size-11 place-items-center rounded-xl border border-black/10 lg:hidden"
          aria-label={open ? tr('marketing.ariaCloseMenu') : tr('marketing.ariaOpenMenu')}
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
          aria-label={tr('marketing.ariaMobileNav')}
        >
          <div className="grid gap-4">
            <LanguagePicker />
            <a href="/#product" onClick={() => setOpen(false)}>{tr('marketing.navProduct')}</a>
            <a href="/#roles" onClick={() => setOpen(false)}>{tr('marketing.navRoles')}</a>
            <a href="/#security" onClick={() => setOpen(false)}>{tr('marketing.navSecurity')}</a>
            <a href="/#faq" onClick={() => setOpen(false)}>{tr('marketing.navFaq')}</a>
            <Link href="/login">{tr('marketing.navSignInArrow')}</Link>
          </div>
        </nav>
      )}
    </header>
  );
}

/* ─── Footer ─────────────────────────────────── */

export function MarketingFooter() {
  const { tr } = useLocale();
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
              {tr('marketing.footDesc')}
            </p>
          </div>
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-white/50">{tr('marketing.footProductCol')}</p>
            <div className="mt-4 grid gap-3 text-sm text-white/65">
              <a href="/#product">{tr('marketing.footFeatures')}</a>
              <a href="/#roles">{tr('marketing.navRoles')}</a>
              <a href="/#security">{tr('marketing.navSecurity')}</a>
              <Link href="/login">{tr('marketing.navSignIn')}</Link>
            </div>
          </div>
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-white/50">{tr('marketing.footLegalCol')}</p>
            <div className="mt-4 grid gap-3 text-sm text-white/65">
              <Link href="/legal/terms">{tr('marketing.footTerms')}</Link>
              <Link href="/legal/privacy">{tr('marketing.footPrivacy')}</Link>
              <Link href="/legal/cookies">{tr('marketing.footCookies')}</Link>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-3 pt-6 text-[11px] text-white/50 sm:flex-row sm:items-center sm:justify-between">
          <p>{tr('marketing.copyright')}</p>
          <p>{tr('marketing.footDisclaimer')}</p>
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
          <span className="ms-auto text-[9px] font-black text-black/65">BOLE MAIN · LIVE</span>
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
