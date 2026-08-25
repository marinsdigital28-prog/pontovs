import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '../../../../lib/prisma';

export const dynamic = 'force-dynamic';

function startOfDay(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function endOfDay(value: string) {
  const date = new Date(`${value}T23:59:59.999`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function GET(request: Request) {
  const session = (await getServerSession(authOptions as any)) as any;
  const sessionUserId = session?.user?.id as string | undefined;
  if (!sessionUserId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const manager = await prisma.user.findFirst({
    where: { id: sessionUserId, active: true, role: { in: ['ADMIN', 'MANAGER'] } },
    select: { id: true },
  });
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 403 });

  const url = new URL(request.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const employeeId = url.searchParams.get('employeeId');
  const where: any = { status: 'VALID' };

  if (from || to) {
    const gte = from ? startOfDay(from) : null;
    const lte = to ? endOfDay(to) : null;
    if ((from && !gte) || (to && !lte)) return NextResponse.json({ error: 'Período inválido' }, { status: 400 });
    where.timestamp = { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) };
  }
  if (employeeId) where.userId = employeeId;

  const punches = await prisma.punch.findMany({
    where,
    orderBy: { timestamp: 'desc' },
    take: 200,
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

  return NextResponse.json({
    records: punches.map(({ photoData, ...punch }) => ({ ...punch, hasPhoto: Boolean(photoData) })),
  });
}
