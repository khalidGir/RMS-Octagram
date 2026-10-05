-- Fix: Drop the old non-partial unique index that was created in the init migration.
-- The phase3a migration used ALTER TABLE ... DROP CONSTRAINT which does not work for
-- indexes created via CREATE UNIQUE INDEX. PostgreSQL requires DROP INDEX instead.

DROP INDEX IF EXISTS "IdempotencyRecord_tenantId_operation_key_key";
