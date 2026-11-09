import { NextResponse } from 'next/server';
import { z } from 'zod';
import prisma from '../../../lib/prisma';
import { appendHistory, loadAndComputeWarnings } from '../../../lib/punch-warnings';
import { appendAuditEvent, consumeRateLimit, getRequestKey, rateLimitResponse } from '../../../lib/security-controls';

export const dynamic = 'force-dynamic';

const Show = z.object({ employeeNumber: z.string().min(1).max(12), source: z.string().max(20).optional() });
const Ack = z.object({ employeeNumber: z.string().min(1).max(12), ids: z.array(z.string().min(1)).min(1).max(20), source: z.string().max(20).optional() });
const normalize = (v: string) => v.replace(/\D/g, '').padStart(4, '0');

/**
 * Chamado pela tela do ponto DEPOIS de identificar o colaborador (em paralelo à câmera).
 * Devolve os avisos de batida esquecida ainda sem "Ciente" e registra cada exibição.
 * Qualquer falha aqui devolve lista vazia: o ponto nunca é bloqueado.
 */
export async function POST(request: Request) {
  const rate = await consumeRateLimit(getRequestKey(request, 'punch-warnings'), 120, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);
  const parsed = Show.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ warnings: [] });
  try {
    const user = await prisma.user.findUnique({ where: { employeeNumber: normalize(parsed.data.employeeNumber) }, select: { id: true, name: true, employeeNumber: true, workDays: true, scheduleStart: true, scheduleEnd: true, scheduleByDay: true, active: true, role: true } });
    if (!user || !user.active || user.role !== 'EMPLOYEE') return NextResponse.json({ warnings: [] });
    const computed = await loadAndComputeWarnings(user);
    if (!computed.length) return NextResponse.json({ warnings: [] });
    const existing = await prisma.punchWarning.findMany({ where: { userId: user.id, kind: 'FALTA_BATIDA', issueDate: { in: computed.map((c) => c.issueDate) } } });
    const now = new Date();
    const source = parsed.data.source || 'totem';
    const out: { id: string; issueDate: string; message: string }[] = [];
    for (const c of computed) {
      const row = existing.find((e) => e.issueDate === c.issueDate);
      if (row?.ackAt) continue; // já deu ciência deste dia
      const history = appendHistory(row?.historyJson, { at: now.toISOString(), event: 'SHOWN', source });
      const saved = row
        ? await prisma.punchWarning.update({ where: { id: row.id }, data: { message: c.message, missingJson: JSON.stringify(c.missing), shownCount: { increment: 1 }, lastShownAt: now, historyJson: history } })
        : await prisma.punchWarning.create({ data: { userId: user.id, issueDate: c.issueDate, kind: 'FALTA_BATIDA', message: c.message, missingJson: JSON.stringify(c.missing), shownCount: 1, firstShownAt: now, lastShownAt: now, historyJson: history } });
      out.push({ id: saved.id, issueDate: c.issueDate, message: c.message });
    }
    return NextResponse.json({ warnings: out });
  } catch {
    return NextResponse.json({ warnings: [] });
  }
}

/** "Ciente": grava data/hora da ciência (comprovante) em cada aviso. */
export async function PATCH(request: Request) {
  const rate = await consumeRateLimit(getRequestKey(request, 'punch-warnings-ack'), 120, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);
  const parsed = Ack.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  try {
    const user = await prisma.user.findUnique({ where: { employeeNumber: normalize(parsed.data.employeeNumber) }, select: { id: true } });
    if (!user) return NextResponse.json({ error: 'Colaborador não encontrado.' }, { status: 404 });
    const rows = await prisma.punchWarning.findMany({ where: { id: { in: parsed.data.ids }, userId: user.id, ackAt: null } });
    const now = new Date();
    const ua = String(request.headers.get('user-agent') || '').slice(0, 180);
    for (const r of rows) {
      await prisma.punchWarning.update({ where: { id: r.id }, data: { ackAt: now, ackDeviceInfo: ua, historyJson: appendHistory(r.historyJson, { at: now.toISOString(), event: 'ACK', source: parsed.data.source || 'totem' }) } });
    }
    if (rows.length) await appendAuditEvent({ action: 'PUNCH_WARNING_ACK', actorId: user.id, resource: 'PunchWarning', resourceId: rows.map((r) => r.id).join(','), metadata: { issueDates: rows.map((r) => r.issueDate), at: now.toISOString() } });
    return NextResponse.json({ ok: true, acknowledged: rows.length, at: now });
  } catch {
    return NextResponse.json({ error: 'Não foi possível registrar agora.' }, { status: 500 });
  }
}
