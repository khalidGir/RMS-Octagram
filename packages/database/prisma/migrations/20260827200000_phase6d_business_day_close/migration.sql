-- AlterTable: Add businessDayCutoffLocal to Branch
ALTER TABLE "Branch" ADD COLUMN "businessDayCutoffLocal" VARCHAR(5) NOT NULL DEFAULT '06:00';

-- CreateTable
CREATE TABLE "BusinessDayClose" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "localBusinessDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CLOSED',
    "snapshotJson" JSONB NOT NULL,
    "closedWithException" BOOLEAN NOT NULL DEFAULT false,
    "reason" VARCHAR(500),
    "closedByUserId" TEXT NOT NULL,
    "closedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reopenedByUserId" TEXT,
    "reopenedAt" TIMESTAMPTZ(6),
    "reopenReason" VARCHAR(500),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessDayClose_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: One current close per (tenant, branch, business date)
CREATE UNIQUE INDEX "BusinessDayClose_tenantId_branchId_localBusinessDate_key" ON "BusinessDayClose"("tenantId", "branchId", "localBusinessDate");

-- CreateIndex
CREATE INDEX "BusinessDayClose_tenantId_branchId_idx" ON "BusinessDayClose"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX "BusinessDayClose_tenantId_branchId_status_idx" ON "BusinessDayClose"("tenantId", "branchId", "status");

-- AddForeignKey
ALTER TABLE "BusinessDayClose" ADD CONSTRAINT "BusinessDayClose_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
