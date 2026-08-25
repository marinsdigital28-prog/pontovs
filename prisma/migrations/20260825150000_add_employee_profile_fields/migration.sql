-- Additive employee profile fields; existing users and punches are preserved.

ALTER TABLE "User" ADD COLUMN "cpf" TEXT;

ALTER TABLE "User" ADD COLUMN "jobTitle" TEXT;

ALTER TABLE "User" ADD COLUMN "workDays" TEXT;

ALTER TABLE "User" ADD COLUMN "scheduleStart" TEXT;

ALTER TABLE "User" ADD COLUMN "scheduleEnd" TEXT;

CREATE UNIQUE INDEX "User_cpf_key" ON "User"("cpf");

