ALTER TABLE "Punch"
  ADD COLUMN "syncedAt" TIMESTAMP(3),
  ADD COLUMN "syncStatus" TEXT NOT NULL DEFAULT 'SYNCED',
  ADD COLUMN "syncAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "syncError" TEXT,
  ADD COLUMN "deviceId" TEXT,
  ADD COLUMN "deviceOs" TEXT,
  ADD COLUMN "appVersion" TEXT,
  ADD COLUMN "connectivity" TEXT,
  ADD COLUMN "locationCapturedAt" TIMESTAMP(3);

CREATE INDEX "Punch_syncStatus_idx" ON "Punch"("syncStatus");
CREATE INDEX "Punch_syncedAt_idx" ON "Punch"("syncedAt");
