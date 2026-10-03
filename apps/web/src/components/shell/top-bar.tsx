'use client';

import { Menu } from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import { ConnectivityIndicator } from '@/components/connectivity-indicator';
import { useLocale } from '@/components/locale-provider';
import { BranchPicker } from './branch-picker';
import { AccountMenu } from './account-menu';
import { useBranch } from './branch-provider';

export function TopBar({
  initials,
  onOpenMobileNav,
}: {
  initials: string;
  onOpenMobileNav: () => void;
}) {
  const { branchId, branches, setBranchId } = useBranch();
  const { profile } = useAuth();
  const { tr } = useLocale();
  const workspaceName = profile?.memberships?.[0]?.tenant.name ?? tr('navigation.navPlatform');

  return (
    <header className="glass-surface sticky top-0 z-20 flex min-h-[72px] items-center gap-3 border-x-0 border-t-0 px-4 sm:px-7 lg:px-9">
      <button
        className="grid size-11 place-items-center rounded-control border border-border bg-surface text-ink shadow-sm transition hover:bg-surface-subtle lg:hidden"
        aria-label={tr('navigation.openNav')}
        onClick={onOpenMobileNav}
      >
        <Menu size={20} aria-hidden="true" />
      </button>
      <BranchPicker
        branches={branches}
        value={branchId}
        onChange={setBranchId}
        workspaceName={workspaceName}
      />
      <div className="ms-auto hidden sm:block">
        <ConnectivityIndicator />
      </div>
      <AccountMenu initials={initials} />
    </header>
  );
}
