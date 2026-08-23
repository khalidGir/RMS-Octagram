import { PrismaClient } from '@prisma/client';

const ALL_FEATURE_KEYS = [
  'TABLE_QR_ORDERING',
  'PICKUP_ORDERING',
  'MANUAL_TRANSFER_PAYMENTS',
  'PAYMENT_GATEWAY',
  'KDS',
  'INVENTORY',
  'BATCH_INVENTORY',
  'ANALYTICS',
  'MULTI_BRANCH',
];

const DEFAULT_ENABLED_FEATURES = [
  'TABLE_QR_ORDERING',
  'PICKUP_ORDERING',
  'MANUAL_TRANSFER_PAYMENTS',
  'KDS',
  'INVENTORY',
  'MULTI_BRANCH',
];

/**
 * Seed TenantEntitlement rows for a test tenant.
 * This mirrors what TenancyService.createTenant() does transactionally.
 * Call this after creating a tenant directly via Prisma in E2E test setup.
 */
export async function seedEntitlements(
  prisma: PrismaClient,
  tenantId: string,
  userId?: string,
): Promise<void> {
  for (const key of ALL_FEATURE_KEYS) {
    await prisma.tenantEntitlement.create({
      data: {
        tenantId,
        featureKey: key,
        status: DEFAULT_ENABLED_FEATURES.includes(key) ? 'ENABLED' : 'DISABLED',
      },
    });
  }

  if (userId) {
    for (const key of DEFAULT_ENABLED_FEATURES) {
      await prisma.featureSetting.deleteMany({
        where: { tenantId, branchId: null, featureKey: key },
      });
      await prisma.featureSetting.create({
        data: {
          tenantId,
          branchId: null,
          featureKey: key,
          enabled: true,
          updatedByUserId: userId,
        },
      });
    }
  }
}

/**
 * Clean up entitlements for a tenant.
 * Use in afterAll to avoid unique constraint violations on re-run.
 */
export async function cleanupEntitlements(
  prisma: PrismaClient,
  tenantId: string,
): Promise<void> {
  await prisma.tenantEntitlement.deleteMany({ where: { tenantId } }).catch(() => {});
}
