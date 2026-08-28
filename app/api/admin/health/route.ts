import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/auth';
import prisma from '../../../../lib/prisma';

export const dynamic = 'force-dynamic';

function manager(session: any) {
  return Boolean(session?.user?.id && ['ADMIN', 'MANAGER'].includes(String(session?.user?.role || 'ADMIN')));
}

export async function GET() {
  const session = await getServerSession(authOptions as any) as any;
  if (!manager(session)) return NextResponse.json({ error: 'Acesso administrativo necessário.' }, { status: 401 });

  let database: 'operacional' | 'indisponivel' = 'operacional';
  let databaseLatencyMs: number | null = null;
  const started = Date.now();
  try { await prisma.$queryRaw`SELECT 1`; databaseLatencyMs = Date.now() - started; } catch { database = 'indisponivel'; }

  const automaticEmail = Boolean(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN);
  const payload = {
    checkedAt: new Date().toISOString(),
    api: 'operacional',
    database,
    databaseLatencyMs,
    notifications: { provider: 'Gmail', automaticDispatch: automaticEmail ? 'configurado' : 'pendente_configuracao' },
  };
  return NextResponse.json(payload, { status: database === 'operacional' ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
