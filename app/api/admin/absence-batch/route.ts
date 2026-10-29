import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { appendAuditEvent } from '@/lib/security-controls';
import { isPeriodClosed, periodFromDate } from '@/lib/period-closure';
import { parseCompanyFilter, resolveCompany, selectBatchTargets } from '@/lib/company';

/**
 * Lançamento em lote de ausência/evento por empresa.
 * GET  = prévia (não grava nada). POST = cria as solicitações (status PENDENTE → aprovação normal).
 * Só entra quem é da empresa E tem marcação no dia. Nenhuma batida é alterada.
 */
export const dynamic = 'force-dynamic';
const BATCH_TYPES: Record<string, string> = { PASSEIO: 'Passeio da escola', EVENTO_EXTERNO: 'Evento externo', AUSENCIA: 'Ausência' };

async function requireManager() {
  const session = (await getServerSession(authOptions as any)) as any;
  const id = session?.user?.id as string | undefined;
  if (!id) return null;
  return prisma.user.findFirst({ where: { id, active: true, role: { in: ['ADMIN', 'MANAGER'] } }, select: { id: true, name: true } });
}

function dayRange(date: string) {
  // dia civil em São Paulo (UTC-3, sem horário de verão)
  return { start: new Date(`${date}T00:00:00-03:00`), end: new Date(`${date}T23:59:59.999-03:00`) };
}

async function preview(companyRaw: unknown, date: string, type: string) {
  const company = parseCompanyFilter(companyRaw);
  const { start, end } = dayRange(date);
  const employees = await prisma.user.findMany({
    where: { role: 'EMPLOYEE', active: true },
    select: { id: true, name: true, employeeNumber: true, profileJson: true, active: true },
    orderBy: { name: 'asc' },
  });
  const punches = await prisma.punch.findMany({ where: { timestamp: { gte: start, lte: end }, status: 'VALID' }, select: { userId: true, timestamp: true } });
  const existing = await prisma.employeeRequest.findMany({
    where: { type, status: { in: ['PENDENTE', 'APROVADO'] }, startDate: { lte: end }, endDate: { gte: start } },
    select: { employeeId: true },
  });
  const ids = new Set(punches.map((p) => p.userId));
  const covered = new Set(existing.map((r) => r.employeeId));
  const sel = selectBatchTargets(employees, company, ids, covered);
  const punchCount = (id: string) => punches.filter((p) => p.userId === id).length;
  const view = (e: (typeof employees)[number]) => ({ id: e.id, name: e.name, employeeNumber: e.employeeNumber, company: resolveCompany(e), punches: punchCount(e.id) });
  return { company, date, type, targets: sel.targets.map(view), withoutPunches: sel.withoutPunches.map(view), alreadyCovered: sel.alreadyCovered.map(view) };
}

function validate(date: string, type: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Data inválida.';
  if (!BATCH_TYPES[type]) return 'Tipo inválido.';
  return null;
}

export async function GET(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor.' }, { status: 401 });
  const q = new URL(request.url).searchParams;
  const date = q.get('date') || ''; const type = q.get('type') || '';
  const err = validate(date, type);
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  return NextResponse.json(await preview(q.get('company'), date, type));
}

export async function POST(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor.' }, { status: 401 });
  const body = (await request.json().catch(() => null)) as any;
  const date = String(body?.date || ''); const type = String(body?.type || '');
  const err = validate(date, type);
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  if (await isPeriodClosed(periodFromDate(new Date(`${date}T12:00:00-03:00`)))) return NextResponse.json({ error: 'Período fechado.' }, { status: 409 });
  const reason = String(body?.reason || BATCH_TYPES[type]).slice(0, 300);
  const confirmIds: string[] = Array.isArray(body?.employeeIds) ? body.employeeIds.filter((x: unknown) => typeof x === 'string') : [];
  const pv = await preview(body?.company, date, type);
  // só grava quem ainda está na prévia (recalculada no servidor) e foi confirmado na tela
  const targets = pv.targets.filter((t) => confirmIds.includes(t.id));
  if (!targets.length) return NextResponse.json({ error: 'Ninguém para lançar (sem marcação no dia ou já lançado).' }, { status: 400 });
  const { start, end } = dayRange(date);
  const created: Array<{ id: string; employeeId: string }> = [];
  for (const t of targets) {
    const r = await prisma.employeeRequest.create({
      data: { employeeId: t.id, type, status: 'PENDENTE', startDate: start, endDate: end, reason, details: `Lançado em lote pelo gestor (${pv.company})` },
      select: { id: true, employeeId: true },
    });
    created.push(r);
  }
  await appendAuditEvent({ action: 'ABSENCE_BATCH_CREATED', actorId: manager.id, resource: 'EmployeeRequest', resourceId: date, metadata: { company: pv.company, type, reason, requestIds: created.map((c) => c.id), employeeIds: created.map((c) => c.employeeId) } });
  return NextResponse.json({ ok: true, created: created.length });
}
