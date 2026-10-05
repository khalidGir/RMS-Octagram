'use client';

import { useLocale } from '@/components/locale-provider';

export function PageTitle({ label, title, copy, action }: { label: string; title: string; copy: string; action?: React.ReactNode }) {
  return (
    <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs font-black uppercase tracking-[.18em] text-brand">{label}</p>
        <h1 className="mt-2 text-3xl font-black tracking-[-.04em] sm:text-4xl">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">{copy}</p>
      </div>
      {action}
    </header>
  );
}

export function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-panel border border-line bg-white shadow-card ${className}`}>{children}</section>;
}

export function StateGallery() {
  const { tr } = useLocale();
  const states = [
    [tr('common.stateLoading'), tr('common.stateLoadingDetail'), 'animate-pulse', false],
    [tr('common.stateEmpty'), tr('common.stateEmptyDetail'), '', false],
    [tr('common.stateError'), tr('common.stateErrorDetail'), '', false],
    [tr('common.offline'), tr('common.stateOfflineDetail'), '', false],
    [tr('common.permissionDenied'), tr('common.stateDeniedDetail'), '', true],
  ] as const;

  return (
    <>
      <PageTitle label={tr('common.galleryEyebrow')} title={tr('common.galleryTitle')} copy={tr('common.galleryCopy')} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {states.map(([label, desc, anim, isDenied]) => (
          <Panel className="grid min-h-52 place-items-center p-6 text-center" key={label}>
            <div>
              <span className={`mx-auto grid size-12 place-items-center rounded-full bg-muted text-xl ${anim}`}>◇</span>
              <h2 className="mt-4 font-black">{label}</h2>
              <p className="mt-2 text-sm text-ink-muted">{desc}</p>
              <button className="mt-4 text-sm font-black text-brand">{isDenied ? tr('common.goBack') : tr('common.tryAgain')}</button>
            </div>
          </Panel>
        ))}
      </div>
    </>
  );
}
