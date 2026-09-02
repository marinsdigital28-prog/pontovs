import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/auth';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import prisma from '../../../../lib/prisma';

export const dynamic = 'force-dynamic';

const APP_TZ = 'America/Sao_Paulo';

function todayKeySP(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${v.year}-${v.month}-${v.day}`;
}

function dayKeyFromTs(ts: Date | string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ts));
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${v.year}-${v.month}-${v.day}`;
}

export async function GET() {
  const session = (await getServerSession(authOptions as any)) as any;
  const employeeId = session?.user?.id as string | undefined;
  const role = String(session?.user?.role || '');
  if (!employeeId || role !== 'EMPLOYEE') {
    return NextResponse.json({ error: 'Faça login como colaborador para consultar o portal.' }, { status: 401 });
  }

  try {
    const employee = await prisma.user.findFirst({
      where: { id: employeeId, active: true, role: 'EMPLOYEE' },
      select: {
        id: true,
        name: true,
        employeeNumber: true,
        jobTitle: true,
        workDays: true,
        scheduleStart: true,
        scheduleEnd: true,
      },
    });
    if (!employee) return NextResponse.json({ error: 'Colaborador não encontrado' }, { status: 404 });

    const since = new Date();
    since.setDate(since.getDate() - 30);
    const today = todayKeySP();

    const punches = await prisma.punch.findMany({
      where: { userId: employee.id, status: 'VALID', timestamp: { gte: since } },
      select: { id: true, type: true, timestamp: true, status: true, photoData: true },
      orderBy: { timestamp: 'desc' },
      take: 100,
    });

    const shaped = punches.map((p) => ({
      id: p.id,
      type: p.type,
      timestamp: p.timestamp,
      status: p.status,
      photoData: dayKeyFromTs(p.timestamp) === today && p.photoData ? p.photoData : null,
      hasPhoto: Boolean(p.photoData),
    }));

    return NextResponse.json({ employee, punches: shaped });
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      return NextResponse.json({ error: 'A consulta está temporariamente indisponível. Tente novamente.' }, { status: 503 });
    }
    console.error('Falha ao consultar histórico do colaborador', error);
    return NextResponse.json({ error: 'A consulta está temporariamente indisponível. Tente novamente.' }, { status: 503 });
  }
}
