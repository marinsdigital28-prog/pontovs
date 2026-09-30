import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { brazilDateKey } from '@/lib/brazil-time';
import { resolveDaySchedule, type DaySchedule } from '@/lib/day-schedule';
import { appendAuditEvent, consumeRateLimit, getRequestKey, rateLimitResponse } from '@/lib/security-controls';

export const dynamic = 'force-dynamic';

const ORDER = ['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA'] as const;
type PunchType = (typeof ORDER)[number];

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

function atHm(date: string, hm: string) {
  const [h, m] = hm.split(':').map(Number);
  return new Date(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-03:00`);
}

function clampBetween(ts: Date, minTs: Date | null, maxTs: Date | null) {
  let t = ts.getTime();
  if (minTs && t <= minTs.getTime()) t = minTs.getTime() + 60_000;
  if (maxTs && t >= maxTs.getTime()) t = maxTs.getTime() - 60_000;
  return new Date(t);
}

function midPoint(a: Date, b: Date) {
  return new Date(Math.round((a.getTime() + b.getTime()) / 2));
}

/**
 * Correção mega-inteligente (só no sistema, não no app de marcação):
 * 1) Cancela 2ª+ ocorrência do mesmo tipo no dia
 * 2) Completa a sequência do dia conforme a jornada:
 *    - FULL: ENTRADA → INTERVALO → RETORNO → SAIDA
 *    - HALF: ENTRADA → SAIDA
 * 3) Marcações criadas ficam origin=ADJUSTED (folha mostra *)
 * 4) Não inventa dia inteiro sem nenhuma batida; não força SAÍDA no dia corrente ainda em andamento
 */
export async function POST(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 401 });
  const rate = await consumeRateLimit(getRequestKey(request, 'admin-fix-dup-punches', manager.id), 3, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);

  const body = await request.json().catch(() => ({}));
  const fromParam = String(body?.from || '').trim();
  const toParam = String(body?.to || '').trim();

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

  const byDay = new Map<string, typeof punches>();
  for (const p of punches) {
    const key = `${p.userId}|${brazilDateKey(p.timestamp)}`;
    const list = byDay.get(key) || [];
    list.push(p);
    byDay.set(key, list);
  }

  let duplicatesRejected = 0;
  let created = 0;
  let entradasCreated = 0;
  let intervalosCreated = 0;
  let retornosCreated = 0;
  let saidasCreated = 0;
  const samples: Array<{ employee: string; date: string; action: string }> = [];

  async function rejectDuplicate(
    punch: (typeof punches)[0],
    type: string,
    employeeLabel: string,
    date: string,
  ) {
    await prisma.$transaction(async (tx) => {
      await tx.punch.update({
        where: { id: punch.id },
        data: { status: 'REJECTED', origin: 'ADJUSTED' },
      });
      await tx.punchAudit.create({
        data: {
          id: crypto.randomUUID(),
          punchId: punch.id,
          changedById: manager!.id,
          field: 'status',
          oldValue: punch.status,
          newValue: 'REJECTED',
          reason: `Duplicata de ${type} no mesmo dia — mantida apenas a 1ª ocorrência`,
        },
      });
    });
    duplicatesRejected += 1;
    if (samples.length < 60) {
      samples.push({ employee: employeeLabel, date, action: `cancelou ${type} duplicada` });
    }
  }

  async function createAdjusted(params: {
    userId: string;
    unitId: string | null;
    type: PunchType;
    timestamp: Date;
    date: string;
    employeeLabel: string;
    reason: string;
  }) {
    const clientId = `fix-star-${params.type.toLowerCase()}-${params.userId}-${params.date}`;
    const existing = await prisma.punch.findUnique({ where: { clientId }, select: { id: true, status: true } });
    if (existing) {
      if (existing.status !== 'VALID') {
        await prisma.punch.update({
          where: { id: existing.id },
          data: {
            status: 'VALID',
            origin: 'ADJUSTED',
            type: params.type,
            timestamp: params.timestamp,
            clientTimestamp: params.timestamp,
          },
        });
      }
      return false;
    }
    await prisma.$transaction(async (tx) => {
      const punch = await tx.punch.create({
        data: {
          id: crypto.randomUUID(),
          userId: params.userId,
          unitId: params.unitId,
          type: params.type,
          timestamp: params.timestamp,
          clientTimestamp: params.timestamp,
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
          changedById: manager!.id,
          field: 'manual_create',
          oldValue: null,
          newValue: `${params.type}* ${params.timestamp.toISOString()}`,
          reason: params.reason,
        },
      });
    });
    created += 1;
    if (params.type === 'ENTRADA') entradasCreated += 1;
    if (params.type === 'INTERVALO') intervalosCreated += 1;
    if (params.type === 'RETORNO') retornosCreated += 1;
    if (params.type === 'SAIDA') saidasCreated += 1;
    if (samples.length < 60) {
      samples.push({
        employee: params.employeeLabel,
        date: params.date,
        action: `criou ${params.type}*`,
      });
    }
    return true;
  }

  for (const [key, list] of byDay) {
    const [userId, date] = key.split('|');
    const user = list[0]?.user;
    if (!user) continue;
    const employeeLabel = `${user.employeeNumber || '—'} ${user.name}`;
    const isPastDay = date < todayKey;
    const isToday = date === todayKey;

    // 1) Duplicatas → só a 1ª de cada tipo
    const firstByType = new Map<string, (typeof list)[0]>();
    for (const p of list) {
      const t = String(p.type || '').toUpperCase();
      if (!ORDER.includes(t as PunchType)) continue;
      if (!firstByType.has(t)) firstByType.set(t, p);
      else await rejectDuplicate(p, t, employeeLabel, date);
    }

    // Sem batida válida restante → nada a completar
    if (!firstByType.size) continue;

    const weekday = new Date(`${date}T12:00:00-03:00`).getDay();
    const schedule: DaySchedule | null = resolveDaySchedule(
      user.scheduleByDay,
      user.workDays,
      user.scheduleStart,
      user.scheduleEnd,
      weekday,
      user.employeeNumber,
    );
    const mode = schedule?.mode === 'HALF' ? 'HALF' : 'FULL';
    const startHm = schedule?.start || user.scheduleStart?.slice(0, 5) || '08:00';
    const endHm = schedule?.end || user.scheduleEnd?.slice(0, 5) || (mode === 'HALF' ? '12:00' : '17:00');

    const tsOf = (type: string) => firstByType.get(type)?.timestamp ?? null;

    // 2) ENTRADA faltante
    if (!firstByType.has('ENTRADA')) {
      let entradaTs = atHm(date, startHm);
      const firstOther = [...firstByType.values()].sort(
        (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
      )[0];
      if (firstOther && firstOther.timestamp.getTime() <= entradaTs.getTime()) {
        entradaTs = new Date(firstOther.timestamp.getTime() - 60_000);
      }
      const ok = await createAdjusted({
        userId,
        unitId: user.unitId || null,
        type: 'ENTRADA',
        timestamp: entradaTs,
        date,
        employeeLabel,
        reason: 'ENTRADA* faltante — havia outras batidas no dia sem entrada.',
      });
      if (ok) {
        firstByType.set('ENTRADA', {
          id: 'virtual',
          userId,
          type: 'ENTRADA',
          timestamp: entradaTs,
          status: 'VALID',
          origin: 'ADJUSTED',
          user,
        } as any);
      }
    }

    const entradaTs = tsOf('ENTRADA');
    const intervaloTs = tsOf('INTERVALO');
    const retornoTs = tsOf('RETORNO');
    const saidaTs = tsOf('SAIDA');

    // 3) HALF: só ENTRADA + SAIDA
    if (mode === 'HALF') {
      // Se tiver INTERVALO/RETORNO “a mais” em meio expediente, não apaga — só completa SAIDA
      if (entradaTs && !saidaTs && (isPastDay || (isToday && false))) {
        // for today half: only auto SAIDA if past end + 30min — skip on current ongoing; past days always
      }
      if (entradaTs && !saidaTs && isPastDay) {
        let saida = atHm(date, endHm);
        if (saida.getTime() <= entradaTs.getTime()) saida = new Date(entradaTs.getTime() + 4 * 60 * 60_000);
        await createAdjusted({
          userId,
          unitId: user.unitId || null,
          type: 'SAIDA',
          timestamp: saida,
          date,
          employeeLabel,
          reason: 'SAIDA* faltante (meio expediente) — jornada incompleta no sistema.',
        });
      }
      continue;
    }

    // 4) FULL: completar INTERVALO / RETORNO / SAIDA
    // Caso clássico: só E + S → cria I e R no almoço (12h–13h) entre entrada e saída
    if (entradaTs && saidaTs && !intervaloTs && !retornoTs) {
      let lunchStart = atHm(date, '12:00');
      let lunchEnd = atHm(date, '13:00');
      lunchStart = clampBetween(lunchStart, entradaTs, saidaTs);
      lunchEnd = clampBetween(lunchEnd, lunchStart, saidaTs);
      if (lunchEnd.getTime() - lunchStart.getTime() < 20 * 60_000) {
        // janela apertada: metade do período
        const mid = midPoint(entradaTs, saidaTs);
        lunchStart = new Date(mid.getTime() - 30 * 60_000);
        lunchEnd = new Date(mid.getTime() + 30 * 60_000);
        lunchStart = clampBetween(lunchStart, entradaTs, saidaTs);
        lunchEnd = clampBetween(lunchEnd, lunchStart, saidaTs);
      }
      await createAdjusted({
        userId,
        unitId: user.unitId || null,
        type: 'INTERVALO',
        timestamp: lunchStart,
        date,
        employeeLabel,
        reason: 'INTERVALO* faltante — dia com entrada e saída sem almoço registrado.',
      });
      firstByType.set('INTERVALO', { timestamp: lunchStart } as any);
      await createAdjusted({
        userId,
        unitId: user.unitId || null,
        type: 'RETORNO',
        timestamp: lunchEnd,
        date,
        employeeLabel,
        reason: 'RETORNO* faltante — dia com entrada e saída sem almoço registrado.',
      });
      firstByType.set('RETORNO', { timestamp: lunchEnd } as any);
    }

    // INTERVALO faltante mas tem RETORNO (ou caminho até saída)
    if (entradaTs && !firstByType.has('INTERVALO') && (firstByType.has('RETORNO') || firstByType.has('SAIDA'))) {
      const upper = tsOf('RETORNO') || tsOf('SAIDA');
      let lunchStart = atHm(date, '12:00');
      lunchStart = clampBetween(lunchStart, entradaTs, upper);
      await createAdjusted({
        userId,
        unitId: user.unitId || null,
        type: 'INTERVALO',
        timestamp: lunchStart,
        date,
        employeeLabel,
        reason: 'INTERVALO* faltante — sequência do dia incompleta.',
      });
      firstByType.set('INTERVALO', { timestamp: lunchStart } as any);
    }

    // RETORNO faltante mas tem INTERVALO
    if (firstByType.has('INTERVALO') && !firstByType.has('RETORNO') && (firstByType.has('SAIDA') || isPastDay)) {
      const iTs = tsOf('INTERVALO')!;
      const upper = tsOf('SAIDA');
      let lunchEnd = new Date(iTs.getTime() + 60 * 60_000);
      if (upper) lunchEnd = clampBetween(lunchEnd, iTs, upper);
      else if (entradaTs) {
        const end = atHm(date, endHm);
        lunchEnd = clampBetween(lunchEnd, iTs, end);
      }
      await createAdjusted({
        userId,
        unitId: user.unitId || null,
        type: 'RETORNO',
        timestamp: lunchEnd,
        date,
        employeeLabel,
        reason: 'RETORNO* faltante — intervalo registrado sem retorno.',
      });
      firstByType.set('RETORNO', { timestamp: lunchEnd } as any);
    }

    // SAIDA faltante (só dias passados — hoje pode ainda estar em jornada)
    if (entradaTs && !firstByType.has('SAIDA') && isPastDay) {
      let saida = atHm(date, endHm);
      const lastBefore =
        tsOf('RETORNO') || tsOf('INTERVALO') || entradaTs;
      if (lastBefore && saida.getTime() <= lastBefore.getTime()) {
        saida = new Date(lastBefore.getTime() + 60 * 60_000);
      }
      await createAdjusted({
        userId,
        unitId: user.unitId || null,
        type: 'SAIDA',
        timestamp: saida,
        date,
        employeeLabel,
        reason: 'SAIDA* faltante — jornada do dia incompleta no sistema.',
      });
    }
  }

  const summary = {
    from: fromParam || defaultFrom,
    to: toParam || defaultTo,
    daysScanned: byDay.size,
    duplicatesRejected,
    created,
    entradasCreated,
    intervalosCreated,
    retornosCreated,
    saidasCreated,
    samples,
  };

  await appendAuditEvent({
    action: 'PUNCHES_SEQUENCE_FIXED',
    actorId: manager.id,
    resource: 'Punch',
    metadata: summary,
  });

  return NextResponse.json({ ok: true, summary });
}
