'use client';

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
  const states = [
    ['Loading', 'Synchronizing restaurant data…', 'animate-pulse'],
    ['Empty', 'No orders match this view.', ''],
    ['Error', 'We could not load this section. Retry safely.', ''],
    ['Offline', 'Changes will sync when connection returns.', ''],
    ['Permission denied', 'Your role cannot access this branch.', ''],
  ] as const;

  return (
    <>
      <PageTitle label="System resilience" title="Application states" copy="Reusable states shown consistently across every role and workflow." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {states.map(([label, desc, anim]) => (
          <Panel className="grid min-h-52 place-items-center p-6 text-center" key={label}>
            <div>
              <span className={`mx-auto grid size-12 place-items-center rounded-full bg-muted text-xl ${anim}`}>◇</span>
              <h2 className="mt-4 font-black">{label}</h2>
              <p className="mt-2 text-sm text-ink-muted">{desc}</p>
              <button className="mt-4 text-sm font-black text-brand">{label === 'Permission denied' ? 'Go back' : 'Try again'}</button>
            </div>
          </Panel>
        ))}
      </div>
    </>
  );
}
