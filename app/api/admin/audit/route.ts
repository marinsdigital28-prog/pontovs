import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { appendAuditEvent, getAuditEvents, verifyAuditChain } from '@/lib/security-controls';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = (await getServerSession(authOptions as any)) as any;
  const id = session?.user?.id as string | undefined;
  if (!id) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 401 });
  const manager = await prisma.user.findFirst({ where: { id, active: true, role: { in: ['ADMIN', 'MANAGER'] } }, select: { id: true } });
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 403 });
  await appendAuditEvent({ action: 'AUDIT_VIEWED', actorId: manager.id, resource: 'SecurityAudit' });
  const [chainValid, events] = await Promise.all([verifyAuditChain(), getAuditEvents(50)]);
  return NextResponse.json({ chainValid, events, mode: process.env.UPSTASH_REDIS_REST_URL ? 'redis-plus-postgres' : 'postgres-plus-memory-rate-limit-fallback' });
}
