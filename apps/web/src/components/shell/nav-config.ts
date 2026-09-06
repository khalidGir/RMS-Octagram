import type { AppRole } from '@/components/staff-shell';
import type { Route } from 'next';

import {
  LayoutDashboard, ShoppingCart, ClipboardList, CreditCard, ChefHat, UtensilsCrossed,
  Grid3x3, Wallet, Utensils, Package, BarChart3, Users, Settings, Shield, ToggleLeft,
} from 'lucide-react';

export type NavItem = {
  label: string;
  icon: typeof LayoutDashboard;
  href: Route;
  roles: readonly AppRole[];
  mobileOrder?: number;
};

export const navItems: NavItem[] = [
  { label: 'Overview', icon: LayoutDashboard, href: '/dashboard', roles: ['OWNER', 'MANAGER'], mobileOrder: 0 },
  { label: 'Point of sale', icon: ShoppingCart, href: '/pos', roles: ['OWNER', 'MANAGER', 'CASHIER'], mobileOrder: 1 },
  { label: 'Orders', icon: ClipboardList, href: '/orders', roles: ['OWNER', 'MANAGER', 'CASHIER'], mobileOrder: 2 },
  { label: 'Kitchen display', icon: ChefHat, href: '/kitchen', roles: ['OWNER', 'MANAGER', 'KITCHEN_STAFF'], mobileOrder: 1 },
  { label: 'Waiter workspace', icon: UtensilsCrossed, href: '/waiter', roles: ['WAITER'], mobileOrder: 1 },
  { label: 'Payment review', icon: CreditCard, href: '/payments', roles: ['OWNER'], mobileOrder: 3 },
  { label: 'Tables & QR', icon: Grid3x3, href: '/tables', roles: ['OWNER', 'MANAGER'] },
  { label: 'My cash shift', icon: Wallet, href: '/shifts', roles: ['OWNER', 'MANAGER', 'CASHIER'] },
  { label: 'Menu', icon: Utensils, href: '/menu', roles: ['OWNER', 'MANAGER'] },
  { label: 'Inventory', icon: Package, href: '/inventory', roles: ['OWNER', 'MANAGER'] },
  { label: 'Reports', icon: BarChart3, href: '/reports', roles: ['OWNER', 'MANAGER'] },
  { label: 'Team & branches', icon: Users, href: '/team', roles: ['OWNER', 'MANAGER'] },
  { label: 'Settings', icon: Settings, href: '/settings', roles: ['OWNER', 'MANAGER'] },
  { label: 'Platform', icon: Shield, href: '/platform', roles: ['SUPER_ADMIN'] },
  { label: 'Feature control', icon: ToggleLeft, href: '/platform/features', roles: ['SUPER_ADMIN'] },
] as const;

export const roleLabels: Record<AppRole, string> = {
  OWNER: 'Owner',
  MANAGER: 'Manager',
  CASHIER: 'Cashier',
  KITCHEN_STAFF: 'Kitchen staff',
  WAITER: 'Waiter',
  SUPER_ADMIN: 'Super admin',
};
