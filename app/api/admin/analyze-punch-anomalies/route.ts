import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { brazilDateKey } from '@/lib/brazil-time';
import { resolveDaySchedule } from '@/lib/day-schedule';
import { consumeRateLimit, getRequestKey, rateLimitResponse } from '@/lib/security-controls';

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

function brazilHm(date: Date) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function brazilMinutes(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const hour = Number(v.hour === '24' ? '0' : v.hour);
  return hour * 60 + Number(v.minute);
}

function parseHm(hm?: string | null) {
  if (!hm || !/^\d{2}:\d{2}/.test(hm)) return null;
  return Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
}

export type AnomalyKind =
  | 'UMA_BATIDA'
  | 'DUAS_BATIDAS_CURTAS'
  | 'FORA_HORARIO_CEDO'
  | 'FORA_HORARIO_TARDE'
  | 'SO_AJUSTADAS'
  | 'MISTURA_AJUSTADA'
  | 'TIPOS_ESTRANHOS'
  | 'SEM_ENTRADA'
  | 'DUPLICATA_ATIVA'
  | 'MEIO_EXPEDIENTE';

/**
 * Só identifica — não altera nada.
 * Útil para achar passeio, batida bem cedo, 1 marcação, marcações estranhas/já corrigidas.
 */
export async function POST(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 401 });
  const rate = await consumeRateLimit(getRequestKey(request, 'admin-analyze-anomalies', manager.id), 10, 60_000);
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
    return NextResponse.json({ error: 'Período inválido. Use from/to YYYY-MM-DD.' }, { status: 400 });
  }

  // Inclui VALID e REJECTED para ver o que já foi “corrigido”
  const punches = await prisma.punch.findMany({
    where: {
      timestamp: { gte: from, lte: to },
      status: { in: ['VALID', 'REJECTED'] },
    },
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
          workDays: true,
          scheduleStart: true,
          scheduleEnd: true,
          scheduleByDay: true,
        },
      },
    },
    orderBy: { timestamp: 'asc' },
  });

  type DayBucket = {
    userId: string;
    date: string;
    user: (typeof punches)[0]['user'];
    valid: typeof punches;
    rejected: typeof punches;
  };

  const byDay = new Map<string, DayBucket>();
  for (const p of punches) {
    const date = brazilDateKey(p.timestamp);
    const key = `${p.userId}|${date}`;
    let bucket = byDay.get(key);
    if (!bucket) {
      bucket = { userId: p.userId, date, user: p.user, valid: [], rejected: [] };
      byDay.set(key, bucket);
    }
    if (p.status === 'VALID') bucket.valid.push(p);
    else bucket.rejected.push(p);
  }

  const findings: Array<{
    employeeNumber: string;
    name: string;
    date: string;
    mode: 'FULL' | 'HALF' | '—';
    schedule: string;
    kinds: AnomalyKind[];
    validCount: number;
    rejectedCount: number;
    spanMin: number | null;
    marks: string;
    note: string;
  }> = [];

  let countUma = 0;
  let countCedo = 0;
  let countAjustada = 0;
  let countEvento = 0;
  let countMeio = 0;

  for (const bucket of byDay.values()) {
    const { user, date, valid, rejected } = bucket;
    if (!user) continue;

    const weekday = new Date(`${date}T12:00:00-03:00`).getDay();
    const schedule = resolveDaySchedule(
      user.scheduleByDay,
      user.workDays,
      user.scheduleStart,
      user.scheduleEnd,
      weekday,
      user.employeeNumber,
    );
    const mode: 'FULL' | 'HALF' | '—' = schedule?.mode === 'HALF' ? 'HALF' : schedule ? 'FULL' : '—';
    const startHm = schedule?.start || user.scheduleStart?.slice(0, 5) || '08:00';
    const endHm = schedule?.end || user.scheduleEnd?.slice(0, 5) || '17:00';
    const startMin = parseHm(startHm) ?? 8 * 60;
    const endMin = parseHm(endHm) ?? 17 * 60;

    // 1ª de cada tipo válido
    const firstByType = new Map<string, (typeof valid)[0]>();
    const typeCounts = new Map<string, number>();
    for (const p of valid) {
      const t = String(p.type || '').toUpperCase();
      typeCounts.set(t, (typeCounts.get(t) || 0) + 1);
      if (!firstByType.has(t)) firstByType.set(t, p);
    }
    const unique = [...firstByType.values()].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    );
    const uniqueCount = unique.length;
    const spanMin =
      uniqueCount >= 2
        ? Math.round((unique[uniqueCount - 1].timestamp.getTime() - unique[0].timestamp.getTime()) / 60_000)
        : uniqueCount === 1
          ? 0
          : null;

    const kinds: AnomalyKind[] = [];
    const notes: string[] = [];

    if (mode === 'HALF') {
      kinds.push('MEIO_EXPEDIENTE');
      countMeio += 1;
    }

    // Duplicata ainda VALID
    for (const [t, n] of typeCounts) {
      if (n > 1) {
        kinds.push('DUPLICATA_ATIVA');
        notes.push(`${n}× ${t} ainda válidas`);
        break;
      }
    }

    const adjustedValid = valid.filter((p) => p.origin === 'ADJUSTED');
    const adjustedRejected = rejected.filter((p) => p.origin === 'ADJUSTED');
    if (valid.length > 0 && adjustedValid.length === valid.length) {
      kinds.push('SO_AJUSTADAS');
      countAjustada += 1;
      notes.push('todas as batidas válidas são ajustadas (*)');
    } else if (adjustedValid.length || adjustedRejected.length) {
      kinds.push('MISTURA_AJUSTADA');
      notes.push(
        `${adjustedValid.length} válida(s)* + ${adjustedRejected.length} rejeitada(s) ajustada(s)`,
      );
    }

    if (uniqueCount === 1) {
      kinds.push('UMA_BATIDA');
      countUma += 1;
      notes.push('só 1 tipo de marcação no dia — possível passeio/evento');
    } else if (uniqueCount === 2 && spanMin !== null && spanMin < 6 * 60) {
      kinds.push('DUAS_BATIDAS_CURTAS');
      countEvento += 1;
      notes.push(`2 batidas em ${spanMin} min — possível evento/parcial`);
    }

    // Fora do horário: bem cedo (mais de 90 min antes do início) ou bem tarde (mais de 90 min após o fim)
    for (const p of unique) {
      const mins = brazilMinutes(p.timestamp);
      if (mins < startMin - 90) {
        kinds.push('FORA_HORARIO_CEDO');
        countCedo += 1;
        notes.push(`${p.type} às ${brazilHm(p.timestamp)} (jornada começa ${startHm})`);
        break;
      }
      if (mins > endMin + 90) {
        kinds.push('FORA_HORARIO_TARDE');
        notes.push(`${p.type} às ${brazilHm(p.timestamp)} (jornada termina ${endHm})`);
        break;
      }
    }

    if (uniqueCount > 0 && !firstByType.has('ENTRADA')) {
      kinds.push('SEM_ENTRADA');
      notes.push('há batidas sem ENTRADA');
    }

    // Tipos fora da ordem típica (ex.: SAIDA antes de qualquer ENTRADA no relógio)
    if (uniqueCount >= 2) {
      const firstType = String(unique[0].type).toUpperCase();
      if (firstType !== 'ENTRADA' && firstType !== 'INTERVALO') {
        kinds.push('TIPOS_ESTRANHOS');
        notes.push(`primeira batida do dia é ${firstType}`);
      }
    }

    // Só reporta se houver algo relevante (não lista dia normal OK)
    const interesting = kinds.filter((k) => k !== 'MEIO_EXPEDIENTE');
    if (!interesting.length && mode === 'HALF') continue; // meio exp. sozinho sem anomalia não lista
    if (!interesting.length) continue;

    const marks = [
      ...valid.map(
        (p) =>
          `${p.type}${p.origin === 'ADJUSTED' ? '*' : ''} ${brazilHm(p.timestamp)}${p.status !== 'VALID' ? ' (rej)' : ''}`,
      ),
      ...rejected.slice(0, 4).map(
        (p) => `${p.type}${p.origin === 'ADJUSTED' ? '*' : ''} ${brazilHm(p.timestamp)} (rej)`,
      ),
    ].join(' · ');

    findings.push({
      employeeNumber: user.employeeNumber || '—',
      name: user.name,
      date,
      mode,
      schedule: schedule ? `${startHm}–${endHm}` : 'sem escala',
      kinds: [...new Set(kinds)],
      validCount: valid.length,
      rejectedCount: rejected.length,
      spanMin,
      marks,
      note: notes.join('; '),
    });
  }

  findings.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));

  return NextResponse.json({
    ok: true,
    period: { from: fromParam || defaultFrom, to: toParam || defaultTo },
    totals: {
      daysScanned: byDay.size,
      findings: findings.length,
      umaBatida: countUma,
      foraHorarioCedo: countCedo,
      soAjustadas: countAjustada,
      eventoCurto: countEvento,
      meioExpedienteMarcados: countMeio,
    },
    findings,
  });
}
