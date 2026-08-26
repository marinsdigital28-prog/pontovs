-- Additive migration: creates only the audit event table and indexes.
CREATE TABLE "SecurityAuditEvent" (
  "id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actorId" TEXT,
  "resource" TEXT,
  "resourceId" TEXT,
  "metadataJson" TEXT,
  "previousHash" TEXT NOT NULL,
  "hash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SecurityAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SecurityAuditEvent_hash_key" ON "SecurityAuditEvent"("hash");
CREATE INDEX "SecurityAuditEvent_createdAt_idx" ON "SecurityAuditEvent"("createdAt");
CREATE INDEX "SecurityAuditEvent_actorId_createdAt_idx" ON "SecurityAuditEvent"("actorId", "createdAt");

ALTER TABLE "SecurityAuditEvent" ADD CONSTRAINT "SecurityAuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
