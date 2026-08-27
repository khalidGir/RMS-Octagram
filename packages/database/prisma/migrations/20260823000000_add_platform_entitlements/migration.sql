-- CreateTenantEntitlement
CREATE TABLE "TenantEntitlement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ENABLED',
    "trialEndsAt" TIMESTAMP(3),
    "updatedByUserId" TEXT,
    "notes" TEXT,
    "reason" TEXT,
    "internalNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex for TenantEntitlement
CREATE UNIQUE INDEX "TenantEntitlement_tenantId_featureKey_key" ON "TenantEntitlement"("tenantId", "featureKey");
CREATE INDEX "TenantEntitlement_tenantId_idx" ON "TenantEntitlement"("tenantId");

-- AddForeignKey for TenantEntitlement
ALTER TABLE "TenantEntitlement" ADD CONSTRAINT "TenantEntitlement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Create partial unique indexes for FeatureSetting
-- These prevent duplicate rows when branchId is NULL (tenant-level) or NOT NULL (branch-level)
CREATE UNIQUE INDEX "FeatureSetting_tenant_unique"
ON "FeatureSetting" ("tenantId", "featureKey")
WHERE "branchId" IS NULL;

CREATE UNIQUE INDEX "FeatureSetting_branch_unique"
ON "FeatureSetting" ("tenantId", "branchId", "featureKey")
WHERE "branchId" IS NOT NULL;

-- Backfill: create ENABLED entitlements for all existing tenants for all 9 features
INSERT INTO "TenantEntitlement" ("id", "tenantId", "featureKey", "status", "createdAt", "updatedAt")
SELECT
    gen_random_uuid(),
    t."id",
    f.feature_key,
    'ENABLED',
    NOW(),
    NOW()
FROM "Tenant" t
CROSS JOIN (VALUES
    ('TABLE_QR_ORDERING'),
    ('PICKUP_ORDERING'),
    ('MANUAL_TRANSFER_PAYMENTS'),
    ('PAYMENT_GATEWAY'),
    ('KDS'),
    ('INVENTORY'),
    ('BATCH_INVENTORY'),
    ('ANALYTICS'),
    ('MULTI_BRANCH')
) AS f(feature_key);

-- Backfill: create tenant-level enabled FeatureSetting rows for all 9 features
-- Only insert where no row already exists (preserve existing settings)
-- Uses the OWNER membership's userId as updatedByUserId
INSERT INTO "FeatureSetting" ("id", "tenantId", "branchId", "featureKey", "enabled", "configuration", "updatedByUserId", "createdAt", "updatedAt")
SELECT
    gen_random_uuid(),
    t."id",
    NULL,
    f.feature_key,
    TRUE,
    NULL,
    COALESCE(owner."userId", 'system-migration'),
    NOW(),
    NOW()
FROM "Tenant" t
CROSS JOIN (VALUES
    ('TABLE_QR_ORDERING'),
    ('PICKUP_ORDERING'),
    ('MANUAL_TRANSFER_PAYMENTS'),
    ('PAYMENT_GATEWAY'),
    ('KDS'),
    ('INVENTORY'),
    ('BATCH_INVENTORY'),
    ('ANALYTICS'),
    ('MULTI_BRANCH')
) AS f(feature_key)
LEFT JOIN "TenantMembership" owner ON owner."tenantId" = t."id" AND owner."role" = 'OWNER'
WHERE NOT EXISTS (
    SELECT 1 FROM "FeatureSetting" fs
    WHERE fs."tenantId" = t."id"
    AND fs."branchId" IS NULL
    AND fs."featureKey" = f.feature_key
);
