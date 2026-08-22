-- AlterTable
ALTER TABLE "MediaObject" ADD COLUMN "paymentId" TEXT;

-- CreateIndex
CREATE INDEX "MediaObject_tenantId_branchId_paymentId_idx" ON "MediaObject"("tenantId", "branchId", "paymentId");
