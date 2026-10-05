-- =====================================================
-- Phase 3A: Order Infrastructure
-- =====================================================

-- 1. BranchOrderCounter: atomic order number generation
CREATE TABLE "BranchOrderCounter" (
    "branchId"   TEXT NOT NULL,
    "lastNumber" BIGINT NOT NULL DEFAULT 0,
    "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "BranchOrderCounter_pkey" PRIMARY KEY ("branchId")
);

-- FK to Branch
ALTER TABLE "BranchOrderCounter"
    ADD CONSTRAINT "BranchOrderCounter_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. StationTicketCounter: atomic ticket number generation
CREATE TABLE "StationTicketCounter" (
    "branchId"   TEXT NOT NULL,
    "stationId"  TEXT NOT NULL,
    "lastNumber" BIGINT NOT NULL DEFAULT 0,
    "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "StationTicketCounter_pkey" PRIMARY KEY ("branchId", "stationId")
);

-- FK to Branch and KitchenStation
ALTER TABLE "StationTicketCounter"
    ADD CONSTRAINT "StationTicketCounter_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StationTicketCounter"
    ADD CONSTRAINT "StationTicketCounter_stationId_fkey"
    FOREIGN KEY ("stationId") REFERENCES "KitchenStation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. Unique tracking token hash (where non-null)
CREATE UNIQUE INDEX "Order_trackingTokenHash_unique"
    ON "Order" ("trackingTokenHash")
    WHERE "trackingTokenHash" IS NOT NULL;

-- 4. Active recipe per branch/variant (not global)
CREATE UNIQUE INDEX "Recipe_active_branch_variant_unique"
    ON "Recipe" ("branchId", "menuItemVariantId")
    WHERE "isActive" = true;

-- 5. Quantity constraints
ALTER TABLE "OrderLine"
    ADD CONSTRAINT "OrderLine_quantity_positive"
    CHECK ("quantity" > 0);

ALTER TABLE "OrderLineModifier"
    ADD CONSTRAINT "OrderLineModifier_quantity_positive"
    CHECK ("quantity" > 0);

-- 6. Idempotency: branch-scoped uniqueness
-- Drop existing unique constraint
ALTER TABLE "IdempotencyRecord"
    DROP CONSTRAINT IF EXISTS "IdempotencyRecord_tenantId_operation_key_key";

-- Branch-scoped operations (branchId IS NOT NULL)
CREATE UNIQUE INDEX "IdempotencyRecord_branchScoped_unique"
    ON "IdempotencyRecord" ("tenantId", "branchId", "operation", "key")
    WHERE "branchId" IS NOT NULL;

-- Tenant-scoped operations (branchId IS NULL)
CREATE UNIQUE INDEX "IdempotencyRecord_tenantScoped_unique"
    ON "IdempotencyRecord" ("tenantId", "operation", "key")
    WHERE "branchId" IS NULL;
