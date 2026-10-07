-- Restaurant branding: the owner-uploaded logo is a tenant-wide asset (never
-- branch-scoped), processed by the media pipeline and referenced by the
-- manifest/icon URL builder. `version` gives Tenant the optimistic-concurrency
-- slot that logo finalize and the worker attach path require.
ALTER TABLE "Tenant" ADD COLUMN "logoMediaId" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Tenant"
  ADD CONSTRAINT "Tenant_logoMediaId_fkey"
  FOREIGN KEY ("logoMediaId") REFERENCES "MediaObject"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
