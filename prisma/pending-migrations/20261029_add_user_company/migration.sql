-- PREPARADA, NÃO APLICADA. Aditiva: não altera nem apaga dados existentes.
-- Fica fora de prisma/migrations e o campo NÃO está no schema.prisma de propósito:
-- o build roda `prisma db push` e os previews usam o banco de produção.
-- Para aplicar (somente com aprovação): rodar este SQL, depois adicionar ao model User:
--   company String @default("ESPACO_PROGREDIR")
-- e então copiar profileJson.company para a coluna (scripts/set-company-escola.mjs --column).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "company" TEXT NOT NULL DEFAULT 'ESPACO_PROGREDIR';
CREATE INDEX IF NOT EXISTS "User_company_idx" ON "User"("company");
