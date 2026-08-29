'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { BrandMark } from './brand-mark';
import { ConnectivityIndicator } from './connectivity-indicator';
import { useAuth } from './auth-provider';

export type AppRole = 'OWNER' | 'MANAGER' | 'CASHIER' | 'KITCHEN_STAFF' | 'WAITER' | 'SUPER_ADMIN';
const roleLabels: Record<AppRole,string> = { OWNER:'Owner', MANAGER:'Manager', CASHIER:'Cashier', KITCHEN_STAFF:'Kitchen staff', WAITER:'Waiter', SUPER_ADMIN:'Super admin' };
const nav = [
  {label:'Overview',icon:'OV',href:'/',roles:['OWNER','MANAGER']}, {label:'Point of sale',icon:'PS',href:'/pos',roles:['OWNER','MANAGER','CASHIER']},
  {label:'Orders',icon:'OR',href:'/orders',roles:['OWNER','MANAGER','CASHIER']}, {label:'Payment review',icon:'PR',href:'/payments',roles:['OWNER']},
  {label:'Kitchen display',icon:'KD',href:'/kitchen',roles:['OWNER','MANAGER','KITCHEN_STAFF']}, {label:'Waiter workspace',icon:'WT',href:'/waiter',roles:['WAITER']},
  {label:'Tables & QR',icon:'TQ',href:'/tables',roles:['OWNER','MANAGER']}, {label:'My cash shift',icon:'SH',href:'/shifts',roles:['OWNER','MANAGER','CASHIER']},
  {label:'Menu',icon:'MN',href:'/menu',roles:['OWNER','MANAGER']}, {label:'Inventory',icon:'IN',href:'/inventory',roles:['OWNER','MANAGER']},
  {label:'Reports',icon:'RP',href:'/reports',roles:['OWNER','MANAGER']}, {label:'Team & branches',icon:'TM',href:'/team',roles:['OWNER','MANAGER']},
  {label:'Settings',icon:'ST',href:'/settings',roles:['OWNER','MANAGER']}, {label:'Platform',icon:'PL',href:'/platform',roles:['SUPER_ADMIN']},
  {label:'Feature control',icon:'FC',href:'/platform/features',roles:['SUPER_ADMIN']},
] as const;

export function StaffShell({children,initialRole='OWNER'}:{children:React.ReactNode;initialRole?:AppRole}) {
  const {profile,loading}=useAuth(); const router=useRouter(); const pathname=usePathname(); const [open,setOpen]=useState(false); const [branchId,setBranchId]=useState('');
  const membership=profile?.memberships[0]; const role:AppRole=profile?.platformRole==='SUPER_ADMIN'?'SUPER_ADMIN':membership?.role??initialRole;
  const branches=useMemo(()=>membership?.branchAssignments.filter((item)=>item.branch.isActive).map((item)=>item.branch)??[],[membership]);
  const visibleNav=useMemo(()=>nav.filter((item)=>(item.roles as readonly string[]).includes(role)),[role]);
  useEffect(()=>{if(!loading&&!profile)router.replace('/login');},[loading,profile,router]);
  useEffect(()=>{const saved=window.sessionStorage.getItem('rms-branch-id');const next=branches.find((item)=>item.id===saved)?.id??branches[0]?.id??'';setBranchId(next);if(next)window.sessionStorage.setItem('rms-branch-id',next);},[branches]);
  if(loading||!profile)return <main className="grid min-h-screen place-items-center bg-[#f6f3ed]"><p className="font-bold text-ink-muted">Restoring secure workspace…</p></main>;
  const initials=profile.displayName.split(/\s+/).map((part)=>part[0]).join('').slice(0,2).toUpperCase();
  return <div className="min-h-screen bg-[#f6f3ed] lg:grid lg:grid-cols-[260px_1fr]">{open&&<button className="fixed inset-0 z-30 bg-black/45 lg:hidden" aria-label="Close navigation" onClick={()=>setOpen(false)}/>}<aside className={`fixed inset-y-0 left-0 z-40 flex w-[260px] flex-col overflow-y-auto bg-[#101815] px-4 py-5 text-white transition-transform lg:sticky lg:top-0 lg:h-screen ${open?'translate-x-0':'-translate-x-full lg:translate-x-0'}`}><div className="px-2"><BrandMark/></div><div className="mt-6 rounded-xl border border-white/10 bg-white/[.06] p-3"><p className="text-[9px] font-black uppercase tracking-[.16em] text-white/40">Signed in as</p><p className="mt-1 text-sm font-black">{roleLabels[role]}</p></div><nav className="mt-5 space-y-1" aria-label="Staff navigation">{visibleNav.map((item)=>{const active=pathname===item.href||(item.href!=='/'&&pathname.startsWith(`${item.href}/`));return <Link key={item.label} href={item.href} onClick={()=>setOpen(false)} className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold ${active?'bg-white text-[#18201d]':'text-white/65 hover:bg-white/[.08] hover:text-white'}`}><span className="grid size-7 place-items-center rounded-lg text-[10px] font-black">{item.icon}</span>{item.label}</Link>;})}</nav></aside><div className="min-w-0"><header className="sticky top-0 z-20 flex min-h-[72px] items-center gap-3 border-b border-black/[.06] bg-[#f6f3ed]/90 px-4 backdrop-blur-xl sm:px-7 lg:px-9"><button className="grid size-11 place-items-center rounded-xl border border-line bg-white lg:hidden" aria-label="Open navigation" onClick={()=>setOpen(true)}>☰</button>{role!=='SUPER_ADMIN'&&<label className="hidden items-center gap-2 sm:flex"><span className="text-xs font-bold text-ink-muted">Branch</span><select aria-label="Active branch" value={branchId} onChange={(event)=>{setBranchId(event.target.value);window.sessionStorage.setItem('rms-branch-id',event.target.value);window.location.reload();}} className="min-h-11 rounded-lg border border-line bg-white px-3 text-xs font-black">{branches.map((branch)=><option value={branch.id} key={branch.id}>{branch.name}</option>)}</select></label>}<div className="ml-auto hidden sm:block"><ConnectivityIndicator/></div><Link href="/account" className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-[#31584a] text-sm font-black text-white">{initials}</span><span className="hidden md:block"><span className="block text-sm font-bold">{profile.displayName}</span><span className="text-xs text-ink-muted">{roleLabels[role]}</span></span></Link></header><main className="staff-grid min-h-[calc(100vh-72px)] p-4 sm:p-7 lg:p-9">{children}</main></div></div>;
}
