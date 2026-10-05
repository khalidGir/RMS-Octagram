-- Prevent duplicate versions per table (catches concurrent rotation races)
CREATE UNIQUE INDEX IF NOT EXISTS "TableQrToken_tableId_version_key"
  ON "TableQrToken"("tableId", "version");

-- Partial unique index: at most one active (revokedAt IS NULL) token per table
CREATE UNIQUE INDEX IF NOT EXISTS "TableQrToken_tableId_active_key"
  ON "TableQrToken"("tableId")
  WHERE "revokedAt" IS NULL;
