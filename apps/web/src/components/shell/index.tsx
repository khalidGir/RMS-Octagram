'use client';

import { useEffect, useMemo, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import { useRouter } from 'next/navigation';
import { useOnlineStatus } from '@/hooks';
import { BranchProvider, useBranch } from './branch-provider';
import { NavRail } from './nav-rail';
import { MobileNav } from './mobile-nav';
import { TopBar } from './top-bar';
import { MoreSheet } from './more-sheet';

export type AppRole = 'OWNER' | 'MANAGER' | 'CASHIER' | 'KITCHEN_STAFF' | 'WAITER' | 'SUPER_ADMIN';

function ShellInner({ children, initialRole }: { children: React.ReactNode; initialRole: AppRole }) {
  const { profile, loading } = useAuth();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const online = useOnlineStatus();
  const { branches } = useBranch();

  const role: AppRole = profile?.platformRole === 'SUPER_ADMIN'
    ? 'SUPER_ADMIN'
    : profile?.memberships?.[0]?.role ?? initialRole;

  useEffect(() => {
    if (!loading && !profile) router.replace('/login');
  }, [loading, profile, router]);

  const initials = useMemo(() => {
    if (!profile) return '';
    return profile.displayName
      .split(/\s+/)
      .map((p) => p[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }, [profile]);

  if (loading || !profile) {
    return (
      <main className="grid min-h-screen place-items-center bg-canvas">
        <p className="font-bold text-ink-muted">Restoring secure workspace…</p>
      </main>
    );
  }

  if (!loading && branches.length === 0) {
    return (
      <main className="grid min-h-screen place-items-center bg-canvas">
        <div className="text-center">
          <p className="font-bold text-ink-muted">No branches assigned</p>
          <p className="mt-2 text-sm text-ink-muted">Contact your administrator to assign a branch.</p>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-canvas lg:grid lg:grid-cols-[auto_1fr]">
      {/* Mobile overlay — shows when nav is open to allow close */}
      {mobileNavOpen && (
        <button
          className="fixed inset-0 z-30 bg-black/45 lg:hidden"
          aria-label="Close navigation"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      {/* Desktop NavRail */}
      <div className="hidden lg:block">
        <NavRail
          role={role}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((c) => !c)}
        />
      </div>

      {/* Mobile NavRail (off-canvas) */}
      <div className="lg:hidden">
        <NavRail
          role={role}
          collapsed={false}
          onToggleCollapse={() => {}}
          mobileOpen={mobileNavOpen}
        />
      </div>

      <div className="min-w-0 flex flex-col">
        <TopBar
          initials={initials}
          onOpenMobileNav={() => setMobileNavOpen(true)}
        />
        {!online && (
          <div className="flex items-center gap-2 bg-red-50 px-4 py-2 text-xs font-bold text-red-700" role="alert" aria-live="assertive">
            <WifiOff size={14} aria-hidden="true" />
            You are offline. Some features may be unavailable.
          </div>
        )}
        <main className="flex-1 px-4 py-6 sm:px-7 lg:px-9">
          {children}
        </main>
      </div>

      {/* Mobile bottom nav */}
      <div className="lg:hidden">
        <MobileNav role={role} onOpenMore={() => setMoreOpen(true)} />
      </div>

      {/* Mobile More sheet */}
      <MoreSheet role={role} open={moreOpen} onClose={() => setMoreOpen(false)} />

      {/* Spacer for bottom nav on mobile */}
      <div className="h-16 lg:hidden" aria-hidden="true" />
    </div>
  );
}

export function StaffShell({
  children,
  initialRole = 'OWNER',
}: {
  children: React.ReactNode;
  initialRole?: AppRole;
}) {
  return (
    <BranchProvider>
      <ShellInner initialRole={initialRole}>{children}</ShellInner>
    </BranchProvider>
  );
}
