ALTER TABLE "Order"
  ADD COLUMN "acceptedAt" TIMESTAMP(3),
  ADD COLUMN "acceptedByUserId" TEXT,
  ADD COLUMN "acceptancePolicySnapshot" TEXT,
  ADD COLUMN "acceptanceChannel" TEXT,
  ADD COLUMN "cancellationDisposition" TEXT,
  ADD COLUMN "cancellationReason" TEXT;

ALTER TABLE "BranchFulfillmentPolicy"
  ADD COLUMN "orderAcceptancePolicy" TEXT NOT NULL DEFAULT 'CASHIER_CONFIRMATION',
  ADD COLUMN "assistanceEscalationSeconds" INTEGER NOT NULL DEFAULT 180,
  ADD COLUMN "cashAtCounterEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "cashToWaiterEnabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "BranchFulfillmentPolicy"
  ADD CONSTRAINT "BranchFulfillmentPolicy_assistanceEscalationSeconds_check"
  CHECK ("assistanceEscalationSeconds" >= 30 AND "assistanceEscalationSeconds" <= 3600),
  ADD CONSTRAINT "BranchFulfillmentPolicy_orderAcceptancePolicy_check"
  CHECK ("orderAcceptancePolicy" IN ('AUTO_AFTER_PAYMENT', 'CASHIER_CONFIRMATION', 'WAITER_APPROVAL'));

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_acceptancePolicySnapshot_check"
  CHECK ("acceptancePolicySnapshot" IS NULL OR "acceptancePolicySnapshot" IN ('AUTO_AFTER_PAYMENT', 'CASHIER_CONFIRMATION', 'WAITER_APPROVAL')),
  ADD CONSTRAINT "Order_acceptanceChannel_check"
  CHECK ("acceptanceChannel" IS NULL OR "acceptanceChannel" IN ('ONLINE_PAYMENT', 'CASHIER', 'WAITER')),
  ADD CONSTRAINT "Order_cancellationDisposition_check"
  CHECK ("cancellationDisposition" IS NULL OR "cancellationDisposition" IN ('RESTOCK', 'WASTE', 'NO_ADJUSTMENT'));

CREATE TABLE "ServiceRequest" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "tableId" TEXT NOT NULL,
  "diningSessionId" TEXT NOT NULL,
  "orderId" TEXT,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "note" TEXT,
  "assignedWaiterUserId" TEXT,
  "claimedByUserId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimedAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "escalatedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServiceRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ServiceRequest_type_check" CHECK ("type" IN ('CALL_WAITER', 'REQUEST_BILL', 'OTHER_ASSISTANCE')),
  CONSTRAINT "ServiceRequest_status_check" CHECK ("status" IN ('OPEN', 'CLAIMED', 'RESOLVED', 'CANCELLED', 'ESCALATED')),
  CONSTRAINT "ServiceRequest_version_check" CHECK ("version" > 0)
);

CREATE UNIQUE INDEX "ServiceRequest_tenantId_branchId_idempotencyKey_key"
  ON "ServiceRequest"("tenantId", "branchId", "idempotencyKey");
CREATE INDEX "ServiceRequest_tenantId_branchId_status_createdAt_idx"
  ON "ServiceRequest"("tenantId", "branchId", "status", "createdAt");
CREATE INDEX "ServiceRequest_tenantId_branchId_assignedWaiterUserId_status_idx"
  ON "ServiceRequest"("tenantId", "branchId", "assignedWaiterUserId", "status");
CREATE INDEX "ServiceRequest_diningSessionId_type_status_idx"
  ON "ServiceRequest"("diningSessionId", "type", "status");
CREATE UNIQUE INDEX "ServiceRequest_one_open_type_per_session"
  ON "ServiceRequest"("diningSessionId", "type")
  WHERE "status" IN ('OPEN', 'CLAIMED', 'ESCALATED');

ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_tableId_fkey"
  FOREIGN KEY ("tableId") REFERENCES "RestaurantTable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_diningSessionId_fkey"
  FOREIGN KEY ("diningSessionId") REFERENCES "DiningSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_assignedWaiterUserId_fkey"
  FOREIGN KEY ("assignedWaiterUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_claimedByUserId_fkey"
  FOREIGN KEY ("claimedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
