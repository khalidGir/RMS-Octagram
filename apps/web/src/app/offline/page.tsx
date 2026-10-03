'use client';

import Link from 'next/link';
import { useLocale } from '@/components/locale-provider';

export default function OfflinePage() {
  const { tr } = useLocale();
  return <main className="grid min-h-screen place-items-center bg-canvas p-5"><section className="w-full max-w-md rounded-panel border border-border bg-surface p-8 text-center shadow-float"><span className="mx-auto grid size-16 place-items-center rounded-2xl bg-surface-subtle text-2xl">◇</span><p className="mt-6 page-eyebrow">{tr('common.offlineEyebrow')}</p><h1 className="mt-3 text-3xl font-semibold tracking-[-.04em]">{tr('common.offlineTitle')}</h1><p className="mt-3 text-sm leading-6 text-ink-muted">{tr('common.offlineDetail')}</p><Link href="/" className="mt-6 grid min-h-12 place-items-center rounded-control bg-brand text-sm font-semibold text-white">{tr('common.offlineRetry')}</Link></section></main>;
}
