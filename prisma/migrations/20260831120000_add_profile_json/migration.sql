-- Perfil cadastral extra (documentos, contatos, endereço). Não altera matrícula nem jornada.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "profileJson" TEXT;
