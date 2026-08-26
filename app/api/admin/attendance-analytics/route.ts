import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '../../../../lib/prisma';
import { analyzeAttendance, dateKeysBetween, localDateKey, rangeEndExclusive, rangeStart } from '../../../../lib/attendance-analytics';
import { consumeRateLimit, getRequestKey, rateLimitResponse } from '../../../../lib/security-controls';

export const dynamic = 'force-dynamic';

async function requireManager() {
  const session = (await getServerSession(authOptions as any)) as any;
  const id = session?.user?.id as string | undefined;
  if (!id) return null;
  return prisma.user.findFirst({ where: { id, active: true, role: { in: ['ADMIN', 'MANAGER'] } }, select: { id: true } });
}

function validDate(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

export async function GET(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 401 });
  const rate = await consumeRateLimit(getRequestKey(request, 'admin-attendance-analytics', manager.id), 60, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);

  const url = new URL(request.url);
  const today = localDateKey(new Date());
  const from = url.searchParams.get('from') || `${today.slice(0, 7)}-01`;
  const to = url.searchParams.get('to') || today;
  const employeeId = url.searchParams.get('employeeId') || '';
  if (!validDate(from) || !validDate(to)) return NextResponse.json({ error: 'Informe datas válidas.' }, { status: 400 });
  const days = dateKeysBetween(from, to);
  if (from > to || days.length > 62) return NextResponse.json({ error: 'Selecione um período de até 62 dias.' }, { status: 400 });

  const employees = await prisma.user.findMany({
    where: { active: true, role: 'EMPLOYEE', ...(employeeId ? { id: employeeId } : {}) },
    select: { id: true, name: true, employeeNumber: true, workDays: true, scheduleStart: true },
    orderBy: { name: 'asc' },
  });
  const punches = employees.length ? await prisma.punch.findMany({
    where: { userId: { in: employees.map((employee) => employee.id) }, status: 'VALID', timestamp: { gte: rangeStart(from), lt: rangeEndExclusive(to) } },
    select: { userId: true, type: true, timestamp: true },
    orderBy: { timestamp: 'asc' },
  }) : [];

  return NextResponse.json({
    ...analyzeAttendance(employees, punches, from, to),
    employees: employees.map(({ id, name, employeeNumber }) => ({ id, name, employeeNumber })),
  });
}
