'use client';

import { useLocale } from './locale-provider';

export function LoginHeading() {
  const { tr } = useLocale();
  return <><p className="page-eyebrow">{tr('authentication.staffAccess')}</p><h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">{tr('authentication.welcome')}</h2><p className="mt-2 text-sm leading-6 text-ink-muted">{tr('authentication.authIntro')}</p></>;
}

export function LoginFootnote() {
  const { tr } = useLocale();
  return <><div className="mt-8 flex items-center gap-3 text-xs text-ink-muted"><span className="h-px flex-1 bg-line" /><span>{tr('authentication.secureAccess')}</span><span className="h-px flex-1 bg-line" /></div><p className="mt-6 text-center text-xs leading-5 text-ink-muted">{tr('authentication.needAccess')}</p></>;
}

export function LoginHero() {
  const { tr } = useLocale();
  return (
    <div className="relative my-auto max-w-xl">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-100">{tr('authentication.heroEyebrow')}</p>
      <h1 className="mt-5 text-5xl font-semibold leading-[1.05] tracking-[-0.055em]">{tr('authentication.heroTitle')}</h1>
      <p className="mt-6 max-w-lg text-lg leading-8 text-white/55">{tr('authentication.heroSubtitle')}</p>
      <div className="mt-10 flex gap-7">
        <div><p className="text-2xl font-semibold">24</p><p className="mt-1 text-xs text-white/55">{tr('authentication.heroStatOrders')}</p></div>
        <div className="w-px bg-white/10" />
        <div><p className="text-2xl font-semibold">{tr('authentication.heroStatPrepValue')}</p><p className="mt-1 text-xs text-white/55">{tr('authentication.heroStatPrep')}</p></div>
        <div className="w-px bg-white/10" />
        <div><p className="text-2xl font-semibold">2</p><p className="mt-1 text-xs text-white/55">{tr('authentication.heroStatBranches')}</p></div>
      </div>
    </div>
  );
}

export function LoginHeroFootnote() {
  const { tr } = useLocale();
  return <p className="relative text-xs text-white/50">{tr('authentication.heroFootnote')}</p>;
}
