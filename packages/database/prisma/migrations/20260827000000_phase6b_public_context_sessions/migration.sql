-- AlterTable: Add publicSlug to Branch
ALTER TABLE "Branch" ADD COLUMN "publicSlug" TEXT;

-- CreateTable: Branch publicSlug unique index (globally unique for customer URLs)
CREATE UNIQUE INDEX "Branch_publicSlug_key" ON "Branch"("publicSlug") WHERE "publicSlug" IS NOT NULL;

-- AlterTable: Add DiningSession v2 fields
ALTER TABLE "DiningSession" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "DiningSession" ADD COLUMN "clearedByUserId" TEXT;
ALTER TABLE "DiningSession" ADD COLUMN "clearReason" TEXT;

-- CreateIndex: Session lookup by table+status (for open-session checks)
CREATE INDEX "DiningSession_tableId_status_idx" ON "DiningSession"("tableId", "status");
