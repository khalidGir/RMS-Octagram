-- Multi-Kitchen Fulfillment Migration
-- Phase MK-1 (hardened): Additive schema changes (expand phase)
-- All changes are backward-compatible; no columns are made non-null or dropped.

-- ============================================================
-- 1. New table: Kitchen
-- ============================================================
CREATE TABLE "Kitchen" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "collectionLabel" TEXT,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "Kitchen_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Kitchen_branchId_name_key" ON "Kitchen"("branchId", "name");
CREATE INDEX "Kitchen_tenantId_branchId_isActive_idx" ON "Kitchen"("tenantId", "branchId", "isActive");

-- ============================================================
-- 2. Extend KitchenStation
-- ============================================================
ALTER TABLE "KitchenStation" ADD COLUMN "kitchenId" TEXT;
ALTER TABLE "KitchenStation" ADD COLUMN "code" TEXT;
ALTER TABLE "KitchenStation" ADD COLUMN "defaultPrepMinutes" INTEGER;
ALTER TABLE "KitchenStation" ADD COLUMN "isExpo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "KitchenStation" ADD COLUMN "collectionLabelOverride" TEXT;

CREATE UNIQUE INDEX "KitchenStation_branchId_code_key" ON "KitchenStation"("branchId", "code") WHERE "code" IS NOT NULL;
CREATE INDEX "KitchenStation_tenantId_branchId_kitchenId_idx" ON "KitchenStation"("tenantId", "branchId", "kitchenId");

-- FIX 5: One active expo station per branch (partial unique index)
CREATE UNIQUE INDEX "KitchenStation_oneExpoPerBranch_idx"
  ON "KitchenStation"("branchId")
  WHERE "isExpo" = true AND "isActive" = true;

ALTER TABLE "KitchenStation" ADD CONSTRAINT "KitchenStation_kitchenId_fkey"
  FOREIGN KEY ("kitchenId") REFERENCES "Kitchen"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- 3. Extend MenuItemStation
-- ============================================================
-- FIX 6: PK now includes routeType to allow PREPARE+ASSEMBLE on same item/station
ALTER TABLE "MenuItemStation" ADD COLUMN "routeType" TEXT NOT NULL DEFAULT 'PREPARE';
ALTER TABLE "MenuItemStation" ADD COLUMN "isRequired" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "MenuItemStation" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MenuItemStation" ADD COLUMN "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now();
ALTER TABLE "MenuItemStation" ADD COLUMN "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now();

-- ============================================================
-- 4. Extend KitchenTicket
-- ============================================================
ALTER TABLE "KitchenTicket" ADD COLUMN "kitchenId" TEXT;
ALTER TABLE "KitchenTicket" ADD COLUMN "ticketType" TEXT NOT NULL DEFAULT 'PREPARATION';
ALTER TABLE "KitchenTicket" ADD COLUMN "collectionLabelSnapshot" TEXT;
ALTER TABLE "KitchenTicket" ADD COLUMN "releasedAt" TIMESTAMPTZ(6);
ALTER TABLE "KitchenTicket" ADD COLUMN "releasedByUserId" TEXT;
ALTER TABLE "KitchenTicket" ADD COLUMN "collectedAt" TIMESTAMPTZ(6);
ALTER TABLE "KitchenTicket" ADD COLUMN "collectedByUserId" TEXT;
ALTER TABLE "KitchenTicket" ADD COLUMN "lastRecalledAt" TIMESTAMPTZ(6);

CREATE INDEX "KitchenTicket_tenantId_branchId_kitchenId_status_idx" ON "KitchenTicket"("tenantId", "branchId", "kitchenId", "status");

ALTER TABLE "KitchenTicket" ADD CONSTRAINT "KitchenTicket_kitchenId_fkey"
  FOREIGN KEY ("kitchenId") REFERENCES "Kitchen"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- 5. Extend KitchenTicketLine
