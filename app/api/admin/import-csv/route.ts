import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { appendAuditEvent, consumeRateLimit, getRequestKey, rateLimitResponse } from '../../../../lib/security-controls';
import { INFERRED_SCHEDULES } from '../../../../lib/inferred-schedules';
import { mergeInferredSchedule } from '../../../../lib/schedule-application';

export const dynamic = 'force-dynamic';

const typeAliases: Record<string, string> = { ENTRADA: 'ENTRADA', INTERVALO: 'INTERVALO', SAIDA_ALMOCO: 'INTERVALO', RETORNO: 'RETORNO', VOLTA_ALMOCO: 'RETORNO', SAIDA: 'SAIDA' };

function localTimestamp(date: string, time: string) {
  return new Date(`${date}T${time}-03:00`);
}

export async function POST(request: Request) {
  const session = (await getServerSession(authOptions as any)) as any;
  const actorId = session?.user?.id as string | undefined;
  if (!actorId) return NextResponse.json({ error: 'Sessão de gestor obrigatória.' }, { status: 401 });
  const manager = await prisma.user.findFirst({ where: { id: actorId, active: true, role: { in: ['ADMIN', 'MANAGER'] } }, select: { id: true } });
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor.' }, { status: 403 });
  const rate = await consumeRateLimit(getRequestKey(request, 'admin-import-csv', actorId), 10, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);

  try {
    const body = await request.json();
    const employees = Array.isArray(body?.employees) ? body.employees : [];
    const punches = Array.isArray(body?.punches) ? body.punches : [];
    if (!employees.length || !punches.length || punches.length > 5000) return NextResponse.json({ error: 'O CSV precisa conter colaboradores e marcações válidas.' }, { status: 400 });

    const result = await prisma.$transaction(async (tx) => {
      const users = new Map<string, string>();
      let employeesUpdated = 0;
      let scheduleApplied = 0;
      let rowsIgnored = 0;
      for (const employee of employees) {
        const employeeNumber = String(employee.employeeNumber ?? '').replace(/\D/g, '').padStart(4, '0');
        const name = String(employee.name ?? '').trim();
        if (!/^\d{4,}$/.test(employeeNumber) || employeeNumber === '0000' || !name) { rowsIgnored += 1; continue; }
        const jobTitle = String(employee.jobTitle ?? '').trim() || null;
        const existing = await tx.user.findUnique({ where: { employeeNumber }, select: { id: true, workDays: true, scheduleStart: true, scheduleEnd: true } });
        const inferred = INFERRED_SCHEDULES[employeeNumber];
        const mergedSchedule = inferred ? mergeInferredSchedule(existing, inferred) : null;
        const scheduleData = mergedSchedule ? { workDays: mergedSchedule.workDays, scheduleStart: mergedSchedule.scheduleStart, scheduleEnd: mergedSchedule.scheduleEnd } : {};
        if (mergedSchedule?.applied) scheduleApplied += 1;
        const user = existing
          ? await tx.user.update({ where: { employeeNumber }, data: { name, jobTitle, active: true, ...scheduleData }, select: { id: true } })
          : await tx.user.create({ data: { id: crypto.randomUUID(), name, employeeNumber, email: `${employeeNumber}@employee.local`, role: 'EMPLOYEE', active: true, jobTitle, ...scheduleData }, select: { id: true } });
        users.set(employeeNumber, user.id);
        employeesUpdated += 1;
      }

      let punchesCreated = 0;
      let punchesExisting = 0;
      for (const punch of punches) {
        const employeeNumber = String(punch.employeeNumber ?? '').replace(/\D/g, '').padStart(4, '0');
        const userId = users.get(employeeNumber);
        const rawType = String(punch.type ?? '').trim().toUpperCase();
        const type = typeAliases[rawType] || '';
        const date = String(punch.date ?? '').trim();
        const time = String(punch.time ?? '').trim();
        if (!userId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}:\d{2}$/.test(time) || !type) { rowsIgnored += 1; continue; }
        const sourceId = String(punch.sourceId ?? '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
        const clientId = `csv-${sourceId || `${employeeNumber}-${date}-${time}-${type}`}`;
        const existing = await tx.punch.findUnique({ where: { clientId }, select: { id: true } });
        if (existing) { punchesExisting += 1; continue; }
        await tx.punch.create({ data: { id: crypto.randomUUID(), userId, type, timestamp: localTimestamp(date, time), clientTimestamp: localTimestamp(date, time), status: 'VALID', origin: 'ADJUSTED', locationValid: false, clientId } });
        punchesCreated += 1;
      }
      return { employeesUpdated, scheduleApplied, punchesCreated, punchesExisting, rowsIgnored };
    }, { timeout: 120_000 });

    await appendAuditEvent({ action: 'CSV_IMPORT', actorId, resource: 'Punch', metadata: result });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error('CSV import failed', error);
    return NextResponse.json({ error: 'Falha ao importar CSV. Nenhuma operação parcial foi confirmada.' }, { status: 500 });
  }
}
