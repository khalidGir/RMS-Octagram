-- Add selectorHash column to AuthSession for token rotation tracking.
-- This column exists in the Prisma schema but was omitted from the initial migration.

ALTER TABLE "AuthSession"
  ADD COLUMN "selectorHash" TEXT NOT NULL DEFAULT '';

-- Backfill existing rows with unique hashes so the subsequent UNIQUE index succeeds.
-- md5() is built into PostgreSQL; clock_timestamp() ensures uniqueness across rows.
UPDATE "AuthSession"
  SET "selectorHash" = md5(random()::text || clock_timestamp()::text)
  WHERE "selectorHash" = '';

-- Create unique index (cannot be inline with ALTER on some PG versions)
CREATE UNIQUE INDEX "AuthSession_selectorHash_key" ON "AuthSession"("selectorHash");

-- Remove the default after backfill is no longer needed
ALTER TABLE "AuthSession" ALTER COLUMN "selectorHash" DROP DEFAULT;
