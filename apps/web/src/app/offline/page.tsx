import Link from 'next/link';

export default function OfflinePage() {
  return <main className="grid min-h-screen place-items-center bg-[#f6f3ed] p-5"><section className="w-full max-w-md rounded-3xl border border-line bg-white p-8 text-center shadow-float"><span className="mx-auto grid size-16 place-items-center rounded-2xl bg-muted text-2xl">◇</span><p className="mt-6 text-xs font-black uppercase tracking-[.18em] text-brand">Connection unavailable</p><h1 className="mt-3 text-3xl font-black tracking-[-.04em]">RestaurantMS is offline</h1><p className="mt-3 text-sm leading-6 text-ink-muted">This page was not cached. Start the local frontend server or reconnect, then try the destination again.</p><Link href="/" className="mt-6 grid min-h-12 place-items-center rounded-xl bg-[#18241f] text-sm font-black text-white">Retry dashboard</Link></section></main>;
}