-- ============================================================
ALTER TABLE "KitchenTicketLine" ADD COLUMN "routeType" TEXT NOT NULL DEFAULT 'PREPARE';
ALTER TABLE "KitchenTicketLine" ADD COLUMN "isRequired" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "KitchenTicketLine" ADD COLUMN "quantityPrepared" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "KitchenTicketLine" ADD COLUMN "quantityReady" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "KitchenTicketLine" ADD COLUMN "quantityCollected" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "KitchenTicketLine" ADD COLUMN "quantityServed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "KitchenTicketLine" ADD COLUMN "itemNameSnapshot" TEXT;
ALTER TABLE "KitchenTicketLine" ADD COLUMN "variantNameSnapshot" TEXT;
ALTER TABLE "KitchenTicketLine" ADD COLUMN "notesSnapshot" TEXT;
ALTER TABLE "KitchenTicketLine" ADD COLUMN "readyAt" TIMESTAMPTZ(6);
ALTER TABLE "KitchenTicketLine" ADD COLUMN "collectedAt" TIMESTAMPTZ(6);
ALTER TABLE "KitchenTicketLine" ADD COLUMN "servedAt" TIMESTAMPTZ(6);
ALTER TABLE "KitchenTicketLine" ADD COLUMN "cancelledAt" TIMESTAMPTZ(6);
ALTER TABLE "KitchenTicketLine" ADD COLUMN "cancelReason" TEXT;
ALTER TABLE "KitchenTicketLine" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX "KitchenTicketLine_tenantId_branchId_orderLineId_idx" ON "KitchenTicketLine"("tenantId", "branchId", "orderLineId");

-- FIX 7: Numeric constraints on KitchenTicketLine
ALTER TABLE "KitchenTicketLine" ADD CONSTRAINT "KitchenTicketLine_quantity_nonneg"
  CHECK ("quantity" >= 0);
ALTER TABLE "KitchenTicketLine" ADD CONSTRAINT "KitchenTicketLine_quantityPrepared_nonneg"
  CHECK ("quantityPrepared" >= 0);
ALTER TABLE "KitchenTicketLine" ADD CONSTRAINT "KitchenTicketLine_quantityReady_nonneg"
  CHECK ("quantityReady" >= 0);
ALTER TABLE "KitchenTicketLine" ADD CONSTRAINT "KitchenTicketLine_quantityCollected_nonneg"
  CHECK ("quantityCollected" >= 0);
ALTER TABLE "KitchenTicketLine" ADD CONSTRAINT "KitchenTicketLine_quantityCollected_lte_quantity"
  CHECK ("quantityCollected" <= "quantity");
ALTER TABLE "KitchenTicketLine" ADD CONSTRAINT "KitchenTicketLine_quantityServed_nonneg"
  CHECK ("quantityServed" >= 0);
ALTER TABLE "KitchenTicketLine" ADD CONSTRAINT "KitchenTicketLine_quantityServed_lte_quantity"
  CHECK ("quantityServed" <= "quantity");

-- ============================================================
-- 6. Extend Order
-- ============================================================
ALTER TABLE "Order" ADD COLUMN "fulfillmentStatus" TEXT NOT NULL DEFAULT 'NOT_ROUTED';
ALTER TABLE "Order" ADD COLUMN "assignedWaiterUserId" TEXT;
ALTER TABLE "Order" ADD COLUMN "expoReleasedAt" TIMESTAMPTZ(6);
ALTER TABLE "Order" ADD COLUMN "expoReleasedByUserId" TEXT;
ALTER TABLE "Order" ADD COLUMN "readyForServiceAt" TIMESTAMPTZ(6);
ALTER TABLE "Order" ADD COLUMN "servedAt" TIMESTAMPTZ(6);

CREATE INDEX "Order_tenantId_branchId_fulfillmentStatus_createdAt_idx" ON "Order"("tenantId", "branchId", "fulfillmentStatus", "createdAt" DESC);
CREATE INDEX "Order_tenantId_branchId_assignedWaiterUserId_fulfillmentStatus_idx" ON "Order"("tenantId", "branchId", "assignedWaiterUserId", "fulfillmentStatus");

