-- Leitura do sistema sobre batidas originais (Portaria 671: a batida original nunca é alterada).
-- Aditiva e idempotente: não toca em "Punch".
CREATE TABLE IF NOT EXISTS "PunchInterpretation" (
    "id" TEXT NOT NULL,
    "punchId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "reason" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PunchInterpretation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PunchInterpretation_punchId_key" ON "PunchInterpretation"("punchId");
DO $$ BEGIN
  ALTER TABLE "PunchInterpretation" ADD CONSTRAINT "PunchInterpretation_punchId_fkey" FOREIGN KEY ("punchId") REFERENCES "Punch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
