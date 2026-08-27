-- Drop the old active-payment index that omits FAILED from terminal statuses.
DROP INDEX IF EXISTS "Payment_one_active_per_order";

-- Recreate with FAILED included in the terminal statuses predicate.
CREATE UNIQUE INDEX "Payment_one_active_per_order"
  ON "Payment" ("tenantId", "branchId", "orderId")
  WHERE "method" = 'MANUAL_TRANSFER'
    AND "status" NOT IN ('APPROVED', 'REJECTED', 'CANCELLED', 'REFUNDED', 'FAILED');
