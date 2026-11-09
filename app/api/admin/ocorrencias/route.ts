import { NextResponse } from 'next/server';
import { z } from 'zod';
import prisma from '../../../../lib/prisma';
import { requireManager } from '../../../../lib/admin-guard';
import { appendAuditEvent } from '../../../../lib/security-controls';

export const dynamic = 'force-dynamic';

/** Ocorrências (esquecimento de batida) por colaborador e mês. */
export async function GET(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 401 });
  const url = new URL(request.url);
  const month = String(url.searchParams.get('month') || '');
  const userId = url.searchParams.get('userId');
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: 'Informe o mês (YYYY-MM).' }, { status: 400 });
  const items = await prisma.ocorrencia.findMany({ where: { month, ...(userId ? { userId } : {}) }, orderBy: { date: 'asc' } });
  const counts: Record<string, number> = {};
  for (const i of items) if (i.status === 'ATIVA') counts[i.userId] = (counts[i.userId] || 0) + 1;
  return NextResponse.json({ month, items, counts });
}

const Body = z.object({ id: z.string().min(1), reason: z.string().trim().min(5).max(500) });

/** Retirar uma ocorrência (fica como CANCELADA com motivo, autor e data). */
export async function PATCH(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Informe o motivo (mínimo 5 letras).' }, { status: 400 });
  const row = await prisma.ocorrencia.findUnique({ where: { id: parsed.data.id } });
  if (!row || row.status !== 'ATIVA') return NextResponse.json({ error: 'Ocorrência não encontrada ou já retirada.' }, { status: 404 });
  await prisma.ocorrencia.update({ where: { id: row.id }, data: { status: 'CANCELADA', canceledAt: new Date(), canceledById: manager.id, cancelReason: parsed.data.reason } });
  await appendAuditEvent({ action: 'OCORRENCIA_CANCELADA', actorId: manager.id, resource: 'Ocorrencia', resourceId: row.id, metadata: { userId: row.userId, date: row.date, reason: parsed.data.reason } });
  return NextResponse.json({ ok: true });
}
