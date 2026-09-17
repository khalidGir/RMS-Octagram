'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cn } from '@/lib/cn';
import { BrandMark } from '@/components/brand-mark';
import { navItems, roleLabels } from './nav-config';
import type { AppRole } from '@/components/staff-shell';

export function NavRail({
  role,
  collapsed,
  onToggleCollapse,
  mobileOpen = false,
}: {
  role: AppRole;
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen?: boolean;
}) {
  const pathname = usePathname();
  const visibleNav = navItems.filter((item) =>
    (item.roles as readonly string[]).includes(role),
  );

  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-40 flex flex-col overflow-y-auto bg-[#101815] text-white transition-all duration-200',
        collapsed ? 'w-[72px]' : 'w-[256px]',
        'lg:sticky lg:top-0 lg:h-screen',
        'max-lg:-translate-x-full',
        mobileOpen && 'max-lg:translate-x-0',
      )}
    >
      <div className={cn('flex items-center gap-3 px-3 pt-5 pb-4', collapsed && 'justify-center')}>
        <BrandMark compact={collapsed} />
      </div>

      <div className={cn(
        'mx-3 mb-4 rounded-xl border border-white/10 bg-white/[.06] p-3',
        collapsed && 'mx-2 px-2',
      )}>
        {!collapsed && (
          <>
            <p className="text-[9px] font-black uppercase tracking-[.16em] text-white/40">Signed in as</p>
            <p className="mt-1 text-sm font-black">{roleLabels[role]}</p>
          </>
        )}
        {collapsed && (
          <p className="text-[9px] font-black uppercase tracking-[.16em] text-white/40 text-center">
            {roleLabels[role]?.[0]}
          </p>
        )}
      </div>

      <nav className="flex-1 space-y-1 px-2" aria-label="Staff navigation">
        {visibleNav.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.label}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={cn(
                'group relative flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors',
                collapsed && 'justify-center px-0',
                active
                  ? 'bg-white text-[#18201d]'
                  : 'text-white/65 hover:bg-white/[.08] hover:text-white',
              )}
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-lg">
                <item.icon size={18} aria-hidden="true" />
              </span>
              {!collapsed && <span className="truncate">{item.label}</span>}
              {collapsed && (
                <span className="pointer-events-none absolute left-full ml-3 hidden whitespace-nowrap rounded-lg bg-[#1a2520] px-3 py-1.5 text-xs font-bold text-white shadow-lg group-hover:block">
                  {item.label}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="px-2 pb-4">
        <button
          onClick={onToggleCollapse}
          className="hidden lg:flex w-full items-center justify-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-white/45 hover:bg-white/[.08] hover:text-white transition-colors"
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        >
          {collapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
