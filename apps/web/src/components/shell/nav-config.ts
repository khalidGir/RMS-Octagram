import type { AppRole } from '@/components/staff-shell';
import type { Route } from 'next';

import {
  LayoutDashboard, ShoppingCart, ClipboardList, CreditCard, ChefHat, UtensilsCrossed,
  Grid3x3, Wallet, Utensils, Package, BarChart3, Users, Settings, Shield, ToggleLeft,
  Coffee, Eye, CalendarCheck,
} from 'lucide-react';

export type NavGroup = 'Serve' | 'Kitchen' | 'Money' | 'Manage' | 'Platform';

export type NavItem = {
  label: string;
  icon: typeof LayoutDashboard;
  href: Route;
  roles: readonly AppRole[];
  group?: NavGroup;
  mobileOrder?: number;
};

export const navItems: NavItem[] = [
  { label: 'Overview', icon: LayoutDashboard, href: '/dashboard', roles: ['OWNER', 'MANAGER'], group: 'Serve', mobileOrder: 0 },
  { label: 'Point of sale', icon: ShoppingCart, href: '/pos', roles: ['OWNER', 'MANAGER', 'CASHIER'], group: 'Serve', mobileOrder: 1 },
  { label: 'Orders', icon: ClipboardList, href: '/orders', roles: ['OWNER', 'MANAGER', 'CASHIER'], group: 'Serve', mobileOrder: 2 },
  { label: 'Tables & QR', icon: Grid3x3, href: '/tables', roles: ['OWNER', 'MANAGER'], group: 'Serve' },
  { label: 'Waiter workspace', icon: UtensilsCrossed, href: '/waiter', roles: ['WAITER'], group: 'Serve', mobileOrder: 1 },

  { label: 'Kitchen display', icon: ChefHat, href: '/kitchen', roles: ['OWNER', 'MANAGER', 'KITCHEN_STAFF'], group: 'Kitchen', mobileOrder: 1 },
  { label: 'Expo', icon: Eye, href: '/expo' as Route, roles: ['OWNER', 'MANAGER', 'KITCHEN_STAFF'], group: 'Kitchen', mobileOrder: 1 },

  { label: 'Payment review', icon: CreditCard, href: '/payments', roles: ['OWNER'], group: 'Money', mobileOrder: 3 },
  { label: 'My cash shift', icon: Wallet, href: '/shifts', roles: ['OWNER', 'MANAGER', 'CASHIER'], group: 'Money' },
  { label: 'Day close', icon: CalendarCheck, href: '/day-close' as Route, roles: ['OWNER', 'MANAGER'], group: 'Money' },
  { label: 'Reports', icon: BarChart3, href: '/reports', roles: ['OWNER', 'MANAGER'], group: 'Money' },

  { label: 'Menu', icon: Utensils, href: '/menu', roles: ['OWNER', 'MANAGER'], group: 'Manage' },
  { label: 'Inventory', icon: Package, href: '/inventory', roles: ['OWNER', 'MANAGER'], group: 'Manage' },
  { label: 'Kitchen config', icon: Coffee, href: '/kitchen/config' as Route, roles: ['OWNER', 'MANAGER'], group: 'Manage' },
  { label: 'Team & branches', icon: Users, href: '/team', roles: ['OWNER', 'MANAGER'], group: 'Manage' },
  { label: 'Settings', icon: Settings, href: '/settings', roles: ['OWNER', 'MANAGER'], group: 'Manage' },

  { label: 'Platform', icon: Shield, href: '/platform', roles: ['SUPER_ADMIN'], group: 'Platform' },
  { label: 'Feature control', icon: ToggleLeft, href: '/platform/features', roles: ['SUPER_ADMIN'], group: 'Platform' },
] as const;

export const roleLabels: Record<AppRole, string> = {
  OWNER: 'Owner',
  MANAGER: 'Manager',
  CASHIER: 'Cashier',
  KITCHEN_STAFF: 'Kitchen staff',
  WAITER: 'Waiter',
  SUPER_ADMIN: 'Super admin',
};

function byMobileOrder(a: NavItem, b: NavItem): number {
  return (a.mobileOrder ?? 99) - (b.mobileOrder ?? 99);
}

/**
 * The four items shown in the mobile bottom bar, ordered by mobileOrder.
 */
export function primaryMobileNav(items: readonly NavItem[]): NavItem[] {
  return [...items].sort(byMobileOrder).slice(0, 4);
}

/**
 * Everything NOT in the mobile bottom bar, same ordering.
 * Uses the same sort as primaryMobileNav so the two sets are exact complements.
 */
export function moreMobileNav(items: readonly NavItem[]): NavItem[] {
  return [...items].sort(byMobileOrder).slice(4);
}

function longestMatch(pathname: string, items: readonly NavItem[]): string | null {
  let best: string | null = null;
  for (const item of items) {
    const href = item.href as string;
    if (pathname === href || pathname.startsWith(`${href}/`)) {
      if (best === null || href.length > best.length) best = href;
    }
  }
  return best;
}

/**
 * Returns the single nav item that should be highlighted for this view.
 * The longest matching href wins (so /kitchen/config highlights only
 * "Kitchen config", never also "Kitchen display"). If the exact item is
 * not shown in this view (e.g. mobile primary bar), the nearest visible
 * ancestor is highlighted instead.
 */
export function activeNavHrefs(
  pathname: string,
  fullItems: readonly NavItem[],
  viewItems: readonly NavItem[],
): ReadonlySet<string> {
  const activeHref = longestMatch(pathname, fullItems);
  if (activeHref === null) return new Set<string>();
  const exact = viewItems.find((item) => (item.href as string) === activeHref);
  if (exact) return new Set<string>([exact.href]);
  let ancestor: string | null = null;
  for (const item of viewItems) {
    const href = item.href as string;
    if (activeHref.startsWith(`${href}/`) && (ancestor === null || href.length > ancestor.length)) {
      ancestor = href;
    }
  }
  return ancestor === null ? new Set<string>() : new Set<string>([ancestor]);
}
