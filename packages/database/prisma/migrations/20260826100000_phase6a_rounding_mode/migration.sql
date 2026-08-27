-- AlterTable: Add roundingMode to TenantTaxConfiguration and roundingModeSnapshot to Order
-- Phase 6A rounding mode: VAT rounding policy is an UNRESOLVED EXTERNAL DECISION.
-- Default "DOWN" matches the prior provisional Math.floor behavior.
-- Existing confirmed VAT configs retain DOWN until explicitly changed by owner.

-- AlterTable
ALTER TABLE "TenantTaxConfiguration" ADD COLUMN "roundingMode" TEXT NOT NULL DEFAULT 'DOWN';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "roundingModeSnapshot" TEXT;
