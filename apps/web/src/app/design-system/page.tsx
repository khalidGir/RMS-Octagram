import { notFound } from 'next/navigation';

export default function DesignSystemPage() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <div className="mx-auto max-w-4xl space-y-12 p-8">
      <h1 className="text-3xl font-black text-ink">Design System</h1>

      <section className="space-y-4">
        <h2 className="text-xl font-bold text-ink">Colors</h2>
        <div className="grid grid-cols-5 gap-3">
          <div className="space-y-1"><div className="h-16 rounded-card bg-brand" /><p className="text-xs font-bold text-ink-muted">brand</p></div>
          <div className="space-y-1"><div className="h-16 rounded-card bg-brand-accent" /><p className="text-xs font-bold text-ink-muted">accent</p></div>
          <div className="space-y-1"><div className="h-16 rounded-card bg-success" /><p className="text-xs font-bold text-ink-muted">success</p></div>
          <div className="space-y-1"><div className="h-16 rounded-card bg-warning" /><p className="text-xs font-bold text-ink-muted">warning</p></div>
          <div className="space-y-1"><div className="h-16 rounded-card bg-danger" /><p className="text-xs font-bold text-ink-muted">danger</p></div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-bold text-ink">Typography</h2>
        <p className="text-display-lg font-black text-ink">Display LG</p>
        <p className="text-lg font-bold text-ink">Heading</p>
        <p className="text-sm text-ink">Body</p>
        <p className="text-xs text-ink-muted">Caption</p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-bold text-ink">Status Chips</h2>
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-bold text-success"><span className="size-1.5 rounded-full bg-current" />Active</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2.5 py-0.5 text-xs font-bold text-warning"><span className="size-1.5 rounded-full bg-current" />Pending</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-danger/10 px-2.5 py-0.5 text-xs font-bold text-danger"><span className="size-1.5 rounded-full bg-current" />Error</span>
        </div>
      </section>
    </div>
  );
}
