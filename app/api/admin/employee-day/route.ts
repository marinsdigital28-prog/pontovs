import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '../../../../lib/prisma';
import { resolveDaySchedule } from '../../../../lib/day-schedule';
import { isScheduledDay, parseWorkDays } from '../../../../lib/timesheet-schedule';
import { sequenceWarnings } from '../../../../lib/day-guards';

export const dynamic = 'force-dynamic';
const CODES = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];

async function requireManager() {
  const session = (await getServerSession(authOptions as any)) as any;
  const id = session?.user?.id as string | undefined;
  if (!id) return null;
  return prisma.user.findFirst({ where: { id, active: true, role: { in: ['ADMIN', 'MANAGER'] } }, select: { id: true } });
}

/** Dia do colaborador: batidas (com foto/tipo), escala, abonos e solicitações de um dia. Somente leitura. */
export async function GET(request: Request) {
  if (!(await requireManager())) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 401 });
  const url = new URL(request.url);
  const userId = String(url.searchParams.get('userId') || '').trim();
  const date = String(url.searchParams.get('date') || '').trim();
  if (!userId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'Informe colaborador e data.' }, { status: 400 });
  const employee = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, employeeNumber: true, workDays: true, scheduleStart: true, scheduleEnd: true, scheduleByDay: true } });
  if (!employee) return NextResponse.json({ error: 'Colaborador não encontrado.' }, { status: 404 });
  const from = new Date(`${date}T00:00:00-03:00`); const to = new Date(`${date}T23:59:59.999-03:00`);
  const noon = new Date(`${date}T12:00:00.000Z`);
  const [punches, certificates, requests] = await Promise.all([
    prisma.punch.findMany({ where: { userId, timestamp: { gte: from, lte: to } }, orderBy: { timestamp: 'asc' }, select: { id: true, type: true, timestamp: true, status: true, origin: true, photoData: false, clientId: true } }),
    prisma.medicalCertificate.findMany({ where: { userId, startDate: { lte: noon }, endDate: { gte: noon } }, orderBy: { createdAt: 'asc' }, select: { id: true, type: true, startDate: true, endDate: true, startTime: true, endTime: true, status: true, observation: true, documentName: true, cancelReason: true } }),
    prisma.employeeRequest.findMany({ where: { employeeId: userId, startDate: { lte: to }, endDate: { gte: from }, status: { in: ['PENDENTE', 'APROVADO'] } }, select: { id: true, type: true, status: true, reason: true, details: true, startDate: true, endDate: true, launchedAt: true, documentName: true } }),
  ]);
  const photoIds = new Set((await prisma.punch.findMany({ where: { id: { in: punches.map((p) => p.id) }, photoData: { not: null } }, select: { id: true } })).map((p) => p.id));
  const weekday = new Date(`${date}T12:00:00-03:00`).getUTCDay();
  const daySchedule = resolveDaySchedule(employee.scheduleByDay, employee.workDays, employee.scheduleStart, employee.scheduleEnd, weekday, employee.employeeNumber);
  const workDays = employee.workDays ? parseWorkDays(employee.workDays) : new Set(['SEG', 'TER', 'QUA', 'QUI', 'SEX']);
  const scheduled = Boolean(daySchedule) && isScheduledDay(workDays, CODES[weekday]);
  const valid = punches.filter((p) => p.status === 'VALID');
  const weekSchedule = CODES.map((code, idx) => {
    const s = resolveDaySchedule(employee.scheduleByDay, employee.workDays, employee.scheduleStart, employee.scheduleEnd, idx, employee.employeeNumber);
    return { code, scheduled: Boolean(s) && isScheduledDay(workDays, code), start: s?.start || null, end: s?.end || null };
  });
  return NextResponse.json({
    employee: { id: employee.id, name: employee.name, employeeNumber: employee.employeeNumber },
    date, weekday: CODES[weekday], scheduled, schedule: daySchedule, weekSchedule,
    punches: punches.map((p) => ({ id: p.id, type: p.type, timestamp: p.timestamp, status: p.status, origin: p.origin, manual: p.origin === 'ADJUSTED' || String(p.clientId || '').startsWith('manual-'), hasPhoto: photoIds.has(p.id) })),
    certificates, requests,
    warnings: [
      ...sequenceWarnings(valid),
      ...(!scheduled && valid.length && !certificates.some((c) => c.type === 'DIA_EXTRA' && ['ATIVO', 'APROVADO'].includes(c.status)) ? ['Dia fora da escala da ficha — conte como Extra ou lance Passeio/Evento.'] : []),
    ],
  });
}
