-- Fix: Drop the non-partial unique index and replace with partial unique index
-- Only one OPEN shift per cashier per branch; multiple CLOSED shifts are allowed

DROP INDEX "CashShift_one_open_per_cashier";

CREATE UNIQUE INDEX "CashShift_one_open_per_cashier" ON "CashShift"("tenantId", "branchId", "cashierUserId") WHERE "status" = 'OPEN';
