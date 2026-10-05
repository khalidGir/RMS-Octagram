'use client';

import Link from 'next/link';
import { LogOut, Settings, User } from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import { LanguagePicker } from '@/components/language-picker';
import { useLocale } from '@/components/locale-provider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function AccountMenu({ initials }: { initials: string }) {
  const { logout, profile } = useAuth();
  const { tr } = useLocale();
  const firstRole = profile?.memberships[0]?.role;
  const canOpenSettings = firstRole === 'OWNER' || firstRole === 'MANAGER';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="grid size-11 place-items-center rounded-full bg-dark text-sm font-semibold text-white shadow-sm transition hover:bg-dark-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
          aria-label={tr('navigation.myAccount')}
        >
          {initials}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-48">
        <DropdownMenuLabel>{tr('navigation.myAccount')}</DropdownMenuLabel>
        <div className="px-2 py-1"><LanguagePicker /></div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/account" className="flex items-center gap-2">
            <User size={16} aria-hidden="true" />
            {tr('navigation.profile')}
          </Link>
        </DropdownMenuItem>
        {canOpenSettings && (
          <DropdownMenuItem asChild>
            <Link href="/settings" className="flex items-center gap-2">
              <Settings size={16} aria-hidden="true" />
              {tr('navigation.settings')}
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            logout();
          }}
          className="text-red-600 focus:text-red-600"
        >
          <LogOut size={16} aria-hidden="true" />
          {tr('navigation.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
