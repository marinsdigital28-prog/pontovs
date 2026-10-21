import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { brazilDateKey } from '@/lib/brazil-time';
import { loadHolidayOverrides } from '@/lib/holiday-store';
import { computeTrends } from '@/lib/trends';

export const dynamic = 'force-dynamic';
const dateRe = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const session = await getServerSession(authOptions as any) as any;
  const id = session?.user?.id as string | undefined;
  if (!id || !['ADMIN', 'MANAGER'].includes(String(session?.user?.role))) return NextResponse.json({ error: 'Acesso administrativo necessário.' }, { status: 401 });
  const manager = await prisma.user.findFirst({ where: { id, active: true, role: { in: ['ADMIN', 'MANAGER'] } }, select: { id: true } });
  if (!manager) return NextResponse.json({ error: 'Acesso administrativo necessário.' }, { status: 401 });
  const url = new URL(request.url);
  const today = brazilDateKey();
  const from = dateRe.test(url.searchParams.get('from') || '') ? url.searchParams.get('from')! : `${today.slice(0, 7)}-01`;
  const to = dateRe.test(url.searchParams.get('to') || '') ? url.searchParams.get('to')! : today;
  if (from > to) return NextResponse.json({ error: 'Período inválido.' }, { status: 400 });
  if ((new Date(`${to}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) / 86400000 > 370) return NextResponse.json({ error: 'Escolha um período de até 1 ano.' }, { status: 400 });
  await loadHolidayOverrides();
  const employees = await prisma.user.findMany({ where: { role: 'EMPLOYEE', active: true }, select: { id: true, name: true, employeeNumber: true, jobTitle: true, workDays: true, scheduleStart: true, scheduleEnd: true, scheduleByDay: true }, orderBy: { name: 'asc' }, take: 1000 });
  const punches = await prisma.punch.findMany({ where: { userId: { in: employees.map((e) => e.id) }, timestamp: { gte: new Date(`${from}T00:00:00-03:00`), lte: new Date(`${to}T23:59:59.999-03:00`) }, status: { not: 'REJECTED' } }, select: { userId: true, type: true, timestamp: true, status: true }, take: 100000 });
  const rows = computeTrends({ employees, punches, from, to });
  const totals = rows.reduce((a, r) => ({ lateDays: a.lateDays + r.lateDays, lateMinutes: a.lateMinutes + r.lateMinutes, overtime50Minutes: a.overtime50Minutes + r.overtime50Minutes, overtime100Minutes: a.overtime100Minutes + r.overtime100Minutes, incompleteDays: a.incompleteDays + r.incompleteDays }), { lateDays: 0, lateMinutes: 0, overtime50Minutes: 0, overtime100Minutes: 0, incompleteDays: 0 });
  return NextResponse.json({ from, to, rows, totals, hasSalaryData: false });
}
