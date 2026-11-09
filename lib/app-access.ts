import { Prisma } from '@prisma/client';
import prisma from './prisma';

/**
 * Marca acesso do colaborador ao app (login ou chamada autenticada).
 * SQL direto: não mexe em updatedAt e só grava no máximo a cada 5 min. Nunca lança erro.
 */
export async function touchAppAccess(userId: string | null | undefined) {
  if (!userId) return;
  try {
    await prisma.$executeRaw(Prisma.sql`UPDATE "User" SET "lastSeenAt" = NOW(), "firstSeenAt" = COALESCE("firstSeenAt", NOW()) WHERE "id" = ${userId} AND "role" = 'EMPLOYEE' AND ("lastSeenAt" IS NULL OR "lastSeenAt" < NOW() - INTERVAL '5 minutes')`);
  } catch {
    // acesso ao app nunca pode falhar por causa deste registro
  }
}
