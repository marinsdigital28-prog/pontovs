import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '../../../../lib/prisma';

export const dynamic = 'force-dynamic';

const allowedTypes = new Set(['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA']);
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
      user: { select: { id: true, name: true, employeeNumber: true, jobTitle: true } },
      photoData: true,
    },
  });

  const records = punches.map(({ photoData, ...punch }) => ({ ...punch, hasPhoto: Boolean(photoData) }));
  if (format === 'csv') {
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
