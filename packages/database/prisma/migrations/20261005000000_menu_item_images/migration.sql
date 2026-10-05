-- Menu item images are tenant-wide assets. Payment proofs remain branch-bound
-- by application invariants, while menu media intentionally has no branch.
ALTER TABLE "MediaObject" ALTER COLUMN "branchId" DROP NOT NULL;

ALTER TABLE "MenuItem" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "MediaObject"
  ADD COLUMN "processingStatus" TEXT NOT NULL DEFAULT 'NOT_APPLICABLE',
  ADD COLUMN "cropData" JSONB,
  ADD COLUMN "originalWidth" INTEGER,
  ADD COLUMN "originalHeight" INTEGER,
  ADD COLUMN "outputWidth" INTEGER,
  ADD COLUMN "outputHeight" INTEGER,
  ADD COLUMN "outputFormat" TEXT,
  ADD COLUMN "cdnKeyBase" TEXT,
  ADD COLUMN "rejectionReason" TEXT,
  ADD COLUMN "processedAt" TIMESTAMP(3),
  ADD COLUMN "cleanupAfter" TIMESTAMP(3);
ALTER TABLE "MediaObject" ADD COLUMN "targetMenuItemId" TEXT;
-- Optimistic-concurrency guard + processing lease for the SQS image pipeline.
ALTER TABLE "MediaObject"
  ADD COLUMN "expectedItemVersion" INTEGER,
  ADD COLUMN "processingStartedAt" TIMESTAMP(3),
  ADD COLUMN "processingLeaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "processingAttempt" INTEGER NOT NULL DEFAULT 0;

-- Defensive cleanup for legacy dangling values before adding the FK.
UPDATE "MenuItem" mi
SET "imageMediaId" = NULL
WHERE "imageMediaId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "MediaObject" mo WHERE mo."id" = mi."imageMediaId");

ALTER TABLE "MenuItem"
  ADD CONSTRAINT "MenuItem_imageMediaId_fkey"
  FOREIGN KEY ("imageMediaId") REFERENCES "MediaObject"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "MediaObject_tenantId_purpose_processingStatus_idx"
  ON "MediaObject"("tenantId", "purpose", "processingStatus");
CREATE INDEX "MediaObject_cleanupAfter_idx" ON "MediaObject"("cleanupAfter");
CREATE INDEX "MediaObject_tenantId_targetMenuItemId_idx"
  ON "MediaObject"("tenantId", "targetMenuItemId");
