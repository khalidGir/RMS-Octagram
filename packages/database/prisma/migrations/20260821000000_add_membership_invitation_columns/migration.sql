-- Add invitation workflow columns to TenantMembership
-- These columns exist in the Prisma schema but were omitted from the initial migration.

ALTER TABLE "TenantMembership"
  ADD COLUMN "invitationTokenHash" TEXT,
  ADD COLUMN "invitationExpiresAt" TIMESTAMPTZ,
  ADD COLUMN "acceptedAt" TIMESTAMPTZ;
