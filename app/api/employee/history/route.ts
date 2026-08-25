import { NextResponse } from 'next/server';
import prisma from '../../../../lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const employeeNumber = url.searchParams.get('employeeNumber')?.trim();
  if (!employeeNumber) return NextResponse.json({ error: 'Matrícula obrigatória' }, { status: 400 });

  const employee = await prisma.user.findFirst({
    where: { employeeNumber, active: true, role: 'EMPLOYEE' },
    select: { id: true, name: true, employeeNumber: true, jobTitle: true, workDays: true, scheduleStart: true, scheduleEnd: true },
  });
  if (!employee) return NextResponse.json({ error: 'Colaborador não encontrado' }, { status: 404 });

  const since = new Date();
  since.setDate(since.getDate() - 30);
  const punches = await prisma.punch.findMany({
    where: { userId: employee.id, status: 'VALID', timestamp: { gte: since } },
    select: { id: true, type: true, timestamp: true },
    orderBy: { timestamp: 'desc' },
    take: 100,
  });
  return NextResponse.json({ employee, punches });
}
