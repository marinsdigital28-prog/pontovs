import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireManager } from '@/lib/admin-guard';
import { dateKeyOf } from '@/lib/auto-close';
import { withEffectiveTypes } from '@/lib/punch-interpretation';
import { consumeRateLimit, getRequestKey, rateLimitResponse } from '@/lib/security-controls';
import { buildClosing, remainingBusinessDays } from '@/lib/hoje-fechamento';

export const dynamic = 'force-dynamic';

/**
 * Checklist de fechamento do mês para a gaveta do card. Somente leitura (Portaria 671).
 */
const dayStart = (key: string) => new Date(`${key}T00:00:00-03:00`);
const addDays = (key: string, n: number) => { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const reqKey = (v: Date) => new Date(v).toISOString().slice(0, 10);

export async function GET(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 401 });
  const rate = await consumeRateLimit(getRequestKey(request, 'admin-hoje-fechamento-read', manager.id), 60, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);

  const now = new Date();
  const today = dateKeyOf(now);
  const month = today.slice(0, 7);
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const from = `${month}-01`;

  const employees = await prisma.user.findMany({
    where: { active: true, role: 'EMPLOYEE' },
    select: { id: true, name: true, employeeNumber: true, jobTitle: true, workDays: true, scheduleStart: true, scheduleEnd: true, scheduleByDay: true, profileJson: true },
    orderBy: { name: 'asc' },
  });
  const ids = employees.map((e) => e.id);

  const [punchesRaw, openPend, reqs, certs] = await Promise.all([
    prisma.punch.findMany({
      where: { userId: { in: ids }, timestamp: { gte: dayStart(from), lt: dayStart(addDays(lastDay, 1)) } },
      orderBy: { timestamp: 'asc' },
      select: { id: true, userId: true, type: true, timestamp: true, status: true },
    }),
    prisma.pendencia.findMany({ where: { status: 'OPEN' }, select: { userId: true } }),
    prisma.employeeRequest.findMany({
      where: { startDate: { lte: new Date(`${lastDay}T23:59:59Z`) }, endDate: { gte: new Date(`${from}T00:00:00Z`) } },
      select: { employeeId: true, type: true, status: true, startDate: true, endDate: true, reason: true, launchedAt: true },
    }),
    prisma.medicalCertificate.findMany({
      where: { startDate: { lte: new Date(`${lastDay}T23:59:59Z`) }, endDate: { gte: new Date(`${from}T00:00:00Z`) } },
      select: { userId: true, status: true, startDate: true, endDate: true },
    }),
  ]);
  const punches = await withEffectiveTypes(punchesRaw);

  const result = buildClosing({
    employees,
    punches: punches.map((p) => ({ userId: p.userId, date: dateKeyOf(p.timestamp), type: p.type, rejected: p.status === 'REJECTED' })),
    requests: reqs.map((r) => ({ employeeId: r.employeeId, type: r.type, status: r.status, start: reqKey(r.startDate), end: reqKey(r.endDate), reason: r.reason, launchedAt: r.launchedAt ? r.launchedAt.toISOString() : null })),
    certificates: certs.map((c) => ({ userId: c.userId, status: c.status, start: reqKey(c.startDate), end: reqKey(c.endDate) })),
    today,
    month,
    openPendencias: openPend,
  });

  const businessDays = remainingBusinessDays(today, lastDay);
  const monthLabel = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('pt-BR', { month: 'long', timeZone: 'UTC' });

  return NextResponse.json({
    today,
    month,
    monthLabel,
    lastDay,
    businessDays,
    businessDaysCount: businessDays.length,
    holidaysNote: result.holidaysNote,
    totals: result.totals,
    people: result.people,
  });
}