-- FIX 3: FK for Order.assignedWaiterUserId
ALTER TABLE "Order" ADD CONSTRAINT "Order_assignedWaiterUserId_fkey"
  FOREIGN KEY ("assignedWaiterUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- 7. Extend DiningSession
-- ============================================================
ALTER TABLE "DiningSession" ADD COLUMN "assignedWaiterUserId" TEXT;
ALTER TABLE "DiningSession" ADD COLUMN "assignedAt" TIMESTAMPTZ(6);
ALTER TABLE "DiningSession" ADD COLUMN "assignedByUserId" TEXT;

CREATE INDEX "DiningSession_tenantId_branchId_assignedWaiterUserId_idx" ON "DiningSession"("tenantId", "branchId", "assignedWaiterUserId");

-- FIX 3: FK for DiningSession.assignedWaiterUserId
ALTER TABLE "DiningSession" ADD CONSTRAINT "DiningSession_assignedWaiterUserId_fkey"
  FOREIGN KEY ("assignedWaiterUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- 8. New table: KdsDevice
-- ============================================================
CREATE TABLE "KdsDevice" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "deviceTokenHash" TEXT,
  "lastSeenAt" TIMESTAMPTZ(6),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "KdsDevice_pkey" PRIMARY KEY ("id")
);
-- FIX 4: Unique index on deviceTokenHash for constant-time lookup and safe rotation
CREATE UNIQUE INDEX "KdsDevice_deviceTokenHash_key" ON "KdsDevice"("deviceTokenHash") WHERE "deviceTokenHash" IS NOT NULL;
CREATE INDEX "KdsDevice_tenantId_branchId_idx" ON "KdsDevice"("tenantId", "branchId");
CREATE INDEX "KdsDevice_tenantId_branchId_isActive_idx" ON "KdsDevice"("tenantId", "branchId", "isActive");

-- ============================================================
-- 9. New table: KdsDeviceStation
-- ============================================================
CREATE TABLE "KdsDeviceStation" (
  "tenantId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "stationId" TEXT NOT NULL,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "KdsDeviceStation_pkey" PRIMARY KEY ("deviceId", "stationId")
);
CREATE INDEX "KdsDeviceStation_tenantId_branchId_stationId_idx" ON "KdsDeviceStation"("tenantId", "branchId", "stationId");

ALTER TABLE "KdsDeviceStation" ADD CONSTRAINT "KdsDeviceStation_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "KdsDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KdsDeviceStation" ADD CONSTRAINT "KdsDeviceStation_stationId_fkey"
  FOREIGN KEY ("stationId") REFERENCES "KitchenStation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- 10. New table: ServiceNotification
-- ============================================================
CREATE TABLE "ServiceNotification" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "ticketId" TEXT,
  "assignedUserId" TEXT,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'UNREAD',
  "collectionLabelSnapshot" TEXT,
  "dedupeKey" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "acknowledgedAt" TIMESTAMPTZ(6),
  "resolvedAt" TIMESTAMPTZ(6),

  CONSTRAINT "ServiceNotification_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ServiceNotification_dedupeKey_key" ON "ServiceNotification"("dedupeKey");
CREATE INDEX "ServiceNotification_tenantId_branchId_assignedUserId_status_idx" ON "ServiceNotification"("tenantId", "branchId", "assignedUserId", "status");
CREATE INDEX "ServiceNotification_tenantId_branchId_orderId_idx" ON "ServiceNotification"("tenantId", "branchId", "orderId");
CREATE INDEX "ServiceNotification_tenantId_branchId_status_createdAt_idx" ON "ServiceNotification"("tenantId", "branchId", "status", "createdAt");

-- FIX 3: FK for ServiceNotification.orderId and ticketId
ALTER TABLE "ServiceNotification" ADD CONSTRAINT "ServiceNotification_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceNotification" ADD CONSTRAINT "ServiceNotification_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "KitchenTicket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- 11. New table: BranchFulfillmentPolicy
-- ============================================================
CREATE TABLE "BranchFulfillmentPolicy" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "serviceMode" TEXT NOT NULL DEFAULT 'ALL_AT_ONCE',
  "expoMode" TEXT NOT NULL DEFAULT 'NONE',
  "allowWaiterSelfClaim" BOOLEAN NOT NULL DEFAULT false,
  "showUnassignedReadyOrdersToWaiters" BOOLEAN NOT NULL DEFAULT false,
  "readyReminderSeconds" INTEGER,
  "readyEscalationSeconds" INTEGER,
  "autoCompleteKitchenTicketOnCollected" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "BranchFulfillmentPolicy_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BranchFulfillmentPolicy_branchId_key" ON "BranchFulfillmentPolicy"("branchId");
CREATE INDEX "BranchFulfillmentPolicy_tenantId_branchId_idx" ON "BranchFulfillmentPolicy"("tenantId", "branchId");

-- FIX 7: Numeric constraints on BranchFulfillmentPolicy
ALTER TABLE "BranchFulfillmentPolicy" ADD CONSTRAINT "BranchFulfillmentPolicy_readyReminderSeconds_nonneg"
  CHECK ("readyReminderSeconds" IS NULL OR "readyReminderSeconds" >= 0);
ALTER TABLE "BranchFulfillmentPolicy" ADD CONSTRAINT "BranchFulfillmentPolicy_readyEscalationSeconds_nonneg"
  CHECK ("readyEscalationSeconds" IS NULL OR "readyEscalationSeconds" >= 0);

-- FIX 3: FK for KitchenTicket.releasedByUserId and collectedByUserId
ALTER TABLE "KitchenTicket" ADD CONSTRAINT "KitchenTicket_releasedByUserId_fkey"
  FOREIGN KEY ("releasedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KitchenTicket" ADD CONSTRAINT "KitchenTicket_collectedByUserId_fkey"
  FOREIGN KEY ("collectedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- 12. Backfill: Create default Kitchen for ALL branches (not just those with stations)
-- ============================================================
INSERT INTO "Kitchen" ("id", "tenantId", "branchId", "name", "description", "displayOrder", "isActive", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  b."tenantId",
  b."id",
  'Main Kitchen',
  'Default kitchen',
  0,
  true,
  now(),
  now()
FROM "Branch" b
WHERE NOT EXISTS (
  SELECT 1 FROM "Kitchen" k WHERE k."branchId" = b."id"
);

-- ============================================================
-- 13. Backfill: Attach existing stations to their branch's default kitchen
-- ============================================================
UPDATE "KitchenStation" ks
SET "kitchenId" = k."id"
FROM "Kitchen" k
WHERE ks."kitchenId" IS NULL
  AND ks."branchId" = k."branchId"
  AND k."name" = 'Main Kitchen';

-- ============================================================
-- 14. Backfill: Snapshot KitchenTicket kitchenId from station's kitchen
-- ============================================================
UPDATE "KitchenTicket" kt
SET "kitchenId" = ks."kitchenId"
FROM "KitchenStation" ks
WHERE kt."kitchenId" IS NULL
  AND kt."stationId" = ks."id";

-- ============================================================
-- 15. Backfill: Set existing MenuItemStation routes as PREPARE
-- (already done by column default, but document intent)
-- ============================================================

-- ============================================================
-- 16. Backfill: Derive Order.fulfillmentStatus from existing tickets
-- FIX 1: Orders where ALL active tickets are READY -> READY_FOR_SERVICE
-- ============================================================
UPDATE "Order" o
SET "fulfillmentStatus" = CASE
  -- All non-cancelled tickets are READY or COMPLETED (and at least one exists) -> READY_FOR_SERVICE
  WHEN EXISTS (
    SELECT 1 FROM "KitchenTicket" kt
    WHERE kt."orderId" = o."id"
      AND kt."status" NOT IN ('CANCELLED')
  ) AND NOT EXISTS (
    SELECT 1 FROM "KitchenTicket" kt
    WHERE kt."orderId" = o."id"
      AND kt."status" NOT IN ('CANCELLED', 'READY', 'COMPLETED')
  ) THEN 'READY_FOR_SERVICE'
  -- At least one active ticket is READY, but others are still in progress -> PARTIALLY_READY
  WHEN EXISTS (
    SELECT 1 FROM "KitchenTicket" kt
    WHERE kt."orderId" = o."id"
      AND kt."status" = 'READY'
  ) AND EXISTS (
    SELECT 1 FROM "KitchenTicket" kt
    WHERE kt."orderId" = o."id"
      AND kt."status" NOT IN ('CANCELLED', 'READY', 'COMPLETED')
  ) THEN 'PARTIALLY_READY'
  -- Tickets exist but none are READY yet -> QUEUED
  WHEN EXISTS (
    SELECT 1 FROM "KitchenTicket" kt
    WHERE kt."orderId" = o."id"
  ) THEN 'QUEUED'
  ELSE 'NOT_ROUTED'
END
WHERE o."id" IN (
  SELECT DISTINCT kt."orderId" FROM "KitchenTicket" kt
);

-- ============================================================
-- 17. Backfill: Create default fulfillment policy for ALL branches
-- FIX 2: Every branch gets ALL_AT_ONCE / NONE
-- ============================================================
INSERT INTO "BranchFulfillmentPolicy" ("id", "tenantId", "branchId", "serviceMode", "expoMode", "allowWaiterSelfClaim", "showUnassignedReadyOrdersToWaiters", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  b."tenantId",
  b."id",
  'ALL_AT_ONCE',
  'NONE',
  false,
  false,
  now(),
  now()
FROM "Branch" b
WHERE NOT EXISTS (
  SELECT 1 FROM "BranchFulfillmentPolicy" p WHERE p."branchId" = b."id"
);

-- ============================================================
-- Rollback notes:
-- - DROP TABLE "ServiceNotification", "KdsDeviceStation", "KdsDevice", "BranchFulfillmentPolicy";
-- - ALTER TABLE "DiningSession" DROP CONSTRAINT "DiningSession_assignedWaiterUserId_fkey";
-- - ALTER TABLE "DiningSession" DROP COLUMN "assignedWaiterUserId", "assignedAt", "assignedByUserId";
-- - ALTER TABLE "Order" DROP CONSTRAINT "Order_assignedWaiterUserId_fkey";
-- - ALTER TABLE "Order" DROP COLUMN "fulfillmentStatus", "assignedWaiterUserId", "expoReleasedAt", "expoReleasedByUserId", "readyForServiceAt", "servedAt";
-- - ALTER TABLE "KitchenTicket" DROP CONSTRAINT "KitchenTicket_releasedByUserId_fkey", "KitchenTicket_collectedByUserId_fkey", "KitchenTicket_kitchenId_fkey";
-- - ALTER TABLE "KitchenTicket" DROP COLUMN "kitchenId", "ticketType", "collectionLabelSnapshot", "releasedAt", "releasedByUserId", "collectedAt", "collectedByUserId", "lastRecalledAt";
-- - ALTER TABLE "KitchenTicketLine" DROP CONSTRAINT "KitchenTicketLine_quantity_nonneg", "KitchenTicketLine_quantityPrepared_nonneg", "KitchenTicketLine_quantityReady_nonneg", "KitchenTicketLine_quantityCollected_nonneg", "KitchenTicketLine_quantityCollected_lte_quantity", "KitchenTicketLine_quantityServed_nonneg", "KitchenTicketLine_quantityServed_lte_quantity";
-- - ALTER TABLE "KitchenTicketLine" DROP COLUMN "routeType", "isRequired", "quantityPrepared", "quantityReady", "quantityCollected", "quantityServed", "itemNameSnapshot", "variantNameSnapshot", "notesSnapshot", "readyAt", "collectedAt", "servedAt", "cancelledAt", "cancelReason", "version";
-- - ALTER TABLE "MenuItemStation" DROP COLUMN "routeType", "isRequired", "sortOrder", "createdAt", "updatedAt";
-- - ALTER TABLE "KitchenStation" DROP CONSTRAINT "KitchenStation_kitchenId_fkey";
-- - ALTER TABLE "KitchenStation" DROP COLUMN "kitchenId", "code", "defaultPrepMinutes", "isExpo", "collectionLabelOverride";
-- - DROP INDEX "KitchenStation_oneExpoPerBranch_idx";
-- - DROP TABLE "Kitchen";
-- Note: Backfill data (default Kitchen records, kitchenId attachments, fulfillment policies) can remain harmlessly.
