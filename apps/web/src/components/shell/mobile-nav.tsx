'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/cn';
import { navItems, activeNavHrefs, primaryMobileNav } from './nav-config';
import type { AppRole } from '@/components/staff-shell';
import { useLocale } from '@/components/locale-provider';

export function MobileNav({
  role,
  onOpenMore,
}: {
  role: AppRole;
  onOpenMore: () => void;
}) {
  const pathname = usePathname();
  const { tr } = useLocale();
  const fullVisible = navItems.filter((item) =>
    (item.roles as readonly string[]).includes(role),
  );
  const primary = primaryMobileNav(fullVisible);
  const hasMore = fullVisible.length > 4;
  const activeSet = activeNavHrefs(pathname, fullVisible, primary);

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 flex items-center border-t border-black/[.06] bg-white/95 backdrop-blur-xl safe-area-pb lg:hidden"
      aria-label={tr('navigation.mobileNav')}
    >
      {primary.map((item) => {
        const active = activeSet.has(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-bold transition-colors',
              active ? 'text-brand' : 'text-ink-muted',
            )}
          >
            <item.icon size={20} aria-hidden="true" className={active ? 'text-brand' : ''} />
            <span className="truncate max-w-[64px]">{tr(item.labelKey)}</span>
          </Link>
        );
      })}
      {hasMore && (
        <button
          onClick={onOpenMore}
          className="flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-bold text-ink-muted"
          aria-label={tr('navigation.moreOptions')}
        >
          <MoreHorizontal size={20} aria-hidden="true" />
          <span>{tr('navigation.more')}</span>
        </button>
      )}
    </nav>
  );
}
