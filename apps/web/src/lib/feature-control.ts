import type { BranchOverride, EntitlementState, FeatureDefinition, FeatureKey, TenantFeatureControl } from './types';

export const featureCatalog: FeatureDefinition[] = [
  { key: 'TABLE_QR_ORDERING', name: 'Table QR ordering', description: 'Guests scan a table code and place dine-in orders.', category: 'Ordering', dependencies: [], branchConfigurable: true },
  { key: 'PICKUP_ORDERING', name: 'Pickup ordering', description: 'Customers submit scheduled orders before arriving.', category: 'Ordering', dependencies: [], branchConfigurable: true },
  { key: 'MANUAL_TRANSFER_PAYMENTS', name: 'Manual transfer payments', description: 'Accept transfer references and payment proof images.', category: 'Payments', dependencies: [], branchConfigurable: true },
  { key: 'PAYMENT_GATEWAY', name: 'Online payment gateway', description: 'Connect supported providers for automated checkout.', category: 'Payments', dependencies: [], branchConfigurable: true },
  { key: 'KDS', name: 'Kitchen display system', description: 'Route confirmed orders to live kitchen queues.', category: 'Operations', dependencies: [], branchConfigurable: true },
  { key: 'INVENTORY', name: 'Inventory tracking', description: 'Track stock, receipts, adjustments and consumption.', category: 'Operations', dependencies: [], branchConfigurable: true },
  { key: 'BATCH_INVENTORY', name: 'Batch inventory', description: 'Convert bulk stock into recipe-backed portions.', category: 'Operations', dependencies: ['INVENTORY'], branchConfigurable: true },
  { key: 'ANALYTICS', name: 'Analytics and reporting', description: 'Revenue, best sellers, peak hours and operational trends.', category: 'Growth', dependencies: [], branchConfigurable: false },
  { key: 'MULTI_BRANCH', name: 'Multi-branch management', description: 'Operate and compare more than one restaurant location.', category: 'Growth', dependencies: [], branchConfigurable: false },
];

export function entitlementAllowsUse(state: EntitlementState, trialEndsAt?: string): boolean {
  if (state === 'ENABLED') return true;
  return state === 'TRIAL' && Boolean(trialEndsAt) && new Date(trialEndsAt!).getTime() > Date.now();
}

function baseEnabled(key: FeatureKey, controls: TenantFeatureControl[]): boolean {
  const control = controls.find((item) => item.featureKey === key);
  return Boolean(control && entitlementAllowsUse(control.entitlement, control.trialEndsAt) && control.tenantEnabled && control.branchOverride !== 'DISABLED');
}

export function effectiveFeatureEnabled(control: TenantFeatureControl, controls: TenantFeatureControl[]): boolean {
  const definition = featureCatalog.find((item) => item.key === control.featureKey);
  return baseEnabled(control.featureKey, controls) && Boolean(definition && definition.dependencies.every((key) => baseEnabled(key, controls)));
}

export function dependencyBlockers(key: FeatureKey, controls: TenantFeatureControl[]): FeatureDefinition[] {
  const definition = featureCatalog.find((item) => item.key === key);
  return (definition?.dependencies ?? []).filter((dependency) => !baseEnabled(dependency, controls)).map((dependency) => featureCatalog.find((item) => item.key === dependency)!).filter(Boolean);
}

export function branchOverrideLabel(value: BranchOverride): string {
  return value === 'INHERIT' ? 'Follows tenant' : value === 'ENABLED' ? 'Enabled here' : 'Disabled here';
}
