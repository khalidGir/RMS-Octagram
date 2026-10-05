-- AlterTable: Add cashierShiftId to Payment
ALTER TABLE "Payment" ADD COLUMN "cashierShiftId" TEXT;

-- CreateTable
CREATE TABLE "CashShift" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "cashierUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "openingCashMinor" BIGINT NOT NULL DEFAULT 0,
    "expectedCashMinor" BIGINT,
    "countedCashMinor" BIGINT,
    "varianceMinor" BIGINT,
    "varianceReason" VARCHAR(255),
    "openedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(6),
    "closedByUserId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "CashShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftReportSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "cashShiftId" TEXT NOT NULL,
    "openingCashMinor" BIGINT NOT NULL,
    "approvedCashMinor" BIGINT NOT NULL DEFAULT 0,
    "expectedCashMinor" BIGINT NOT NULL,
    "countedCashMinor" BIGINT NOT NULL,
    "varianceMinor" BIGINT NOT NULL,
    "varianceReason" VARCHAR(255),
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "paymentCount" INTEGER NOT NULL DEFAULT 0,
    "cancellationCount" INTEGER NOT NULL DEFAULT 0,
    "voidCount" INTEGER NOT NULL DEFAULT 0,
    "localOpenedAt" TIMESTAMPTZ(6) NOT NULL,
    "localClosedAt" TIMESTAMPTZ(6) NOT NULL,
    "localBusinessDate" DATE NOT NULL,
    "openedByUserId" TEXT NOT NULL,
    "closedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftReportSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: One OPEN shift per cashier per branch
CREATE UNIQUE INDEX "CashShift_one_open_per_cashier" ON "CashShift"("tenantId", "branchId", "cashierUserId", "status");

-- CreateIndex
CREATE INDEX "CashShift_tenantId_branchId_idx" ON "CashShift"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX "CashShift_tenantId_branchId_cashierUserId_idx" ON "CashShift"("tenantId", "branchId", "cashierUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftReportSnapshot_cashShiftId_key" ON "ShiftReportSnapshot"("cashShiftId");

-- CreateIndex
CREATE INDEX "ShiftReportSnapshot_tenantId_branchId_idx" ON "ShiftReportSnapshot"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX "ShiftReportSnapshot_tenantId_branchId_localBusinessDate_idx" ON "ShiftReportSnapshot"("tenantId", "branchId", "localBusinessDate");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_cashierShiftId_fkey" FOREIGN KEY ("cashierShiftId") REFERENCES "CashShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashShift" ADD CONSTRAINT "CashShift_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftReportSnapshot" ADD CONSTRAINT "ShiftReportSnapshot_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
