import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '../../../../lib/prisma';
import { appendAuditEvent } from '../../../../lib/security-controls';

export const dynamic = 'force-dynamic';

/** Dias completos do backup de 26/08 — NÃO inclui 25/08 incompleto nem dias vazios. */
const VIVIANE_COMPLETE_DAYS: Array<{ date: string; punches: Array<{ time: string; type: 'ENTRADA' | 'INTERVALO' | 'RETORNO' | 'SAIDA' }> }> = [
  { date: '2026-08-03', punches: [
    { time: '08:00', type: 'ENTRADA' }, { time: '11:57', type: 'INTERVALO' }, { time: '12:57', type: 'RETORNO' }, { time: '17:01', type: 'SAIDA' },
  ]},
  { date: '2026-08-04', punches: [
    { time: '08:00', type: 'ENTRADA' }, { time: '11:56', type: 'INTERVALO' }, { time: '12:59', type: 'RETORNO' }, { time: '17:00', type: 'SAIDA' },
  ]},
  { date: '2026-08-05', punches: [
    { time: '07:54', type: 'ENTRADA' }, { time: '11:58', type: 'INTERVALO' }, { time: '12:58', type: 'RETORNO' }, { time: '17:01', type: 'SAIDA' },
  ]},
  { date: '2026-08-06', punches: [
    { time: '07:54', type: 'ENTRADA' }, { time: '12:02', type: 'INTERVALO' }, { time: '13:02', type: 'RETORNO' }, { time: '17:01', type: 'SAIDA' },
  ]},
  { date: '2026-08-07', punches: [
    { time: '07:56', type: 'ENTRADA' }, { time: '12:01', type: 'INTERVALO' }, { time: '13:03', type: 'RETORNO' }, { time: '16:59', type: 'SAIDA' },
  ]},
  { date: '2026-08-10', punches: [
    { time: '07:58', type: 'ENTRADA' }, { time: '11:56', type: 'INTERVALO' }, { time: '12:59', type: 'RETORNO' }, { time: '17:01', type: 'SAIDA' },
  ]},
  { date: '2026-08-11', punches: [
    { time: '07:53', type: 'ENTRADA' }, { time: '12:02', type: 'INTERVALO' }, { time: '13:02', type: 'RETORNO' }, { time: '16:59', type: 'SAIDA' },
  ]},
  { date: '2026-08-12', punches: [
    { time: '07:53', type: 'ENTRADA' }, { time: '11:56', type: 'INTERVALO' }, { time: '12:58', type: 'RETORNO' }, { time: '17:00', type: 'SAIDA' },
  ]},
  { date: '2026-08-13', punches: [
    { time: '07:56', type: 'ENTRADA' }, { time: '12:00', type: 'INTERVALO' }, { time: '13:02', type: 'RETORNO' }, { time: '17:01', type: 'SAIDA' },
  ]},
  { date: '2026-08-14', punches: [
    { time: '07:53', type: 'ENTRADA' }, { time: '12:00', type: 'INTERVALO' }, { time: '13:00', type: 'RETORNO' }, { time: '17:00', type: 'SAIDA' },
  ]},
  { date: '2026-08-17', punches: [
    { time: '07:58', type: 'ENTRADA' }, { time: '11:59', type: 'INTERVALO' }, { time: '12:59', type: 'RETORNO' }, { time: '17:04', type: 'SAIDA' },
  ]},
  { date: '2026-08-18', punches: [
    { time: '07:56', type: 'ENTRADA' }, { time: '12:01', type: 'INTERVALO' }, { time: '13:00', type: 'RETORNO' }, { time: '17:01', type: 'SAIDA' },
  ]},
  { date: '2026-08-19', punches: [
    { time: '08:00', type: 'ENTRADA' }, { time: '12:00', type: 'INTERVALO' }, { time: '13:01', type: 'RETORNO' }, { time: '17:01', type: 'SAIDA' },
  ]},
  { date: '2026-08-20', punches: [
    { time: '07:58', type: 'ENTRADA' }, { time: '12:03', type: 'INTERVALO' }, { time: '13:02', type: 'RETORNO' }, { time: '16:59', type: 'SAIDA' },
  ]},
  { date: '2026-08-21', punches: [
    { time: '07:56', type: 'ENTRADA' }, { time: '11:56', type: 'INTERVALO' }, { time: '12:58', type: 'RETORNO' }, { time: '17:02', type: 'SAIDA' },
  ]},
  { date: '2026-08-24', punches: [
    { time: '08:00', type: 'ENTRADA' }, { time: '12:03', type: 'INTERVALO' }, { time: '13:05', type: 'RETORNO' }, { time: '17:03', type: 'SAIDA' },
  ]},
];

