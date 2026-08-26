import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '../../../../lib/prisma';
import { appendAuditEvent, consumeRateLimit, getRequestKey, rateLimitResponse } from '../../../../lib/security-controls';

export const dynamic = 'force-dynamic';

const allowedTypes = new Set(['ALL', 'ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA']);
const allowedStatuses = new Set(['ALL', 'VALID', 'REJECTED', 'PENDING']);

function parseBoundary(value: string | null, endOfDay: boolean) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}-03:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function csvCell(value: unknown) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

async function requireManager() {
  const session = (await getServerSession(authOptions as any)) as any;
  const id = session?.user?.id as string | undefined;
  if (!id) return null;
  return prisma.user.findFirst({
    where: { id, active: true, role: { in: ['ADMIN', 'MANAGER'] } },
    select: { id: true },
  });
}

export async function GET(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 401 });
  const rate = await consumeRateLimit(getRequestKey(request, 'admin-punches-read', manager.id), 60, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);

  const url = new URL(request.url);
  const fromValue = url.searchParams.get('from');
  const toValue = url.searchParams.get('to');
  const employeeId = url.searchParams.get('employeeId');
  const type = url.searchParams.get('type') || 'ALL';
  const status = url.searchParams.get('status') || 'VALID';
  const format = url.searchParams.get('format');
  const from = parseBoundary(fromValue, false);
  const to = parseBoundary(toValue, true);

  if ((fromValue && !from) || (toValue && !to)) return NextResponse.json({ error: 'Período inválido' }, { status: 400 });
  if (from && to && from > to) return NextResponse.json({ error: 'A data inicial não pode ser posterior à data final' }, { status: 400 });
  if (!allowedTypes.has(type) || !allowedStatuses.has(status)) return NextResponse.json({ error: 'Filtro inválido' }, { status: 400 });

  const where: any = {};
  if (status !== 'ALL') where.status = status;
  if (type !== 'ALL') where.type = type;
  if (employeeId) where.userId = employeeId;
  if (from || to) where.timestamp = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };

  const punches = await prisma.punch.findMany({
    where,
    orderBy: { timestamp: 'desc' },
    take: 1000,
    select: {
      id: true,
      type: true,
      timestamp: true,
      status: true,
      origin: true,
      user: { select: { id: true, name: true, employeeNumber: true, cpf: true, jobTitle: true, workDays: true, scheduleStart: true, scheduleEnd: true } },
      photoData: true,
    },
  });

  const records = punches.map(({ photoData, ...punch }) => ({ ...punch, hasPhoto: Boolean(photoData) }));
  if (format === 'csv') {
    await appendAuditEvent({ action: 'PUNCHES_EXPORTED', actorId: manager.id, resource: 'Punch', metadata: { from: fromValue, to: toValue, employeeId, type, status, count: records.length } });
    const header = ['Data e hora', 'Colaborador', 'Matrícula', 'Cargo', 'Tipo', 'Status', 'Origem', 'Foto'];
    const rows = records.map((record) => [
      new Date(record.timestamp).toLocaleString('pt-BR'),
      record.user.name,
      record.user.employeeNumber || '',
      record.user.jobTitle || '',
      record.type,
      record.status,
      record.origin,
      record.hasPhoto ? 'Sim' : 'Não',
    ]);
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n');
    return new Response(`\uFEFF${csv}`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="relatorio-ponto-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  return NextResponse.json({ records, total: records.length, limit: 1000 });
}


import { manualClientId, manualPunchTypes, parseManualTimestamp } from '../../../../lib/manual-punch';

export async function POST(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 401 });
  const rate = await consumeRateLimit(getRequestKey(request, 'admin-manual-punch', manager.id), 20, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);

  const body = await request.json().catch(() => null);
  const userId = String(body?.userId ?? '').trim();
  const type = String(body?.type ?? '').trim().toUpperCase();
  const date = String(body?.date ?? '').trim();
  const time = String(body?.time ?? '').trim();
  const reason = String(body?.reason ?? '').trim();
  if (!userId || !manualPunchTypes.includes(type as (typeof manualPunchTypes)[number])) return NextResponse.json({ error: 'Selecione um colaborador e um tipo de marcação válido.' }, { status: 400 });
  if (reason.length < 5) return NextResponse.json({ error: 'Informe o motivo do lançamento com pelo menos 5 caracteres.' }, { status: 400 });
  const timestamp = parseManualTimestamp(date, time);
  if (!timestamp) return NextResponse.json({ error: 'Informe uma data e horário válidos.' }, { status: 400 });

  const employee = await prisma.user.findFirst({ where: { id: userId, role: 'EMPLOYEE' }, select: { id: true, unitId: true, name: true, employeeNumber: true } });
  if (!employee) return NextResponse.json({ error: 'Colaborador não encontrado.' }, { status: 404 });
  const clientId = manualClientId(employee.id, date, time, type);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.punch.findUnique({ where: { clientId }, select: { id: true } });
      if (existing) return { duplicate: true as const, punch: null };
      const punch = await tx.punch.create({ data: { id: crypto.randomUUID(), userId: employee.id, unitId: employee.unitId, type, timestamp, clientTimestamp: timestamp, status: 'VALID', origin: 'ADJUSTED', locationValid: false, clientId }, select: { id: true, type: true, timestamp: true, status: true, origin: true } });
      await tx.punchAudit.create({ data: { id: crypto.randomUUID(), punchId: punch.id, changedById: manager.id, field: 'manual_create', oldValue: null, newValue: `${type} ${timestamp.toISOString()}`, reason } });
      return { duplicate: false as const, punch };
    });
    if (result.duplicate) return NextResponse.json({ error: 'Já existe uma marcação manual igual para este colaborador, data, horário e tipo.' }, { status: 409 });
    await appendAuditEvent({ action: 'PUNCH_CREATED_MANUAL', actorId: manager.id, resource: 'Punch', resourceId: result.punch?.id, metadata: { userId: employee.id, employeeNumber: employee.employeeNumber, type, date, time, reason } });
    return NextResponse.json({ ok: true, punch: result.punch, employee: { name: employee.name, employeeNumber: employee.employeeNumber } }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Não foi possível lançar a marcação manual.' }, { status: 500 });
  }
}
