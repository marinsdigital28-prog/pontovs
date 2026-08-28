import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '../../../../lib/auth';

import prisma from '../../../../lib/prisma';

export const dynamic = 'force-dynamic';

function manager(session: any) {
  return Boolean(session?.user?.id && ['ADMIN', 'MANAGER'].includes(String(session?.user?.role || 'ADMIN')));
}

const Query = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  status: z.enum(['TODOS', 'AGUARDANDO_ENVIO', 'SEM_EMAIL']).optional().default('TODOS'),
  search: z.string().trim().max(100).optional().default(''),
});

function startOfDay(value: string | undefined, fallback: Date) {
  if (!value) return fallback;
  const parsed = new Date(`${value}T00:00:00-03:00`);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function endOfDay(value: string | undefined, fallback: Date) {
  if (!value) return fallback;
  const parsed = new Date(`${value}T23:59:59.999-03:00`);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

export async function GET(request: Request) {
  const session = await getServerSession(authOptions as any) as any;
  if (!manager(session)) return NextResponse.json({ error: 'Acesso administrativo necessário.' }, { status: 401 });

  const url = new URL(request.url);
  const parsed = Query.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) return NextResponse.json({ error: 'Filtros inválidos.' }, { status: 400 });

  const now = new Date();
  const fallbackFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const from = startOfDay(parsed.data.from, fallbackFrom);
  const to = endOfDay(parsed.data.to, now);
  const search = parsed.data.search.toLowerCase();

  const punches = await prisma.punch.findMany({
    where: {
      status: 'VALID',
      timestamp: { gte: from, lte: to },
      user: { role: 'EMPLOYEE', ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { employeeNumber: { contains: search, mode: 'insensitive' } }] } : {}) },
    },
    orderBy: { timestamp: 'desc' },
    take: 500,
    select: { id: true, type: true, timestamp: true, origin: true, user: { select: { id: true, name: true, employeeNumber: true, email: true } } },
  });

  const notifications = punches.map((punch) => {
    const hasRealEmail = Boolean(punch.user.email && !punch.user.email.endsWith('@local.invalid'));
    const status = hasRealEmail ? 'AGUARDANDO_ENVIO' : 'SEM_EMAIL';
    return { id: punch.id, punchId: punch.id, status, recipient: punch.user.email, employee: punch.user, type: punch.type, timestamp: punch.timestamp, origin: punch.origin, canResend: false };
  }).filter((item) => parsed.data.status === 'TODOS' || item.status === parsed.data.status);

  return NextResponse.json({
    notifications,
    integration: { provider: 'Gmail', automaticDispatch: false, message: 'O backend ainda não está acoplado ao envio automático.' },
    summary: {
      total: notifications.length,
      awaiting: notifications.filter((item) => item.status === 'AGUARDANDO_ENVIO').length,
      missingEmail: notifications.filter((item) => item.status === 'SEM_EMAIL').length,
    },
  });
}
