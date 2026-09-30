import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { brazilDateKey } from '@/lib/brazil-time';
import { resolveDaySchedule } from '@/lib/day-schedule';
import { appendAuditEvent, consumeRateLimit, getRequestKey, rateLimitResponse } from '@/lib/security-controls';

export const dynamic = 'force-dynamic';

const ORDER = ['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA'] as const;

async function requireManager() {
  const session = (await getServerSession(authOptions as any)) as any;
  const id = session?.user?.id as string | undefined;
  if (!id) return null;
  return prisma.user.findFirst({
    where: { id, active: true, role: { in: ['ADMIN', 'MANAGER'] } },
    select: { id: true },
  });
}

function parseBoundary(value: string | null, endOfDay: boolean) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}-03:00`);
}

function dayKeyOf(ts: Date) {
  return brazilDateKey(ts);
}

/**
 * Corrige no sistema (não mexe no app de marcação):
 * 1) Tipos duplicados no mesmo dia → mantém a 1ª ocorrência, cancela as demais
 * 2) Dia com outras batidas mas sem ENTRADA → cria ENTRADA ajustada (origin ADJUSTED) no horário da jornada
 *    A folha mostra * nas marcações ajustadas.
 */
export async function POST(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 401 });
  const rate = await consumeRateLimit(getRequestKey(request, 'admin-fix-dup-punches', manager.id), 3, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);

  const body = await request.json().catch(() => ({}));
  const fromParam = String(body?.from || '').trim();
  const toParam = String(body?.to || '').trim();

  // Padrão: mês corrente (Brasília)
  const todayKey = brazilDateKey();
  const defaultFrom = `${todayKey.slice(0, 7)}-01`;
  const [y, m] = todayKey.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const defaultTo = `${todayKey.slice(0, 7)}-${String(lastDay).padStart(2, '0')}`;

  const from = parseBoundary(fromParam || defaultFrom, false);
  const to = parseBoundary(toParam || defaultTo, true);
  if (!from || !to || from > to) {
    return NextResponse.json({ error: 'Período inválido. Use from/to no formato YYYY-MM-DD.' }, { status: 400 });
  }

  const punches = await prisma.punch.findMany({
    where: { status: 'VALID', timestamp: { gte: from, lte: to } },
    select: {
      id: true,
      userId: true,
      type: true,
      timestamp: true,
      status: true,
      origin: true,
      user: {
        select: {
          id: true,
          name: true,
          employeeNumber: true,
          unitId: true,
          workDays: true,
          scheduleStart: true,
          scheduleEnd: true,
          scheduleByDay: true,
        },
      },
    },
    orderBy: { timestamp: 'asc' },
  });

  // Agrupa por userId|date
  const byDay = new Map<string, typeof punches>();
  for (const p of punches) {
    const key = `${p.userId}|${dayKeyOf(p.timestamp)}`;
    const list = byDay.get(key) || [];
    list.push(p);
    byDay.set(key, list);
  }

  let duplicatesRejected = 0;
  let entradasCreated = 0;
  const samples: Array<{ employee: string; date: string; action: string }> = [];

  for (const [key, list] of byDay) {
    const [userId, date] = key.split('|');
    const user = list[0]?.user;
    if (!user) continue;

    // --- 1) Duplicatas: 1ª de cada tipo fica; demais REJECTED ---
    const seenType = new Set<string>();
    for (const p of list) {
      const t = String(p.type || '').toUpperCase();
      if (!ORDER.includes(t as (typeof ORDER)[number])) continue;
      if (!seenType.has(t)) {
        seenType.add(t);
        continue;
      }
      await prisma.$transaction(async (tx) => {
        await tx.punch.update({
          where: { id: p.id },
          data: { status: 'REJECTED', origin: 'ADJUSTED' },
        });
        await tx.punchAudit.create({
          data: {
            id: crypto.randomUUID(),
            punchId: p.id,
            changedById: manager.id,
            field: 'status',
            oldValue: p.status,
            newValue: 'REJECTED',
            reason: `Duplicata de ${t} no mesmo dia — mantida apenas a 1ª ocorrência`,
          },
        });
      });
      duplicatesRejected += 1;
      if (samples.length < 40) {
        samples.push({
          employee: `${user.employeeNumber || '—'} ${user.name}`,
          date,
          action: `cancelou ${t} duplicada`,
        });
      }
    }

    // Recarrega tipos válidos após rejeitar duplicatas (em memória)
    const validTypes = new Set(
      list
        .filter((p) => {
          const t = String(p.type || '').toUpperCase();
          // primeira ocorrência de cada tipo ainda é VALID
          return ORDER.includes(t as (typeof ORDER)[number]);
        })
        .reduce((acc: string[], p) => {
          const t = String(p.type || '').toUpperCase();
          if (!acc.includes(t)) acc.push(t);
          return acc;
        }, []),
    );

    // Conta quantas de cada tipo ainda seriam válidas (1ª só)
    const firstByType = new Map<string, (typeof list)[0]>();
    for (const p of list) {
      const t = String(p.type || '').toUpperCase();
      if (!ORDER.includes(t as (typeof ORDER)[number])) continue;
      if (!firstByType.has(t)) firstByType.set(t, p);
    }

    // --- 2) ENTRADA faltante: tem outras batidas do dia, mas não tem ENTRADA ---
    const hasOther =
      firstByType.has('INTERVALO') || firstByType.has('RETORNO') || firstByType.has('SAIDA');
    if (!firstByType.has('ENTRADA') && hasOther) {
      const weekday = new Date(`${date}T12:00:00-03:00`).getDay();
      const schedule = resolveDaySchedule(
        user.scheduleByDay,
        user.workDays,
        user.scheduleStart,
        user.scheduleEnd,
        weekday,
        user.employeeNumber,
      );
      const startHm = schedule?.start || user.scheduleStart?.slice(0, 5) || '08:00';
      let entradaTs = new Date(`${date}T${startHm}:00-03:00`);

      // Se a 1ª batida do dia for antes do horário de entrada, coloca a ENTRADA 1 min antes dela
      const firstOther = [...firstByType.values()].sort(
        (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
      )[0];
      if (firstOther && firstOther.timestamp.getTime() <= entradaTs.getTime()) {
        entradaTs = new Date(firstOther.timestamp.getTime() - 60_000);
      }

      const clientId = `fix-entrada-star-${userId}-${date}`;
      const existing = await prisma.punch.findUnique({ where: { clientId }, select: { id: true } });
      if (!existing) {
        await prisma.$transaction(async (tx) => {
          const punch = await tx.punch.create({
            data: {
              id: crypto.randomUUID(),
              userId,
              unitId: user.unitId || null,
              type: 'ENTRADA',
              timestamp: entradaTs,
              clientTimestamp: entradaTs,
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
              newValue: `ENTRADA* ${entradaTs.toISOString()}`,
              reason: 'ENTRADA faltante ajustada automaticamente (*). Demais batidas do dia existiam sem entrada.',
            },
          });
        });
        entradasCreated += 1;
        if (samples.length < 40) {
          samples.push({
            employee: `${user.employeeNumber || '—'} ${user.name}`,
            date,
            action: `criou ENTRADA* às ${startHm}`,
          });
        }
      }
    }
  }

  const summary = {
    from: fromParam || defaultFrom,
    to: toParam || defaultTo,
    daysScanned: byDay.size,
    duplicatesRejected,
    entradasCreated,
    samples,
  };

  await appendAuditEvent({
    action: 'PUNCHES_DUPLICATE_FIXED',
    actorId: manager.id,
    resource: 'Punch',
    metadata: summary,
  });

  return NextResponse.json({ ok: true, summary });
}
