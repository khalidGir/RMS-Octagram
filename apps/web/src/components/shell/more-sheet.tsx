'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { navItems } from './nav-config';
import type { AppRole } from '@/components/staff-shell';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';

export function MoreSheet({
  role,
  open,
  onClose,
}: {
  role: AppRole;
  open: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const visibleNav = navItems
    .filter((item) => (item.roles as readonly string[]).includes(role))
    .slice(4);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className="bottom-0 top-auto left-0 right-0 translate-x-0 translate-y-0 max-h-[70vh] overflow-y-auto rounded-t-2xl border-t border-black/10 p-4 lg:hidden"
        aria-label="More navigation"
      >
        <DialogTitle className="text-sm font-black">More</DialogTitle>
        <nav className="mt-3 space-y-1" aria-label="More navigation options">
          {visibleNav.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.label}
                href={item.href}
                onClick={onClose}
                className={cn(
                  'flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors',
                  active ? 'bg-brand/10 text-brand' : 'text-ink hover:bg-surface-subtle',
                )}
              >
                <item.icon size={20} aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </DialogContent>
    </Dialog>
  );
}
