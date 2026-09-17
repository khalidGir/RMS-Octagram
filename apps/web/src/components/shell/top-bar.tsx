'use client';

import { Menu } from 'lucide-react';
import { ConnectivityIndicator } from '@/components/connectivity-indicator';
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

  return (
    <header className="sticky top-0 z-20 flex min-h-[72px] items-center gap-3 border-b border-black/[.06] bg-[#f6f3ed]/90 px-4 backdrop-blur-xl sm:px-7 lg:px-9">
      <button
        className="grid size-11 place-items-center rounded-xl border border-line bg-white lg:hidden"
        aria-label="Open navigation"
        onClick={onOpenMobileNav}
      >
        <Menu size={20} aria-hidden="true" />
      </button>
      <BranchPicker
        branches={branches}
        value={branchId}
        onChange={setBranchId}
      />
      <div className="ml-auto hidden sm:block">
        <ConnectivityIndicator />
      </div>
      <AccountMenu initials={initials} />
    </header>
  );
}
