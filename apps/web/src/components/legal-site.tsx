'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MarketingFooter } from './marketing-site';
import { useLocale, type MessageKey } from '@/components/locale-provider';
import { bundle, resolveMessage } from '@/locales';

type LegalDocId = 'terms' | 'privacy' | 'cookies';

const HEADS: Record<LegalDocId, { titleKey: MessageKey; summaryKey: MessageKey }> = {
  terms: { titleKey: 'legal.termsTitle', summaryKey: 'legal.termsSummary' },
  privacy: { titleKey: 'legal.privacyTitle', summaryKey: 'legal.privacySummary' },
  cookies: { titleKey: 'legal.cookiesTitle', summaryKey: 'legal.cookiesSummary' },
};

const SECTION_KEYS: Record<LegalDocId, { title: MessageKey; paragraphs: MessageKey[] }[]> = {
  terms: [
    { title: 'legal.termsS1Title', paragraphs: ['legal.termsS1P1'] },
    { title: 'legal.termsS2Title', paragraphs: ['legal.termsS2P1', 'legal.termsS2P2'] },
    { title: 'legal.termsS3Title', paragraphs: ['legal.termsS3P1'] },
    { title: 'legal.termsS4Title', paragraphs: ['legal.termsS4P1'] },
    { title: 'legal.termsS5Title', paragraphs: ['legal.termsS5P1', 'legal.termsS5P2'] },
    { title: 'legal.termsS6Title', paragraphs: ['legal.termsS6P1'] },
    { title: 'legal.termsS7Title', paragraphs: ['legal.termsS7P1'] },
    { title: 'legal.termsS8Title', paragraphs: ['legal.termsS8P1'] },
    { title: 'legal.termsS9Title', paragraphs: ['legal.termsS9P1'] },
    { title: 'legal.termsS10Title', paragraphs: ['legal.termsS10P1'] },
  ],
  privacy: [
    { title: 'legal.privacyS1Title', paragraphs: ['legal.privacyS1P1'] },
    { title: 'legal.privacyS2Title', paragraphs: ['legal.privacyS2P1', 'legal.privacyS2P2'] },
    { title: 'legal.privacyS3Title', paragraphs: ['legal.privacyS3P1'] },
    { title: 'legal.privacyS4Title', paragraphs: ['legal.privacyS4P1'] },
    { title: 'legal.privacyS5Title', paragraphs: ['legal.privacyS5P1'] },
    { title: 'legal.privacyS6Title', paragraphs: ['legal.privacyS6P1'] },
    { title: 'legal.privacyS7Title', paragraphs: ['legal.privacyS7P1'] },
    { title: 'legal.privacyS8Title', paragraphs: ['legal.privacyS8P1'] },
  ],
  cookies: [
    { title: 'legal.cookiesS1Title', paragraphs: ['legal.cookiesS1P1'] },
    { title: 'legal.cookiesS2Title', paragraphs: ['legal.cookiesS2P1'] },
    { title: 'legal.cookiesS3Title', paragraphs: ['legal.cookiesS3P1'] },
    { title: 'legal.cookiesS4Title', paragraphs: ['legal.cookiesS4P1'] },
    { title: 'legal.cookiesS5Title', paragraphs: ['legal.cookiesS5P1'] },
  ],
};

export function LegalDoc({ doc }: { doc: LegalDocId }) {
  const { locale, tr } = useLocale();
  const [showEnglish, setShowEnglish] = useState(false);
  const isDraftLocale = locale !== 'en';
  const text = (key: MessageKey) => showEnglish ? resolveMessage(bundle, 'en', key).text : tr(key);
  const head = HEADS[doc];

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="border-b border-black/10">
        <div className="mx-auto flex min-h-[76px] max-w-[1180px] items-center justify-between px-5 sm:px-8">
          <Link href="/" className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-brand text-sm font-black text-white">R</span><b>RestaurantMS</b></Link>
          <Link href="/" className="text-xs font-black">{tr('legal.backToHome')}</Link>
        </div>
      </header>
      <main className="px-5 py-14 sm:px-8 sm:py-20">
        <div className="mx-auto max-w-[860px]">
          <p className="text-xs font-black uppercase tracking-[.2em] text-brand">{text('legal.effectiveDate')}</p>
          <h1 className="mt-4 text-4xl font-black tracking-[-.055em] sm:text-6xl">{text(head.titleKey)}</h1>
          <p className="mt-5 max-w-2xl text-base leading-8 text-text-secondary-light">{text(head.summaryKey)}</p>

          {isDraftLocale && (
            <aside className="mt-8 rounded-2xl border border-warning/30 bg-warning-surface p-5 text-sm leading-6 text-ink" role="note" aria-labelledby="draft-translation-title">
              <p id="draft-translation-title" className="font-black">{tr('legal.draftTitle')}</p>
              <p className="mt-1">{tr('legal.draftBody')}</p>
              <button type="button" className="mt-4 min-h-11 rounded-control border border-warning/30 bg-surface px-4 font-bold text-ink" onClick={() => setShowEnglish((value) => !value)} aria-pressed={showEnglish}>
                {showEnglish ? tr('legal.viewTranslation') : tr('legal.viewEnglish')}
              </button>
            </aside>
          )}

          <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950"><b>{text('legal.noticeTitle')}</b> {text('legal.noticeBody')}</div>
          <article className="legal-copy mt-12 space-y-10 text-sm leading-7 text-[#514c46]" lang={showEnglish ? 'en' : locale} dir={showEnglish ? 'ltr' : undefined}>
            {SECTION_KEYS[doc].map((section) => (
              <section key={section.title}>
                <h2 className="text-xl font-black tracking-[-.025em] text-ink">{text(section.title)}</h2>
                <div className="mt-3 space-y-3">{section.paragraphs.map((key) => <p key={key}>{text(key)}</p>)}</div>
              </section>
            ))}
          </article>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}
