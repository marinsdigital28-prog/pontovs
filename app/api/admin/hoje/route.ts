import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireManager } from '@/lib/admin-guard';
import { dateKeyOf, hmOf, scheduleFor, toMin } from '@/lib/auto-close';
import { withEffectiveTypes } from '@/lib/punch-interpretation';
import { consumeRateLimit, getRequestKey, rateLimitResponse } from '../../../../lib/security-controls';

export const dynamic = 'force-dynamic';

/**
 * Painel "Hoje" (v2): uma única leitura, tudo em horário de Brasília.
 * Somente leitura — não altera batidas (Portaria 671). O contador de pendências é o MESMO do sino
 * (tabela Pendencia, status OPEN), para o card e o sino nunca divergirem.
 */
const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const addDays = (key: string, n: number) => { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const wdOf = (key: string) => new Date(`${key}T12:00:00Z`).getUTCDay();
const dayStart = (key: string) => new Date(`${key}T00:00:00-03:00`);
const reqKey = (v: Date) => new Date(v).toISOString().slice(0, 10);

export async function GET(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 401 });
  const rate = await consumeRateLimit(getRequestKey(request, 'admin-hoje-read', manager.id), 120, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);

  const now = new Date();
  const today = dateKeyOf(now);
  const nowMin = toMin(hmOf(now));
  const wd = wdOf(today);
  const monday = addDays(today, wd === 0 ? -6 : 1 - wd);
  const friday = addDays(monday, 4);

  const employees = await prisma.user.findMany({ where: { active: true, role: 'EMPLOYEE' }, select: { id: true, name: true, employeeNumber: true, jobTitle: true, workDays: true, scheduleStart: true, scheduleEnd: true, scheduleByDay: true }, orderBy: { name: 'asc' } });
  const ids = employees.map((e) => e.id);

  const [punchesRaw, openPend, resolvedAuto, weekReqs, pedidosPendentes] = await Promise.all([
    prisma.punch.findMany({ where: { userId: { in: ids }, timestamp: { gte: dayStart(today), lt: dayStart(addDays(today, 1)) } }, orderBy: { timestamp: 'asc' }, select: { id: true, userId: true, type: true, timestamp: true, status: true, origin: true, clientId: true } }),
    prisma.pendencia.findMany({ where: { status: 'OPEN' }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 200 }),
    prisma.pendencia.findMany({ where: { status: 'RESOLVED', resolvedById: null, resolvedAt: { gte: new Date(+now - 7 * 86_400_000) } }, select: { userId: true, date: true }, take: 20 }),
    prisma.employeeRequest.findMany({ where: { type: 'AUSENCIA', status: { in: ['PENDENTE', 'APROVADO'] }, startDate: { lte: new Date(`${friday}T23:59:59Z`) }, endDate: { gte: new Date(`${monday}T00:00:00Z`) } }, orderBy: { startDate: 'asc' }, select: { id: true, employeeId: true, status: true, startDate: true, endDate: true, reason: true, details: true, classification: true, medicalSpecialty: true, launchedAt: true } }),
    prisma.employeeRequest.count({ where: { status: 'PENDENTE' } }),
  ]);
  const punches = await withEffectiveTypes(punchesRaw);

  // Batidas dos dias com pendência aberta (para mostrar "batidas originais" × "dia resultante").
  const pendKeys = [...new Set(openPend.map((p) => `${p.userId}|${p.date}`))];
  const pendDates = [...new Set(openPend.map((p) => p.date))].sort();
  const pendPunchesRaw = pendDates.length ? await prisma.punch.findMany({ where: { userId: { in: [...new Set(openPend.map((p) => p.userId))] }, timestamp: { gte: dayStart(pendDates[0]), lt: dayStart(addDays(pendDates[pendDates.length - 1], 1)) } }, orderBy: { timestamp: 'asc' }, select: { id: true, userId: true, type: true, timestamp: true, status: true, origin: true, clientId: true } }) : [];
  const pendPunches = await withEffectiveTypes(pendPunchesRaw);
  const byId = new Map(employees.map((e) => [e.id, e]));
  const manual = (p: { origin?: string | null; clientId?: string | null }) => p.origin === 'ADJUSTED' || /^(manual|auto)-/.test(String(p.clientId || ''));

  const pendDays: Record<string, { schedule: string | null; punches: { id: string; time: string; type: string; originalType: string; manual: boolean; rejected: boolean }[] }> = {};
  for (const key of pendKeys) {
    const [userId, date] = key.split('|');
    const emp = byId.get(userId);
    const sch = emp ? scheduleFor(emp as any, date).schedule : null;
    pendDays[key] = {
      schedule: sch ? `${sch.start}–${sch.end}` : null,
      punches: pendPunches.filter((p) => p.userId === userId && dateKeyOf(p.timestamp) === date).map((p) => ({ id: p.id, time: hmOf(p.timestamp), type: p.type, originalType: p.originalType, manual: manual(p), rejected: p.status === 'REJECTED' })),
    };
  }

  const reqToday = (r: { startDate: Date; endDate: Date }) => reqKey(r.startDate) <= today && reqKey(r.endDate) >= today;
  const people = employees.map((e) => {
    const { schedule, scheduled } = scheduleFor(e as any, today);
    const mine = punches.filter((p) => p.userId === e.id);
    const valid = mine.filter((p) => p.status !== 'REJECTED');
    const last = valid[valid.length - 1];
    const absence = weekReqs.find((r) => r.employeeId === e.id && r.status === 'APROVADO' && reqToday(r)) || null;
    return {
      id: e.id, name: e.name, employeeNumber: e.employeeNumber, jobTitle: e.jobTitle,
      scheduled, schedule: schedule ? { start: schedule.start, end: schedule.end, mode: schedule.mode, lunchStart: schedule.lunchStart || null, lunchEnd: schedule.lunchEnd || null } : null,
      punches: mine.map((p) => ({ id: p.id, time: hmOf(p.timestamp), type: p.type, originalType: p.originalType, manual: manual(p), rejected: p.status === 'REJECTED' })),
      lastType: last?.type || null,
      absence: absence ? { reason: absence.reason, classification: absence.classification } : null,
    };
  });

  const level = (s: any) => s?.kind === 'INSERT_PUNCHES' && typeof s.confidence === 'number' ? (s.confidence >= 0.75 ? 'ALTA' : s.confidence >= 0.45 ? 'MEDIA' : 'DUVIDA') : 'CONFERIR';
  const pendencias = openPend.map((p) => {
    let suggestion: any = null; try { suggestion = p.suggestionJson ? JSON.parse(p.suggestionJson) : null; } catch { /* texto antigo */ }
    const emp = byId.get(p.userId);
    return { id: p.id, userId: p.userId, date: p.date, kind: p.kind, title: p.title, detail: p.detail, dryRun: p.dryRun, suggestion, level: level(suggestion), employee: emp ? { name: emp.name, jobTitle: emp.jobTitle } : null };
  });
  const late14 = pendencias.filter((p) => p.suggestion?.kind === 'INSERT_PUNCHES' && (p.suggestion.punches || []).some((x: any) => x.type === 'RETORNO' && toMin(x.time) >= 13 * 60 + 30)).length;

  // Fechamento: dias úteis (seg–sex) de hoje até o fim do mês.
  const [y, m] = today.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  let businessDays = 0; for (let d = today; d <= lastDay; d = addDays(d, 1)) { const w = wdOf(d); if (w !== 0 && w !== 6) businessDays += 1; }

  return NextResponse.json({
    now: now.toISOString(), today, nowMin, weekday: WD[wd], week: { from: monday, to: friday },
    people,
    pendencias,
    openCount: openPend.length,
    late14,
    autoClosed: resolvedAuto.map((r) => ({ name: byId.get(r.userId)?.name || '', date: r.date })),
    absences: weekReqs.map((r) => ({ id: r.id, employeeId: r.employeeId, name: byId.get(r.employeeId)?.name || '—', status: r.status, start: reqKey(r.startDate), end: reqKey(r.endDate), reason: r.reason, details: r.details, classification: r.classification, launched: Boolean(r.launchedAt) })),
    pedidosPendentes,
    pendDays,
    closing: { lastDay, businessDays, monthLabel: new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('pt-BR', { month: 'long', timeZone: 'UTC' }) },
  });
}
