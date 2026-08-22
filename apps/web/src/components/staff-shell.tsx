'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { BrandMark } from './brand-mark';
import { ConnectivityIndicator } from './connectivity-indicator';

export type AppRole = 'OWNER' | 'MANAGER' | 'CASHIER' | 'KITCHEN_STAFF' | 'SUPER_ADMIN';

const roleLabels: Record<AppRole, string> = { OWNER: 'Owner', MANAGER: 'Manager', CASHIER: 'Cashier', KITCHEN_STAFF: 'Kitchen staff', SUPER_ADMIN: 'Super admin' };
const nav = [
  { label: 'Overview', icon: '◫', href: '/', roles: ['OWNER','MANAGER'] },
  { label: 'Point of sale', icon: '▦', href: '/pos', roles: ['OWNER','MANAGER','CASHIER'] },
  { label: 'Orders', icon: '◇', href: '/orders', roles: ['OWNER','MANAGER','CASHIER'] },
  { label: 'Payments', icon: '▣', href: '/payments', roles: ['OWNER','MANAGER','CASHIER'] },
  { label: 'Kitchen display', icon: '◧', href: '/kitchen', roles: ['OWNER','MANAGER','KITCHEN_STAFF'] },
  { label: 'Tables & QR', icon: '⌗', href: '/tables', roles: ['OWNER','MANAGER'] },
  { label: 'Menu', icon: '⌑', href: '/menu', roles: ['OWNER','MANAGER'] },
  { label: 'Inventory', icon: '▤', href: '/inventory', roles: ['OWNER','MANAGER'] },
  { label: 'Reports', icon: '↗', href: '/reports', roles: ['OWNER','MANAGER'] },
  { label: 'Team & branches', icon: '♙', href: '/team', roles: ['OWNER','MANAGER'] },
  { label: 'Settings', icon: '⚙', href: '/settings', roles: ['OWNER','MANAGER'] },
  { label: 'Platform', icon: '◆', href: '/platform', roles: ['SUPER_ADMIN'] },
  { label: 'Feature control', icon: 'PF', href: '/platform/features', roles: ['SUPER_ADMIN'] },
] as const;

export function StaffShell({ children, initialRole = 'OWNER' }: { children: React.ReactNode; initialRole?: AppRole }) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<AppRole>(initialRole);
  const [branch, setBranch] = useState('Bole Main');
  const [notices, setNotices] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const visibleNav = useMemo(() => nav.filter((item) => (item.roles as readonly string[]).includes(role)), [role]);

  useEffect(() => {
    if (initialRole === 'OWNER') {
      const saved = window.sessionStorage.getItem('rms-preview-role') as AppRole | null;
      if (saved && saved in roleLabels) setRole(saved);
    }
  }, [initialRole]);

  function changeRole(next: AppRole) {
    setRole(next);
    window.sessionStorage.setItem('rms-preview-role', next);
    const allowed = nav.find((item) => item.href === pathname)?.roles as readonly string[] | undefined;
    if (!allowed?.includes(next)) router.push(next === 'SUPER_ADMIN' ? '/platform' : next === 'KITCHEN_STAFF' ? '/kitchen' : next === 'CASHIER' ? '/pos' : '/');
  }

  return <div className="min-h-screen bg-[#f6f3ed] lg:grid lg:grid-cols-[260px_1fr]">
    {open && <button className="fixed inset-0 z-30 bg-black/45 lg:hidden" aria-label="Close navigation" onClick={() => setOpen(false)} />}
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-[260px] flex-col overflow-y-auto bg-[#101815] px-4 py-5 text-white transition-transform lg:sticky lg:top-0 lg:h-screen ${open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
      <div className="px-2"><BrandMark /></div>
      <div className="mt-6 rounded-xl border border-white/10 bg-white/[.06] p-2">
        <p className="px-2 pb-1 text-[9px] font-black uppercase tracking-[.16em] text-white/40">Preview role</p>
        <select aria-label="Preview role" value={role} onChange={(e) => changeRole(e.target.value as AppRole)} className="w-full rounded-lg bg-white/10 px-2 py-2 text-xs font-black text-white outline-none">
          {Object.entries(roleLabels).map(([value,label]) => <option className="text-black" value={value} key={value}>{label}</option>)}
        </select>
      </div>
      <nav className="mt-5 space-y-1" aria-label="Staff navigation">{visibleNav.map((item) => {
        const active = pathname === item.href || (item.href !== '/' && pathname.startsWith(`${item.href}/`));
        return <Link key={item.label} href={item.href} onClick={() => setOpen(false)} className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition ${active ? 'bg-white text-[#18201d] shadow-sm' : 'text-white/62 hover:bg-white/[.08] hover:text-white'}`}><span className={`grid size-7 place-items-center rounded-lg text-sm ${active ? 'bg-brand/12 text-brand' : 'text-white/50'}`}>{item.icon}</span>{item.label}</Link>;
      })}</nav>
      {role !== 'SUPER_ADMIN' && <div className="mt-auto rounded-2xl border border-white/10 bg-white/[.055] p-3.5"><p className="text-xs font-bold text-white/45">Current shift</p><div className="mt-2 flex items-center justify-between"><span className="text-sm font-bold">Day shift</span><span className="rounded-full bg-emerald-400/15 px-2 py-1 text-[10px] font-black text-emerald-300">OPEN</span></div><Link href="/shifts" className="mt-2 inline-block text-xs font-bold text-white/55">View shift →</Link></div>}
    </aside>
    <div className="min-w-0"><header className="sticky top-0 z-20 flex min-h-[72px] items-center gap-3 border-b border-black/[.06] bg-[#f6f3ed]/90 px-4 backdrop-blur-xl sm:px-7 lg:px-9">
      <button className="grid size-11 place-items-center rounded-xl border border-line bg-white text-lg lg:hidden" aria-label="Open navigation" onClick={() => setOpen(true)}>☰</button>
      {role !== 'SUPER_ADMIN' && <label className="hidden items-center gap-2 sm:flex"><span className="text-xs font-bold text-ink-muted">Branch</span><select aria-label="Active branch" value={branch} onChange={(e)=>setBranch(e.target.value)} className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-black"><option>Bole Main</option><option>Downtown</option></select></label>}
      <div className="ml-auto hidden sm:block"><ConnectivityIndicator /></div>
      <div className="relative"><button className="grid size-11 place-items-center rounded-xl border border-line bg-white text-base" aria-label="Notifications" onClick={()=>setNotices(v=>!v)}>◇<span className="absolute right-1 top-1 size-2 rounded-full bg-brand" /></button>{notices&&<div className="absolute right-0 top-14 w-80 rounded-2xl border border-line bg-white p-4 shadow-float"><p className="font-black">Notifications</p><div className="mt-3 space-y-3 text-xs"><p className="rounded-xl bg-amber-50 p-3"><b>Payment proof waiting</b><br/>Order #1047 · 7 minutes</p><p className="rounded-xl bg-red-50 p-3"><b>Low stock</b><br/>Beef portions below threshold</p></div><Link href="/account" className="mt-3 block text-xs font-black text-brand">View all →</Link></div>}</div>
      <Link href="/account" className="flex items-center gap-3 pl-1"><span className="grid size-10 place-items-center rounded-xl bg-[#31584a] text-sm font-black text-white">AK</span><span className="hidden leading-tight md:block"><span className="block text-sm font-bold">Abebe Kebede</span><span className="text-xs text-ink-muted">{roleLabels[role]}</span></span></Link>
    </header><main className="staff-grid min-h-[calc(100vh-72px)] p-4 sm:p-7 lg:p-9">{children}</main></div>
  </div>;
}
