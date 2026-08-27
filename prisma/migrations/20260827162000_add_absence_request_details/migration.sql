ALTER TABLE "EmployeeRequest"
  ADD COLUMN "medicalSpecialty" TEXT,
  ADD COLUMN "classification" TEXT,
  ADD COLUMN "returnExpected" BOOLEAN,
  ADD COLUMN "documentName" TEXT,
  ADD COLUMN "documentMime" TEXT,
  ADD COLUMN "documentData" TEXT;
