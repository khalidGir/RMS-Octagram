-- CreateTable
CREATE TABLE "SupportSession" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "endedAt" TIMESTAMPTZ(6),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: One active session per admin per tenant
CREATE UNIQUE INDEX "SupportSession_adminUserId_tenantId_status_key" ON "SupportSession"("adminUserId", "tenantId", "status");

-- CreateIndex
CREATE INDEX "SupportSession_adminUserId_idx" ON "SupportSession"("adminUserId");

-- CreateIndex
CREATE INDEX "SupportSession_tenantId_idx" ON "SupportSession"("tenantId");

-- CreateIndex
CREATE INDEX "SupportSession_status_idx" ON "SupportSession"("status");