function dayRangeBrazil(date: string) {
  const start = new Date(`${date}T00:00:00.000-03:00`);
  const end = new Date(`${date}T23:59:59.999-03:00`);
  return { start, end };
}

async function requireManager() {
  const session = (await getServerSession(authOptions as any)) as any;
  const id = session?.user?.id as string | undefined;
  if (!id) return null;
  return prisma.user.findFirst({
    where: { id, active: true, role: { in: ['ADMIN', 'MANAGER'] } },
    select: { id: true, role: true },
  });
}

export async function POST() {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 401 });

  const employee = await prisma.user.findFirst({
    where: { employeeNumber: '1404', role: 'EMPLOYEE' },
    select: { id: true, name: true, employeeNumber: true, unitId: true },
  });
  if (!employee) return NextResponse.json({ error: 'Colaborador 1404 não encontrado' }, { status: 404 });

  let replacedDays = 0;
  let createdPunches = 0;
  let rejectedOld = 0;

  await prisma.$transaction(async (tx) => {
    for (const day of VIVIANE_COMPLETE_DAYS) {
      const { start, end } = dayRangeBrazil(day.date);
      const existing = await tx.punch.findMany({
        where: {
          userId: employee.id,
          status: 'VALID',
          timestamp: { gte: start, lte: end },
        },
        select: { id: true, type: true, timestamp: true },
      });

      for (const punch of existing) {
        await tx.punch.update({
          where: { id: punch.id },
          data: { status: 'REJECTED' },
        });
        await tx.punchAudit.create({
          data: {
            id: crypto.randomUUID(),
            punchId: punch.id,
            changedById: manager.id,
            field: 'status',
            oldValue: 'VALID',
            newValue: 'REJECTED',
            reason: `Sobrescrito pelo restore do backup 26/08 (dia ${day.date})`,
          },
        });
        rejectedOld += 1;
      }

      for (const item of day.punches) {
        const timestamp = new Date(`${day.date}T${item.time}:00-03:00`);
        const clientId = `restore-1404-${day.date}-${item.time}-${item.type}`;
        const already = await tx.punch.findUnique({ where: { clientId }, select: { id: true } });
        if (already) continue;

        const punch = await tx.punch.create({
          data: {
            id: crypto.randomUUID(),
            userId: employee.id,
            unitId: employee.unitId,
            type: item.type,
            timestamp,
            clientTimestamp: timestamp,
            status: 'VALID',
            origin: 'ADJUSTED',
            locationValid: false,
            clientId,
          },
          select: { id: true },
        });
        await tx.punchAudit.create({
          data: {
            id: crypto.randomUUID(),
            punchId: punch.id,
            changedById: manager.id,
            field: 'manual_create',
            oldValue: null,
            newValue: `${item.type} ${timestamp.toISOString()}`,
            reason: `Restore backup 26/08 — Viviane 1404 dia ${day.date}`,
          },
        });
        createdPunches += 1;
      }
      replacedDays += 1;
    }
  });

  await appendAuditEvent({
    action: 'PUNCH_RESTORE_VIVIANE_AUGUST',
    actorId: manager.id,
    resource: 'Punch',
    metadata: {
      employeeNumber: '1404',
      replacedDays,
      createdPunches,
      rejectedOld,
      note: '25/08 incompleto e dias vazios preservados',
    },
  });

  return NextResponse.json({
    ok: true,
    employee: { name: employee.name, employeeNumber: employee.employeeNumber },
    replacedDays,
    createdPunches,
    rejectedOld,
    preserved: '25/08 (só entrada) e 26–28/08, 31/08 sem alteração',
  });
}
