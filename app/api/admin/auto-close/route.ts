import { NextResponse } from 'next/server';
import { z } from 'zod';
import prisma from '../../../../lib/prisma';
import { requireManager } from '../../../../lib/admin-guard';
import { brazilDateKey } from '../../../../lib/brazil-time';
import { getAutoCloseMode, runAutoClose, setAutoCloseMode, undoAdjustment } from '../../../../lib/auto-close-server';
import { consumeRateLimit, getRequestKey, rateLimitResponse } from '../../../../lib/security-controls';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Card "Verificação automática": modo, últimas execuções e ajustes (*) feitos no dia. */
export async function GET(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 401 });
  const url = new URL(request.url);
  const dateParam = url.searchParams.get('date');
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : brazilDateKey();
  const [mode, runs, adjustments] = await Promise.all([
    getAutoCloseMode(),
    prisma.autoCloseRun.findMany({ orderBy: { createdAt: 'desc' }, take: 6, select: { id: true, date: true, phase: true, mode: true, trigger: true, createdAt: true, summaryJson: true } }),
    prisma.autoAdjustment.findMany({ where: { date }, orderBy: { createdAt: 'asc' } }),
  ]);
  const userIds = [...new Set(adjustments.map((a) => a.userId))];
  const [users, punches] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
    prisma.punch.findMany({ where: { userId: { in: userIds }, status: 'VALID', timestamp: { gte: new Date(`${date}T00:00:00-03:00`), lte: new Date(`${date}T23:59:59.999-03:00`) } }, orderBy: { timestamp: 'asc' }, select: { id: true, userId: true, type: true, timestamp: true } }),
  ]);
  const adjIds = new Set(adjustments.map((a) => a.punchId));
  return NextResponse.json({
    mode, date,
    runs: runs.map((r) => { let s: any = {}; try { s = JSON.parse(r.summaryJson); } catch {} return { id: r.id, date: r.date, phase: r.phase, mode: r.mode, trigger: r.trigger, createdAt: r.createdAt, summary: s.summary || null, applied: (s.applied || []).length, errors: (s.errors || []).length }; }),
    adjustments: adjustments.map((a) => ({ ...a, name: users.find((u) => u.id === a.userId)?.name || '—', originals: punches.filter((p) => p.userId === a.userId && !adjIds.has(p.id)).map((p) => ({ type: p.type, timestamp: p.timestamp })) })),
  });
}

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('setMode'), mode: z.enum(['DRY_RUN', 'REAL']) }),
  z.object({ action: z.literal('simulate'), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  z.object({ action: z.literal('undo'), adjustmentId: z.string().min(1), reason: z.string().trim().min(5).max(500) }),
]);

export async function POST(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 401 });
  const rate = await consumeRateLimit(getRequestKey(request, 'admin-auto-close', manager.id), 20, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Pedido inválido (motivo com pelo menos 5 letras).' }, { status: 400 });
  const body = parsed.data;
  try {
    if (body.action === 'setMode') { await setAutoCloseMode(body.mode, manager.id); return NextResponse.json({ ok: true, mode: body.mode }); }
    if (body.action === 'undo') { await undoAdjustment(body.adjustmentId, manager.id, body.reason); return NextResponse.json({ ok: true }); }
    // Simulação: só relatório, nada é gravado.
    const today = brazilDateKey();
    const result = await runAutoClose({ date: body.date, phase: body.date < today ? 'COMPLETO' : 'TARDE', mode: 'DRY_RUN', persist: false, trigger: 'manual', actorId: manager.id });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message || 'Falha.' }, { status: 409 });
  }
}
