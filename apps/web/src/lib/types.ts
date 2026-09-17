export type OrderStatus = 'PENDING_VERIFICATION' | 'CONFIRMED' | 'IN_PROGRESS' | 'READY';

export interface BranchSummary { id: string; name: string; location: string; }
export interface DashboardMetric { label: string; value: string; detail: string; direction: 'up' | 'neutral' | 'attention'; }
export interface RecentOrder { id: string; number: string; customer: string; type: 'Dine-in' | 'Pickup' | 'POS'; amountMinor: number; itemCount: number; status: OrderStatus; time: string; }
export interface PopularItem { id: string; name: string; category: string; sold: number; revenueMinor: number; color: string; }
export interface DashboardData { restaurantName: string; branches: BranchSummary[]; activeBranchId: string; metrics: DashboardMetric[]; recentOrders: RecentOrder[]; popularItems: PopularItem[]; }

export interface MenuCategory { id: string; name: string; }
export interface MenuItem { id: string; name: string; description: string; categoryId: string; priceMinor: number; available: boolean; badge?: string; initials: string; tone: string; }
export interface CartLine { item: MenuItem; quantity: number; note?: string; }
export interface MenuData { categories: MenuCategory[]; items: MenuItem[]; }

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

export type FeatureKey = 'TABLE_QR_ORDERING' | 'PICKUP_ORDERING' | 'MANUAL_TRANSFER_PAYMENTS' | 'PAYMENT_GATEWAY' | 'KDS' | 'INVENTORY' | 'BATCH_INVENTORY' | 'ANALYTICS' | 'MULTI_BRANCH';
export type EntitlementState = 'ENABLED' | 'DISABLED' | 'TRIAL' | 'SUSPENDED';
export type BranchOverride = 'INHERIT' | 'ENABLED' | 'DISABLED';

export interface FeatureDefinition {
  key: FeatureKey;
  name: string;
  description: string;
  category: 'Ordering' | 'Payments' | 'Operations' | 'Growth';
  dependencies: FeatureKey[];
  branchConfigurable: boolean;
}

export interface TenantFeatureControl {
  featureKey: FeatureKey;
  entitlement: EntitlementState;
  tenantEnabled: boolean;
  branchOverride: BranchOverride;
  trialEndsAt?: string;
  updatedAt: string;
  updatedBy: string;
}
