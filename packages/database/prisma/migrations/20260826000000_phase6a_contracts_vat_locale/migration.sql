-- Phase 6A: Contracts, VAT configuration, and localization
-- All additive — safe for populated databases

-- 1. Add default locale to Tenant
ALTER TABLE "Tenant" ADD COLUMN "defaultLocale" TEXT NOT NULL DEFAULT 'en';

-- 2. Add preferred locale to TenantMembership
ALTER TABLE "TenantMembership" ADD COLUMN "preferredLocale" TEXT;

-- 3. Add tax snapshot columns to Order
ALTER TABLE "Order" ADD COLUMN "taxConfigVersionId" TEXT;
ALTER TABLE "Order" ADD COLUMN "vatRateSnapshot" DECIMAL(9,6);

-- 4. Create TenantTaxConfiguration table
CREATE TABLE "TenantTaxConfiguration" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT,
    "vatApplicable" BOOLEAN NOT NULL DEFAULT false,
    "vatRate" DECIMAL(9,6) NOT NULL DEFAULT 0,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveUntil" TIMESTAMP(3),
    "confirmedBy" TEXT,
    "confirmationNote" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantTaxConfiguration_pkey" PRIMARY KEY ("id")
);

-- 5. Create MenuItemTranslation table
CREATE TABLE "MenuItemTranslation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuItemTranslation_pkey" PRIMARY KEY ("id")
);

-- 6. Add foreign keys
ALTER TABLE "TenantTaxConfiguration" ADD CONSTRAINT "TenantTaxConfiguration_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TenantTaxConfiguration" ADD CONSTRAINT "TenantTaxConfiguration_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MenuItemTranslation" ADD CONSTRAINT "MenuItemTranslation_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MenuItemTranslation" ADD CONSTRAINT "MenuItemTranslation_menuItemId_fkey"
    FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 7. Add indexes
CREATE INDEX "TenantTaxConfiguration_tenantId_branchId_effectiveFrom_idx"
    ON "TenantTaxConfiguration"("tenantId", "branchId", "effectiveFrom");

CREATE UNIQUE INDEX "MenuItemTranslation_tenantId_menuItemId_locale_key"
    ON "MenuItemTranslation"("tenantId", "menuItemId", "locale");

CREATE INDEX "MenuItemTranslation_tenantId_menuItemId_idx"
    ON "MenuItemTranslation"("tenantId", "menuItemId");
