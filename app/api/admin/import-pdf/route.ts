import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

function clockParts(value: string | undefined) {
  const match = value?.match(/(\d{1,2}):(\d{2})/);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : null;
}

function localTimestamp(date: string, time: string) {
  return new Date(`${date}T${time}-03:00`);
}

export async function POST(request: Request) {
  const token = request.headers.get('x-import-token');
  if (!process.env.ADMIN_PASSWORD || token !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const employees = Array.isArray(body?.employees) ? body.employees : [];
    const punches = Array.isArray(body?.punches) ? body.punches : [];
    if (!employees.length || punches.length > 5000) {
      return NextResponse.json({ error: 'Arquivo de importação inválido' }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const users = new Map<string, string>();
      let employeesUpdated = 0;
      for (const employee of employees) {
        const employeeNumber = String(employee.employeeNumber ?? '').replace(/\D/g, '').padStart(4, '0');
        const name = String(employee.name ?? '').trim();
        if (!employeeNumber || !name || employeeNumber === '0000') continue;
        const jornada = String(employee.jornada ?? '');
        const scheduleStart = clockParts(jornada.split(/[–-]/)[0]);
        const scheduleEnd = clockParts(jornada.split(/[–-]/)[1]);
        const cpf = String(employee.cpf ?? '').replace(/\D/g, '') || null;
        const existing = await tx.user.findUnique({ where: { employeeNumber }, select: { id: true } });
        const user = existing
          ? await tx.user.update({ where: { employeeNumber }, data: { name, cpf, jobTitle: String(employee.jobTitle ?? '').trim() || null, workDays: String(employee.schedule ?? '').trim() || null, scheduleStart, scheduleEnd, active: true }, select: { id: true } })
          : await tx.user.create({ data: { id: crypto.randomUUID(), name, employeeNumber, cpf, email: `${employeeNumber}@employee.local`, role: 'EMPLOYEE', active: true, jobTitle: String(employee.jobTitle ?? '').trim() || null, workDays: String(employee.schedule ?? '').trim() || null, scheduleStart, scheduleEnd }, select: { id: true } });
        users.set(employeeNumber, user.id);
        employeesUpdated += 1;
      }

      let punchesCreated = 0;
      let punchesExisting = 0;
      for (const punch of punches) {
        const employeeNumber = String(punch.employeeNumber ?? '').replace(/\D/g, '').padStart(4, '0');
        const userId = users.get(employeeNumber);
        const time = String(punch.time ?? '');
        const date = String(punch.date ?? '');
        if (!userId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}:\d{2}$/.test(time)) continue;
        const clientId = `pdf-20260826-${employeeNumber}-${date}-${time}-${String(punch.type ?? '')}`;
        const existing = await tx.punch.findUnique({ where: { clientId }, select: { id: true } });
        if (existing) { punchesExisting += 1; continue; }
        await tx.punch.create({ data: { id: crypto.randomUUID(), userId, type: String(punch.type ?? 'ENTRADA'), timestamp: localTimestamp(date, time), clientTimestamp: localTimestamp(date, time), status: 'VALID', origin: 'ADJUSTED', locationValid: false, clientId } });
        punchesCreated += 1;
      }
      return { employeesUpdated, punchesCreated, punchesExisting };
    }, { timeout: 120000 });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error('PDF import failed', error);
    return NextResponse.json({ error: 'Falha ao importar o backup. Nenhuma operação parcial foi confirmada.' }, { status: 500 });
  }
}
