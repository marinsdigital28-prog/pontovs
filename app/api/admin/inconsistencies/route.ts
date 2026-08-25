import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

async function requireManager() {
  const session = (await getServerSession(authOptions as any)) as any;
  const id = session?.user?.id as string | undefined;
  if (!id) return null;
  return prisma.user.findFirst({ where: { id, active: true, role: { in: ['ADMIN', 'MANAGER'] } }, select: { id: true } });
}

export async function GET() {
  if (!(await requireManager())) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 401 });
  const inconsistencies = await prisma.inconsistency.findMany({ where: { status: 'OPEN' }, orderBy: { detectedAt: 'desc' }, take: 200, select: { id: true, type: true, status: true, description: true, detectedAt: true, user: { select: { name: true, employeeNumber: true } }, punch: { select: { id: true, type: true, timestamp: true } } } });
  return NextResponse.json({ inconsistencies });
}

export async function PATCH(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const id = String(body?.id ?? '').trim();
  if (!id) return NextResponse.json({ error: 'Inconsistência inválida.' }, { status: 400 });
  const status = body?.status === 'RESOLVED' ? 'RESOLVED' : 'OPEN';
  const issue = await prisma.inconsistency.update({ where: { id }, data: { status, resolvedAt: status === 'RESOLVED' ? new Date() : null, resolvedBy: status === 'RESOLVED' ? manager.id : null } });
  return NextResponse.json({ issue });
}
