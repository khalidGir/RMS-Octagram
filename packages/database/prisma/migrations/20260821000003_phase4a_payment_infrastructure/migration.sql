-- Phase 4A: Manual transfer payment infrastructure.

-- 1. Add payment token fields to Payment.
ALTER TABLE "Payment"
  ADD COLUMN "paymentTokenHash" TEXT,
  ADD COLUMN "paymentTokenExpiresAt" TIMESTAMPTZ;

-- 2. Globally unique payment token (not tenant-scoped — tokens are opaque and must not collide).
CREATE UNIQUE INDEX "Payment_paymentTokenHash_unique"
  ON "Payment" ("paymentTokenHash")
  WHERE "paymentTokenHash" IS NOT NULL;

-- 3. One active (non-terminal) manual-transfer payment per order.
--    Terminal statuses: APPROVED, REJECTED, CANCELLED, REFUNDED.
CREATE UNIQUE INDEX "Payment_one_active_per_order"
  ON "Payment" ("tenantId", "branchId", "orderId")
  WHERE "method" = 'MANUAL_TRANSFER'
    AND "status" NOT IN ('APPROVED', 'REJECTED', 'CANCELLED', 'REFUNDED');

-- 4. Update MediaObject.scanStatus default to PENDING_UPLOAD.
ALTER TABLE "MediaObject"
  ALTER COLUMN "scanStatus" SET DEFAULT 'PENDING_UPLOAD';

-- 5. Exactly one current proof per payment.
CREATE UNIQUE INDEX "PaymentProof_one_current_per_payment"
  ON "PaymentProof" ("paymentId")
  WHERE "isCurrent" = true;
