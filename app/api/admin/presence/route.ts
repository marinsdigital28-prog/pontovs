import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { consumeRateLimit, getRequestKey, rateLimitResponse } from '../../../../lib/security-controls';
import { isDatabaseQuotaExceeded } from '../../../../lib/database-errors';
import { listEmployeeFallbacks } from '../../../../lib/employee-fallback';

export const dynamic = 'force-dynamic';

const dayKeys = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'];

async function requireManager() {
  const session = (await getServerSession(authOptions as any)) as any;
  const id = session?.user?.id as string | undefined;
  if (!id) return null;
  try {
    return await prisma.user.findFirst({ where: { id, active: true, role: { in: ['ADMIN', 'MANAGER'] } }, select: { id: true, role: true } });
  } catch (error) {
    if (isDatabaseQuotaExceeded(error) && ['ADMIN', 'MANAGER'].includes(String(session?.user?.role))) return { id, role: String(session?.user?.role), degraded: true };
    return null;
  }
}

export async function GET(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 401 });
  const rate = await consumeRateLimit(getRequestKey(request, 'admin-presence-read', manager.id), 120, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);

  const now = new Date();
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  let employees;
  try {
    employees = await prisma.user.findMany({ where: { active: true, role: 'EMPLOYEE' }, select: { id: true, name: true, employeeNumber: true, jobTitle: true, workDays: true } });
  } catch (error) {
    if (!isDatabaseQuotaExceeded(error)) throw error;
    employees = listEmployeeFallbacks().map(({ id, name, employeeNumber, jobTitle, workDays }) => ({ id, name, employeeNumber, jobTitle, workDays }));
  }
  const rows = await Promise.all(employees.map(async (employee) => {
    let punch: { id: string; type: string; status: string; timestamp: Date } | null = null;
    try {
      punch = await prisma.punch.findFirst({ where: { userId: employee.id, timestamp: { gte: start, lt: end } }, orderBy: { timestamp: 'desc' }, select: { id: true, type: true, status: true, timestamp: true } });
    } catch (error) {
      if (!isDatabaseQuotaExceeded(error)) throw error;
    }
    const scheduled = (employee.workDays || '').toUpperCase().split(/[,;\s]+/).filter(Boolean).includes(dayKeys[now.getDay()]);
    const status = punch?.status === 'REJECTED' ? 'PENDENTE' : punch?.type === 'SAIDA' ? 'SAIU' : punch ? 'PRESENTE' : scheduled ? 'NAO_MARCOU' : 'FOLGA';
    return { id: employee.id, name: employee.name, employeeNumber: employee.employeeNumber, jobTitle: employee.jobTitle, status, scheduled, latestPunch: punch ? { id: punch.id, type: punch.type, timestamp: punch.timestamp, status: punch.status, hasPhoto: false } : null };
  }));
  const order = { PRESENTE: 0, NAO_MARCOU: 1, PENDENTE: 2, SAIU: 3, FOLGA: 4 } as const;
  rows.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name, 'pt-BR'));
  return NextResponse.json({ degraded: Boolean((manager as any).degraded), date: start.toISOString().slice(0, 10), day: dayKeys[now.getDay()], employees: rows, counts: rows.reduce((acc, row) => { acc[row.status] += 1; return acc; }, { PRESENTE: 0, NAO_MARCOU: 0, PENDENTE: 0, SAIU: 0, FOLGA: 0 }) });
}
