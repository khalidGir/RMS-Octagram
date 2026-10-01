import Link from 'next/link';

export default function OfflinePage() {
  return <main className="grid min-h-screen place-items-center bg-canvas p-5"><section className="w-full max-w-md rounded-panel border border-border bg-surface p-8 text-center shadow-float"><span className="mx-auto grid size-16 place-items-center rounded-2xl bg-surface-subtle text-2xl">◇</span><p className="mt-6 page-eyebrow">Connection unavailable</p><h1 className="mt-3 text-3xl font-semibold tracking-[-.04em]">RestaurantMS is offline</h1><p className="mt-3 text-sm leading-6 text-ink-muted">This page was not cached. Start the local frontend server or reconnect, then try the destination again.</p><Link href="/" className="mt-6 grid min-h-12 place-items-center rounded-control bg-brand text-sm font-semibold text-white">Retry dashboard</Link></section></main>;
}
