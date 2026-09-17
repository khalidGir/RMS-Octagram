'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/cn';
import { navItems } from './nav-config';
import type { AppRole } from '@/components/staff-shell';

export function MobileNav({
  role,
  onOpenMore,
}: {
  role: AppRole;
  onOpenMore: () => void;
}) {
  const pathname = usePathname();
  const visibleNav = navItems
    .filter((item) => (item.roles as readonly string[]).includes(role))
    .sort((a, b) => (a.mobileOrder ?? 99) - (b.mobileOrder ?? 99));

  const primary = visibleNav.slice(0, 4);
  const hasMore = visibleNav.length > 4;

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 flex items-center border-t border-black/[.06] bg-white/95 backdrop-blur-xl safe-area-pb lg:hidden"
      aria-label="Mobile navigation"
    >
      {primary.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.label}
            href={item.href}
            className={cn(
              'flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-bold transition-colors',
              active ? 'text-brand' : 'text-ink-muted',
            )}
          >
            <item.icon size={20} aria-hidden="true" className={active ? 'text-brand' : ''} />
            <span className="truncate max-w-[64px]">{item.label}</span>
          </Link>
        );
      })}
      {hasMore && (
        <button
          onClick={onOpenMore}
          className="flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-bold text-ink-muted"
          aria-label="More navigation options"
        >
          <MoreHorizontal size={20} aria-hidden="true" />
          <span>More</span>
        </button>
      )}
    </nav>
  );
}
