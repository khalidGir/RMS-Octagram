-- Partial unique index: at most one active (non-terminal) transfer payment per order+method.
-- Terminal statuses: APPROVED, REJECTED, CANCELLED, REFUNDED, FAILED.
-- This prevents the TOCTOU race in concurrent payment creation.
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_tenantId_branchId_orderId_method_active_key"
  ON "Payment" ("tenantId", "branchId", "orderId", "method")
  WHERE "status" NOT IN ('APPROVED', 'REJECTED', 'CANCELLED', 'REFUNDED', 'FAILED')
    AND "method" IN ('BANK_TRANSFER', 'TELEBIRR', 'MANUAL_TRANSFER');
