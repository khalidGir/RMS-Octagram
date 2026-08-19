export type OrderStatus = 'PENDING_VERIFICATION' | 'CONFIRMED' | 'IN_PROGRESS' | 'READY';

export interface BranchSummary { id: string; name: string; location: string; }
export interface DashboardMetric { label: string; value: string; detail: string; direction: 'up' | 'neutral' | 'attention'; }
export interface RecentOrder { id: string; number: string; customer: string; type: 'Dine-in' | 'Pickup' | 'POS'; amountMinor: number; itemCount: number; status: OrderStatus; time: string; }
export interface PopularItem { id: string; name: string; category: string; sold: number; revenueMinor: number; color: string; }
export interface DashboardData { restaurantName: string; branches: BranchSummary[]; activeBranchId: string; metrics: DashboardMetric[]; recentOrders: RecentOrder[]; popularItems: PopularItem[]; }

export interface TenantTheme {
  logoUrl?: string;
  compactLogoUrl?: string;
  primaryColor: string;
  accentColor: string;
  storefrontMode: 'light' | 'dark';
  radius: 'square' | 'soft' | 'rounded';
  fontFamily: 'inter' | 'manrope' | 'source-sans';
  coverImageUrl?: string;
}
