import { FeatureKey } from '@rms/contracts';

export interface FeatureDefinition {
  key: FeatureKey;
  name: string;
  description: string;
  dependencies: FeatureKey[];
}

export const FEATURE_CATALOG: FeatureDefinition[] = [
  { key: FeatureKey.TABLE_QR_ORDERING, name: 'Table QR Ordering', description: 'Customers scan QR codes at tables to place orders', dependencies: [] },
  { key: FeatureKey.PICKUP_ORDERING, name: 'Pickup Ordering', description: 'Customers place orders for pickup', dependencies: [] },
  { key: FeatureKey.MANUAL_TRANSFER_PAYMENTS, name: 'Manual Transfer Payments', description: 'Accept bank/mobile transfer payments with proof upload', dependencies: [] },
  { key: FeatureKey.PAYMENT_GATEWAY, name: 'Payment Gateway', description: 'Accept online payments via integrated gateway', dependencies: [] },
  { key: FeatureKey.KDS, name: 'Kitchen Display System', description: 'Digital kitchen ticket management', dependencies: [] },
  { key: FeatureKey.INVENTORY, name: 'Inventory', description: 'Track ingredient stock levels', dependencies: [] },
  { key: FeatureKey.BATCH_INVENTORY, name: 'Batch Inventory', description: 'Batch receive and manage inventory items', dependencies: [FeatureKey.INVENTORY] },
  { key: FeatureKey.ANALYTICS, name: 'Analytics', description: 'Sales and operational analytics dashboards', dependencies: [] },
  { key: FeatureKey.MULTI_BRANCH, name: 'Multi-Branch', description: 'Manage multiple branches under one tenant', dependencies: [] },
];

export const DEFAULT_NEW_TENANT_FEATURES: FeatureKey[] = [
  FeatureKey.TABLE_QR_ORDERING,
  FeatureKey.MANUAL_TRANSFER_PAYMENTS,
  FeatureKey.KDS,
  FeatureKey.INVENTORY,
  FeatureKey.MULTI_BRANCH,
];

export function getFeatureDefinition(key: FeatureKey): FeatureDefinition | undefined {
  return FEATURE_CATALOG.find((f) => f.key === key);
}

export function getAllFeatureKeys(): FeatureKey[] {
  return FEATURE_CATALOG.map((f) => f.key);
}
