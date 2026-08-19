'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { BrandMark } from './brand-mark';
import { ConnectivityIndicator } from './connectivity-indicator';

const nav = [
  ['Overview', '◫', '/'], ['Point of sale', '▦', '/pos'], ['Orders', '◇', '#'], ['Kitchen display', '◧', '#'],
  ['Menu', '⌑', '/order/bole-main'], ['Inventory', '▤', '#'], ['Reports', '↗', '#'], ['Team & settings', '⚙', '#'],
] as const;

export function StaffShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  return (
    <div className="min-h-screen bg-[#f6f3ed] lg:grid lg:grid-cols-[250px_1fr]">
      {open && <button className="fixed inset-0 z-30 bg-black/45 lg:hidden" aria-label="Close navigation" onClick={() => setOpen(false)} />}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[250px] flex-col bg-[#121816] px-4 py-5 text-white transition-transform lg:sticky lg:top-0 lg:h-screen ${open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <div className="px-2"><BrandMark /></div>
        <nav className="mt-9 space-y-1" aria-label="Staff navigation">
          {nav.map(([label, icon, href]) => {
            const active = href !== '#' && pathname === href;
            return (
            <Link key={label} href={href} onClick={() => setOpen(false)} className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition ${active ? 'bg-white text-[#18201d] shadow-sm' : 'text-white/62 hover:bg-white/[0.08] hover:text-white'}`}>
              <span className={`grid size-7 place-items-center rounded-lg text-base ${active ? 'bg-brand/12 text-brand' : 'text-white/50'}`}>{icon}</span>{label}
            </Link>
          )})}
        </nav>
        <div className="mt-auto rounded-2xl border border-white/10 bg-white/[0.055] p-3.5">
          <p className="text-xs font-bold text-white/45">Current shift</p>
          <div className="mt-2 flex items-center justify-between"><span className="text-sm font-bold">Day shift</span><span className="rounded-full bg-emerald-400/15 px-2 py-1 text-[10px] font-black text-emerald-300">OPEN</span></div>
          <p className="mt-1 text-xs text-white/45">Started at 8:00 AM</p>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex min-h-[72px] items-center gap-3 border-b border-black/[0.06] bg-[#f6f3ed]/90 px-4 backdrop-blur-xl sm:px-7 lg:px-9">
          <button className="grid size-11 place-items-center rounded-xl border border-line bg-white text-lg lg:hidden" aria-label="Open navigation" onClick={() => setOpen(true)}>☰</button>
          <div className="ml-auto hidden sm:block"><ConnectivityIndicator /></div>
          <button className="grid size-11 place-items-center rounded-xl border border-line bg-white text-base" aria-label="Notifications">♢</button>
          <div className="flex items-center gap-3 pl-1"><span className="grid size-10 place-items-center rounded-xl bg-[#31584a] text-sm font-black text-white">AK</span><span className="hidden leading-tight md:block"><span className="block text-sm font-bold">Abebe Kebede</span><span className="text-xs text-ink-muted">Owner</span></span></div>
        </header>
        <main className="staff-grid min-h-[calc(100vh-72px)] p-4 sm:p-7 lg:p-9">{children}</main>
      </div>
    </div>
  );
}
