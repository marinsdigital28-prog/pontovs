import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { appendAuditEvent } from '@/lib/security-controls';
import { brazilDateKey } from '@/lib/brazil-time';
import { resolveDaySchedule } from '@/lib/day-schedule';
import { parseWorkDays } from '@/lib/timesheet-schedule';
import { getOperationalAbono } from '@/lib/operational-abonos';
import { dateKeysBetween } from '@/lib/inconsistency-detector';
import { isPeriodClosed, periodBounds } from '@/lib/period-closure';
import { brazilDateTimeParts, createManualInclusion } from '@/lib/punch-correction';
import { parseManualTimestamp } from '@/lib/manual-punch';
import { classifyDay, DEFAULT_LUNCH_MINUTES, ISSUE_LABEL, proposeFill, scheduledInterval, toMinutes, type IssueCode } from '@/lib/inconsistency-fill';

export const dynamic = 'force-dynamic';
const DAY = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'];

async function requireManager() {
  const session = (await getServerSession(authOptions as any)) as any;
  const id = session?.user?.id as string | undefined;
  if (!id) return null;
  return prisma.user.findFirst({ where: { id, active: true, role: { in: ['ADMIN', 'MANAGER'] } }, select: { id: true } });
}

function lastDayOf(period: string) { const [y, m] = period.split('-').map(Number); return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; }

async function analyze(period: string, lunchMinutes: number) {
  const bounds = periodBounds(period)!;
  const today = brazilDateKey();
  // o dia de hoje ainda está em andamento: analisa só até ontem
  const yesterday = new Date(new Date(`${today}T12:00:00-03:00`).getTime() - 86400000).toISOString().slice(0, 10);
  const to = lastDayOf(period) < yesterday ? lastDayOf(period) : yesterday;
  const from = `${period}-01`;
  if (from > to) return { employees: [], total: 0, fillable: 0 };
  const employees = await prisma.user.findMany({ where: { role: 'EMPLOYEE', active: true }, select: { id: true, name: true, employeeNumber: true, workDays: true, scheduleStart: true, scheduleEnd: true, scheduleByDay: true }, orderBy: { name: 'asc' }, take: 1000 });
  const ids = employees.map((e) => e.id);
  const [punches, certs, reqs] = await Promise.all([
    prisma.punch.findMany({ where: { userId: { in: ids }, timestamp: { gte: bounds.start, lt: bounds.end }, status: { not: 'REJECTED' } }, select: { id: true, userId: true, type: true, timestamp: true, origin: true }, orderBy: { timestamp: 'asc' }, take: 20000 }),
    prisma.medicalCertificate.findMany({ where: { userId: { in: ids }, startDate: { lt: bounds.end }, endDate: { gte: bounds.start }, status: { in: ['APROVADO', 'ATIVO'] } }, select: { userId: true, startDate: true, endDate: true } }),
    prisma.employeeRequest.findMany({ where: { employeeId: { in: ids }, startDate: { lt: bounds.end }, endDate: { gte: bounds.start }, status: 'APROVADO' }, select: { employeeId: true, startDate: true, endDate: true } }),
  ]);
  const exc = [...certs.map((c) => ({ u: c.userId, s: brazilDateKey(c.startDate), e: brazilDateKey(c.endDate) })), ...reqs.map((r) => ({ u: r.employeeId, s: brazilDateKey(r.startDate), e: brazilDateKey(r.endDate) }))];
  const byDay = new Map<string, Array<{ id: string; type: string; minutes: number; time: string; manual: boolean }>>();
  for (const p of punches) { const { date, time } = brazilDateTimeParts(p.timestamp); const k = `${p.userId}|${date}`; byDay.set(k, [...(byDay.get(k) || []), { id: p.id, type: p.type, minutes: toMinutes(time)!, time, manual: p.origin === 'ADJUSTED' }]); }
  let total = 0; let fillable = 0;
  const out = [] as any[];
  for (const e of employees) {
    const wd = e.workDays ? parseWorkDays(e.workDays) : new Set(['SEG', 'TER', 'QUA', 'QUI', 'SEX']);
    const days = [] as any[];
    for (const date of dateKeysBetween(from, to)) {
      const wk = new Date(`${date}T12:00:00-03:00`).getUTCDay();
      const sch = resolveDaySchedule(e.scheduleByDay, e.workDays, e.scheduleStart, e.scheduleEnd, wk);
      if (!sch || !wd.has(DAY[wk])) continue;
      if (exc.some((x) => x.u === e.id && x.s <= date && x.e >= date)) continue;
      if (getOperationalAbono(e.employeeNumber, date)?.kind === 'FULL_DAY') continue;
      const ps = (byDay.get(`${e.id}|${date}`) || []);
      const schedule = { ...sch, ...(scheduledInterval(e.scheduleByDay, DAY[wk]) || {}) };
      const issues = classifyDay(ps, schedule, { lunchMinutes });
      if (!issues.length) continue;
      const fills = proposeFill(ps, schedule, { lunchMinutes });
      total += issues.length; fillable += fills.length ? 1 : 0;
      days.push({ date, schedule: `${sch.start}–${sch.end}${sch.mode === 'HALF' ? ' (meio)' : ''}`, issues: issues.map((code) => ({ code, label: ISSUE_LABEL[code as IssueCode] })), punches: ps.map(({ type, time, manual }) => ({ type, time, manual })), fills });
    }
    if (days.length) {
      const groups: Record<string, number> = {};
      for (const d of days) for (const i of d.issues) groups[i.code] = (groups[i.code] || 0) + 1;
      out.push({ id: e.id, name: e.name, employeeNumber: e.employeeNumber, groups, days });
    }
  }
  return { employees: out, total, fillable };
}

