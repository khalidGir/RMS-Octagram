-- Multi-Kitchen Fulfillment Migration
-- Phase MK-1: Additive schema changes (expand phase)
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

ALTER TABLE "KitchenStation" ADD CONSTRAINT "KitchenStation_kitchenId_fkey"
  FOREIGN KEY ("kitchenId") REFERENCES "Kitchen"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- 3. Extend MenuItemStation
-- ============================================================
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

-- ============================================================
-- 7. Extend DiningSession
-- ============================================================
ALTER TABLE "DiningSession" ADD COLUMN "assignedWaiterUserId" TEXT;
ALTER TABLE "DiningSession" ADD COLUMN "assignedAt" TIMESTAMPTZ(6);
ALTER TABLE "DiningSession" ADD COLUMN "assignedByUserId" TEXT;

CREATE INDEX "DiningSession_tenantId_branchId_assignedWaiterUserId_idx" ON "DiningSession"("tenantId", "branchId", "assignedWaiterUserId");

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

ALTER TABLE "ServiceNotification" ADD CONSTRAINT "ServiceNotification_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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

-- ============================================================
-- 12. Backfill: Create default Kitchen for branches with stations
-- ============================================================
INSERT INTO "Kitchen" ("id", "tenantId", "branchId", "name", "description", "displayOrder", "isActive", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  ks."tenantId",
  ks."branchId",
  'Main Kitchen',
  'Default kitchen for existing stations',
  0,
  true,
  now(),
  now()
FROM "KitchenStation" ks
WHERE NOT EXISTS (
  SELECT 1 FROM "Kitchen" k WHERE k."branchId" = ks."branchId"
)
GROUP BY ks."tenantId", ks."branchId";

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
-- ============================================================
UPDATE "Order" o
SET "fulfillmentStatus" = CASE
  WHEN EXISTS (
    SELECT 1 FROM "KitchenTicket" kt
    WHERE kt."orderId" = o."id"
      AND kt."status" != 'CANCELLED'
      AND kt."status" != 'COMPLETED'
  ) AND EXISTS (
    SELECT 1 FROM "KitchenTicket" kt
    WHERE kt."orderId" = o."id"
      AND kt."status" = 'READY'
  ) THEN 'PARTIALLY_READY'
  WHEN NOT EXISTS (
    SELECT 1 FROM "KitchenTicket" kt
    WHERE kt."orderId" = o."id"
      AND kt."status" NOT IN ('CANCELLED', 'COMPLETED')
  ) AND EXISTS (
    SELECT 1 FROM "KitchenTicket" kt
    WHERE kt."orderId" = o."id"
      AND kt."status" = 'COMPLETED'
  ) THEN 'READY_FOR_SERVICE'
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
-- Rollback notes:
-- - DROP TABLE "ServiceNotification", "KdsDeviceStation", "KdsDevice", "BranchFulfillmentPolicy";
-- - ALTER TABLE "DiningSession" DROP COLUMN "assignedWaiterUserId", "assignedAt", "assignedByUserId";
-- - ALTER TABLE "Order" DROP COLUMN "fulfillmentStatus", "assignedWaiterUserId", "expoReleasedAt", "expoReleasedByUserId", "readyForServiceAt", "servedAt";
-- - ALTER TABLE "KitchenTicketLine" DROP COLUMN "routeType", "isRequired", "quantityPrepared", "quantityReady", "quantityCollected", "quantityServed", "itemNameSnapshot", "variantNameSnapshot", "notesSnapshot", "readyAt", "collectedAt", "servedAt", "cancelledAt", "cancelReason", "version";
-- - ALTER TABLE "KitchenTicket" DROP COLUMN "kitchenId", "ticketType", "collectionLabelSnapshot", "releasedAt", "releasedByUserId", "collectedAt", "collectedByUserId", "lastRecalledAt";
-- - ALTER TABLE "MenuItemStation" DROP COLUMN "routeType", "isRequired", "sortOrder", "createdAt", "updatedAt";
-- - ALTER TABLE "KitchenStation" DROP COLUMN "kitchenId", "code", "defaultPrepMinutes", "isExpo", "collectionLabelOverride";
-- - DROP TABLE "Kitchen";
-- Note: Backfill data (default Kitchen records, kitchenId attachments) can remain harmlessly.
