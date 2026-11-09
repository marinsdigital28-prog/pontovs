import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth';
import prisma from './prisma';

/** Gestor (ADMIN/MANAGER) ativo da sessão, conferido no banco. */
export async function requireManager() {
  const session = (await getServerSession(authOptions as any)) as any;
  const id = session?.user?.id as string | undefined;
  if (!id) return null;
  return prisma.user.findFirst({ where: { id, active: true, role: { in: ['ADMIN', 'MANAGER'] } }, select: { id: true, name: true, role: true } });
}

/** Administradores do painel (ADMIN/MANAGER = gestor). Colaboradores nunca passam. */
export async function requireAdmin() {
  return requireManager();
}