function parsePeriod(v: unknown) { const p = String(v || ''); return periodBounds(p) ? p : null; }
function parseLunch(v: unknown) { const n = Number(v); return Number.isFinite(n) && n >= 15 && n <= 180 ? Math.round(n) : DEFAULT_LUNCH_MINUTES; }

export async function GET(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor.' }, { status: 401 });
  const url = new URL(request.url);
  const period = parsePeriod(url.searchParams.get('period') || brazilDateKey().slice(0, 7));
  if (!period) return NextResponse.json({ error: 'Competência inválida (AAAA-MM).' }, { status: 400 });
  const lunchMinutes = parseLunch(url.searchParams.get('lunch'));
  try {
    const [data, closed] = await Promise.all([analyze(period, lunchMinutes), isPeriodClosed(period)]);
    if (url.searchParams.get('summary') === '1') return NextResponse.json({ period, closed, total: data.total, employees: data.employees.length });
    return NextResponse.json({ period, closed, lunchMinutes, ...data });
  } catch (error) {
    console.error('inconsistencias GET failed', error);
    return NextResponse.json({ error: 'Não foi possível calcular as inconsistências.' }, { status: 503 });
  }
}

/** Aplica preenchimentos selecionados: apenas INCLUSÕES manuais (origin ADJUSTED, * na folha) com auditoria. */
export async function POST(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor.' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const period = parsePeriod(body?.period);
  const reason = String(body?.reason || '').trim();
  const lunchMinutes = parseLunch(body?.lunchMinutes);
  const selected: Array<{ userId: string; date: string }> = Array.isArray(body?.items) ? body.items.filter((i: any) => typeof i?.userId === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(String(i?.date))) : [];
  if (!period) return NextResponse.json({ error: 'Competência inválida.' }, { status: 400 });
  if (reason.length < 5) return NextResponse.json({ error: 'Informe uma justificativa com pelo menos 5 caracteres.' }, { status: 400 });
  if (!selected.length || selected.length > 2000) return NextResponse.json({ error: 'Selecione entre 1 e 2000 dias.' }, { status: 400 });
  if (selected.some((i) => i.date.slice(0, 7) !== period)) return NextResponse.json({ error: 'Há dias fora da competência.' }, { status: 400 });
  if (await isPeriodClosed(period)) return NextResponse.json({ error: `A competência ${period} está fechada. Reabra para ajustar.`, code: 'PERIOD_CLOSED' }, { status: 409 });
  // Recalcula no servidor (não confia nos horários enviados pelo navegador)
  const data = await analyze(period, lunchMinutes);
  const wanted = new Set(selected.map((i) => `${i.userId}|${i.date}`));
  const plan = data.employees.flatMap((e: any) => e.days.filter((d: any) => wanted.has(`${e.id}|${d.date}`) && d.fills.length).map((d: any) => ({ userId: e.id, date: d.date, fills: d.fills })));
  if (!plan.length) return NextResponse.json({ error: 'Nenhum preenchimento aplicável nos dias selecionados.' }, { status: 409 });
  const units = new Map((await prisma.user.findMany({ where: { id: { in: plan.map((p: any) => p.userId) } }, select: { id: true, unitId: true } })).map((u) => [u.id, u.unitId]));
  try {
    const created = await prisma.$transaction(async (tx) => {
      let n = 0;
      for (const day of plan) for (const f of day.fills) {
        const r = await createManualInclusion(tx, { userId: day.userId, unitId: units.get(day.userId) ?? null, type: f.type, timestamp: parseManualTimestamp(day.date, f.time)!, managerId: manager.id, reason, source: 'fechamento_preenchimento' });
        if (r) n += 1;
      }
      return n;
    }, { timeout: 30000 });
    await appendAuditEvent({ action: 'INCONSISTENCIAS_PREENCHIDAS', actorId: manager.id, resource: 'TimesheetPeriod', resourceId: period, metadata: { period, reason, lunchMinutes, days: plan.length, created } });
    return NextResponse.json({ ok: true, days: plan.length, created });
  } catch (error) {
    console.error('inconsistencias POST failed', error);
    return NextResponse.json({ error: 'Não foi possível aplicar os preenchimentos. Nada foi gravado.' }, { status: 500 });
  }
}
