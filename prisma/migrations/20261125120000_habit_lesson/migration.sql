-- Aprendizado com correções do gestor (aditivo; não toca em "Punch").
CREATE TABLE IF NOT EXISTS "HabitLesson" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "fromType" TEXT,
    "punchId" TEXT,
    "source" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HabitLesson_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "HabitLesson_userId_date_type_kind_key" ON "HabitLesson"("userId", "date", "type", "kind");
CREATE INDEX IF NOT EXISTS "HabitLesson_userId_date_idx" ON "HabitLesson"("userId", "date");
CREATE INDEX IF NOT EXISTS "HabitLesson_userId_weekday_type_idx" ON "HabitLesson"("userId", "weekday", "type");
DO $$ BEGIN
  ALTER TABLE "HabitLesson" ADD CONSTRAINT "HabitLesson_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
