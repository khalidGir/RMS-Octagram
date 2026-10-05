-- Drop the non-partial unique constraint created by the first migration
DROP INDEX IF EXISTS "SupportSession_adminUserId_tenantId_status_key";

-- Create partial unique index: one ACTIVE session per admin per tenant
CREATE UNIQUE INDEX "SupportSession_active_session_idx" ON "SupportSession"("adminUserId", "tenantId") WHERE "status" = 'ACTIVE';
