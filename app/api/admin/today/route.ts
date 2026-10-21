import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { brazilDateKey } from '@/lib/brazil-time';
import { resolveDaySchedule } from '@/lib/day-schedule';
import { loadHolidayOverrides } from '@/lib/holiday-store';
import { resolveHoliday } from '@/lib/holidays';
import { LATE_TOLERANCE_MINUTES } from '@/lib/trends';

export const dynamic = 'force-dynamic';
const TZ = 'America/Sao_Paulo';
function minutesOf(d: Date) { const p = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d); return Number(p.find((x) => x.type === 'hour')?.value) * 60 + Number(p.find((x) => x.type === 'minute')?.value); }
function hhmm(m: number) { return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
function clock(v?: string | null) { const m = String(v || '').match(/^(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }

export type TodayStatus = 'TRABALHANDO' | 'INTERVALO' | 'SAIU' | 'ATRASADO' | 'AUSENTE' | 'AGUARDANDO' | 'FOLGA' | 'JUSTIFICADO';

/** Visão "Hoje" para o gestor: quem chegou, atrasou, faltou, está em intervalo. Dia no fuso de São Paulo. */
export async function GET() {
  const session = await getServerSession(authOptions as any) as any;
  const id = session?.user?.id as string | undefined;
  if (!id || !['ADMIN', 'MANAGER'].includes(String(session?.user?.role))) return NextResponse.json({ error: 'Acesso administrativo necessário.' }, { status: 401 });
  const today = brazilDateKey();
  const now = new Date(); const nowMin = minutesOf(now);
  const start = new Date(`${today}T00:00:00-03:00`); const end = new Date(`${today}T23:59:59.999-03:00`);
  await loadHolidayOverrides();
  const holiday = resolveHoliday(today);
  const [employees, punches, certs, requests] = await Promise.all([
    prisma.user.findMany({ where: { role: 'EMPLOYEE', active: true }, select: { id: true, name: true, employeeNumber: true, jobTitle: true, workDays: true, scheduleStart: true, scheduleEnd: true, scheduleByDay: true }, orderBy: { name: 'asc' }, take: 1000 }),
    prisma.punch.findMany({ where: { timestamp: { gte: start, lte: end }, status: { not: 'REJECTED' } }, select: { userId: true, type: true, timestamp: true }, orderBy: { timestamp: 'asc' }, take: 10000 }),
    prisma.medicalCertificate.findMany({ where: { startDate: { lte: end }, endDate: { gte: start }, status: { in: ['APROVADO', 'ATIVO'] } }, select: { userId: true, type: true }, take: 2000 }),
    prisma.employeeRequest.findMany({ where: { startDate: { lte: end }, endDate: { gte: start }, status: 'APROVADO', type: 'AUSENCIA' }, select: { employeeId: true }, take: 2000 }),
  ]);
  const justified = new Set([...certs.map((c) => c.userId), ...requests.map((r) => r.employeeId)]);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const rows = employees.map((e) => {
    const schedule = resolveDaySchedule(e.scheduleByDay, e.workDays, e.scheduleStart, e.scheduleEnd, weekday, e.employeeNumber);
    const mine = punches.filter((p) => p.userId === e.id);
    const last = mine[mine.length - 1];
    const firstIn = mine.find((p) => p.type === 'ENTRADA');
    const s = clock(schedule?.start);
    const lateBy = firstIn && s !== null ? minutesOf(firstIn.timestamp) - s : null;
    let status: TodayStatus;
    if (last?.type === 'SAIDA') status = 'SAIU';
    else if (last?.type === 'INTERVALO') status = 'INTERVALO';
    else if (last) status = lateBy !== null && lateBy > LATE_TOLERANCE_MINUTES ? 'ATRASADO' : 'TRABALHANDO';
    else if (!schedule || holiday) status = 'FOLGA';
    else if (justified.has(e.id)) status = 'JUSTIFICADO';
    else if (s !== null && nowMin > s + LATE_TOLERANCE_MINUTES) status = 'AUSENTE';
    else status = 'AGUARDANDO';
    return {
      id: e.id, name: e.name, employeeNumber: e.employeeNumber, jobTitle: e.jobTitle, status,
      schedule: schedule ? `${schedule.start}–${schedule.end}` : null,
      firstIn: firstIn ? hhmm(minutesOf(firstIn.timestamp)) : null,
      lateMinutes: lateBy !== null && lateBy > LATE_TOLERANCE_MINUTES ? lateBy : 0,
      lastPunch: last ? { type: last.type, time: hhmm(minutesOf(last.timestamp)) } : null,
      breakSince: last?.type === 'INTERVALO' ? hhmm(minutesOf(last.timestamp)) : null,
      breakMinutes: last?.type === 'INTERVALO' ? Math.max(0, Math.round((now.getTime() - last.timestamp.getTime()) / 60000)) : null,
    };
  });
  const counts = rows.reduce((acc: Record<string, number>, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
  return NextResponse.json({ date: today, now: hhmm(nowMin), holiday, rows, counts, generatedAt: now.toISOString() });
}
