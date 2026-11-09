import { NextResponse } from 'next/server';
import { z } from 'zod';
import prisma from '../../../../lib/prisma';
import { requireManager } from '../../../../lib/admin-guard';
import { resolvePendencia } from '../../../../lib/auto-close-server';
import { consumeRateLimit, getRequestKey, rateLimitResponse } from '../../../../lib/security-controls';

export const dynamic = 'force-dynamic';

/** Caixa do sino: pendências da verificação 17:20 + ciência do colaborador no aviso do ponto. */
export async function GET(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 401 });
  const url = new URL(request.url);
  const status = String(url.searchParams.get('status') || 'OPEN').toUpperCase();
  const where: any = ['OPEN', 'RESOLVED', 'IGNORED'].includes(status) ? { status } : {};
  const userId = url.searchParams.get('userId'); const date = url.searchParams.get('date');
  if (userId) where.userId = userId; if (date) where.date = date;
  const [items, openCount] = await Promise.all([
    prisma.pendencia.findMany({ where, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 200 }),
    prisma.pendencia.count({ where: { status: 'OPEN' } }),
  ]);
  const userIds = [...new Set(items.map((i) => i.userId))];
  const [users, warnings] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, employeeNumber: true } }),
    prisma.punchWarning.findMany({ where: { userId: { in: userIds }, issueDate: { in: [...new Set(items.map((i) => i.date))] } } }),
  ]);
  return NextResponse.json({
    openCount,
    items: items.map((i) => {
      const w = warnings.find((x) => x.userId === i.userId && x.issueDate === i.date);
      let suggestion = null; try { suggestion = i.suggestionJson ? JSON.parse(i.suggestionJson) : null; } catch {}
      return { ...i, suggestionJson: undefined, suggestion, employee: users.find((u) => u.id === i.userId) || null, warning: w ? { shownCount: w.shownCount, firstShownAt: w.firstShownAt, lastShownAt: w.lastShownAt, ackAt: w.ackAt } : null };
    }),
  });
}

const Body = z.object({ id: z.string().min(1), action: z.enum(['ACEITAR', 'IGNORAR', 'RESOLVIDA']), note: z.string().max(500).optional() });

export async function PATCH(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 401 });
  const rate = await consumeRateLimit(getRequestKey(request, 'admin-pendencias', manager.id), 30, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, ...(await resolvePendencia(parsed.data.id, parsed.data.action, manager.id, parsed.data.note)) });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message || 'Falha.' }, { status: 409 });
  }
}
