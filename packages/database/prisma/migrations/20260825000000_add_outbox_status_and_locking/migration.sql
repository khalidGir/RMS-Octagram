-- AlterTable: Add status, lockedBy, lockedAt, nextRetryAt to OutboxEvent
ALTER TABLE "OutboxEvent" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "OutboxEvent" ADD COLUMN "lockedBy" TEXT;
ALTER TABLE "OutboxEvent" ADD COLUMN "lockedAt" TIMESTAMP(3);
ALTER TABLE "OutboxEvent" ADD COLUMN "nextRetryAt" TIMESTAMP(3);

-- CreateIndex: Efficient scheduling of retryable events
CREATE INDEX "OutboxEvent_status_nextRetryAt_idx" ON "OutboxEvent"("status", "nextRetryAt");
