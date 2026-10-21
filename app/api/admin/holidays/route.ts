import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { appendAuditEvent } from '@/lib/security-controls';
import { loadHolidayOverrides } from '@/lib/holiday-store';
import { AUTO_HOLIDAYS_FROM, holidaysForYear, SCOPE_LABEL } from '@/lib/holidays';
import { isPeriodClosed } from '@/lib/period-closure';

export const dynamic = 'force-dynamic';

async function requireManager() {
  const session = await getServerSession(authOptions as any) as any;
  const id = session?.user?.id as string | undefined;
  if (!id || !['ADMIN', 'MANAGER'].includes(String(session?.user?.role))) return null;
  return prisma.user.findFirst({ where: { id, active: true, role: { in: ['ADMIN', 'MANAGER'] } }, select: { id: true } });
}

export async function GET(request: Request) {
  if (!(await requireManager())) return NextResponse.json({ error: 'Acesso administrativo necessário.' }, { status: 401 });
  const year = Number(new URL(request.url).searchParams.get('year')) || new Date().getFullYear();
  const overrides = await loadHolidayOverrides();
  return NextResponse.json({ year, autoFrom: AUTO_HOLIDAYS_FROM, overrides, holidays: holidaysForYear(year, overrides).map((h) => ({ ...h, scopeLabel: SCOPE_LABEL[h.scope] })) });
}

const schema = z.object({
  action: z.enum(['ADD', 'REMOVE', 'DISABLE', 'ENABLE']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  name: z.string().trim().min(3).max(120).optional(),
  reason: z.string().trim().min(5).max(300),
});
const ACTION = { ADD: 'FERIADO_LOCAL_ADICIONADO', REMOVE: 'FERIADO_LOCAL_REMOVIDO', DISABLE: 'FERIADO_DESATIVADO', ENABLE: 'FERIADO_ATIVADO' } as const;

/** Ajustes de feriado ficam na trilha de auditoria (append-only, encadeada por hash). Sem alteração de schema. */
export async function POST(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso administrativo necessário.' }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Dados inválidos. Informe data e justificativa (mínimo 5 caracteres).' }, { status: 400 });
  const { action, date, name, reason } = parsed.data;
  if (action === 'ADD' && !name) return NextResponse.json({ error: 'Informe o nome do feriado.' }, { status: 400 });
  if (await isPeriodClosed(date.slice(0, 7))) return NextResponse.json({ error: `O período ${date.slice(0, 7)} está fechado. Reabra antes de mudar feriados desse mês.` }, { status: 409 });
  await appendAuditEvent({ action: ACTION[action], actorId: manager.id, resource: 'Holiday', resourceId: date, metadata: { date, name: name || null, reason } });
  const overrides = await loadHolidayOverrides();
  return NextResponse.json({ ok: true, overrides, holidays: holidaysForYear(Number(date.slice(0, 4)), overrides) });
}
