import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/auth';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import prisma from '../../../../lib/prisma';

export const dynamic = 'force-dynamic';

type BackupEmployee = { name: string; employeeNumber: string; jobTitle: string; schedule: string; jornada: string };
type BackupRow = { employeeNumber: string; name: string; date: string; time: string; type: string };

function localBackupHistory(employeeNumber: string) {
  const employees = JSON.parse(readFileSync(join(process.cwd(), 'imports/employees-from-pdf.json'), 'utf8')) as BackupEmployee[];
  const backup = JSON.parse(readFileSync(join(process.cwd(), 'imports/punches-from-pdf.json'), 'utf8')) as { rows: BackupRow[] };
  const source = employees.find(employee => employee.employeeNumber === employeeNumber && employee.employeeNumber !== '0000');
  if (!source) return null;
  const schedule = source.jornada.match(/(\d{2}:\d{2})\s*[–-]\s*(\d{2}:\d{2})/);
  const punches = backup.rows.filter(row => row.employeeNumber === employeeNumber).slice(-100).reverse().map((row, index) => ({ id: `backup-${employeeNumber}-${row.date}-${row.time}-${index}`, type: row.type, timestamp: `${row.date}T${row.time}-03:00` }));
  return { employee: { id: `backup-${employeeNumber}`, name: source.name, employeeNumber: source.employeeNumber, jobTitle: source.jobTitle, workDays: source.schedule.replace(/,\s*\d{2}:\d{2}\s*às\s*\d{2}:\d{2}/i, ''), scheduleStart: schedule?.[1] ?? null, scheduleEnd: schedule?.[2] ?? null }, punches };
}

export async function GET() {
  const session = await getServerSession(authOptions as any) as any;
  const employeeId = session?.user?.id as string | undefined;
  const role = String(session?.user?.role || '');
  if (!employeeId || role !== 'EMPLOYEE') return NextResponse.json({ error: 'Faça login como colaborador para consultar o portal.' }, { status: 401 });

  try {
    const employee = await prisma.user.findFirst({ where: { id: employeeId, active: true, role: 'EMPLOYEE' }, select: { id: true, name: true, employeeNumber: true, jobTitle: true, workDays: true, scheduleStart: true, scheduleEnd: true } });
    if (!employee) return NextResponse.json({ error: 'Colaborador não encontrado' }, { status: 404 });
    const since = new Date(); since.setDate(since.getDate() - 30);
      const punches = await prisma.punch.findMany({ where: { userId: employee.id, status: 'VALID', timestamp: { gte: since } }, select: { id: true, type: true, timestamp: true }, orderBy: { timestamp: 'desc' }, take: 100 });
    return NextResponse.json({ employee, punches });
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      return NextResponse.json({ error: 'A consulta está temporariamente indisponível. Tente novamente.' }, { status: 503 });
    }
    console.error('Falha ao consultar histórico do colaborador', error);
    return NextResponse.json({ error: 'A consulta está temporariamente indisponível. Tente novamente.' }, { status: 503 });
  }
}
