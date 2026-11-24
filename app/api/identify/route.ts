import { NextResponse } from 'next/server';
import prisma from '../../../lib/prisma';
import { brazilDayRange } from '../../../lib/brazil-time';
import { scheduleForNow } from '../../../lib/day-schedule';
import { withEffectiveTypes } from '../../../lib/punch-interpretation';
import { habitLunch, loadHabit } from '../../../lib/habit-server';
import { brazilDateKey } from '../../../lib/brazil-time';
import { databaseUnavailableResponse, isDatabaseQuotaExceeded } from '../../../lib/database-errors';
import { isExitOverrideActive } from '../../../lib/exit-override';
import { findEmployeeFallback } from '../../../lib/employee-fallback';
import { consumeRateLimit, getRequestKey, rateLimitResponse } from '../../../lib/security-controls';
import { resolveSmartPunchSuggestion } from '../../../lib/smart-punch-type';

export async function POST(req: Request) {
  const rate = await consumeRateLimit(getRequestKey(req, 'employee-identify'), 120, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);
  let employeeNumber = '';
  try {
    const body = await req.json();
    employeeNumber = String(body?.employeeNumber ?? '').replace(/\D/g, '').padStart(4, '0');
    if (!employeeNumber) return NextResponse.json({ error: 'Matrícula obrigatória' }, { status: 400 });

    const { start, end } = brazilDayRange();
    const user = await prisma.user.findUnique({
      where: { employeeNumber },
      select: {
        id: true,
        name: true,
        employeeNumber: true,
        email: true,
        role: true,
        jobTitle: true,
        workDays: true,
        scheduleStart: true,
        scheduleEnd: true,
        scheduleByDay: true,
        active: true,
        punches: {
          where: { status: 'VALID', timestamp: { gte: start, lt: end } },
          orderBy: { timestamp: 'asc' },
          select: { id: true, type: true, timestamp: true },
        },
      },
    });
    if (!user || !user.active || user.role !== 'EMPLOYEE') {
      return NextResponse.json({ error: 'Colaborador não encontrado ou inativo' }, { status: 404 });
    }

    // Escala de HOJE em Brasília (o Worker roda em UTC) — scheduleByDay é a fonte da verdade.
    const schedule = scheduleForNow(user);
    const mode = schedule?.mode === 'HALF' ? 'HALF' : 'FULL';
    const resolvedScheduleEnd = schedule?.end ?? user.scheduleEnd?.slice(0, 5) ?? null;
    const punchesToday = await withEffectiveTypes(user.punches);
    const habit = punchesToday.length ? null : await loadHabit(user.id, brazilDateKey());
    const smart = resolveSmartPunchSuggestion({
      punchesToday,
      mode,
      scheduleEnd: resolvedScheduleEnd,
      scheduleStart: schedule?.start ?? null,
      habitLunch: habitLunch(habit),
    });

    // Compatibilidade: nextType continua existindo para clientes antigos
    const nextType = smart.suggestedType ?? smart.sequentialType;

    const last = user.punches.length ? user.punches[user.punches.length - 1] : null;
    const todayPunches = punchesToday.map((punch) => ({
      id: punch.id,
      type: punch.type,
      timestamp: punch.timestamp,
    }));

    return NextResponse.json(
      {
        id: user.id,
        name: user.name,
        employeeNumber: user.employeeNumber,
        email: user.email,
        role: user.role,
        jobTitle: user.jobTitle,
        workDays: user.workDays,
        scheduleStart: user.scheduleStart,
        scheduleEnd: user.scheduleEnd,
        scheduleByDay: user.scheduleByDay,
        active: user.active,
        lastPunch: last,
        nextType,
        suggestedType: smart.suggestedType,
        sequentialType: smart.sequentialType,
        allowedTypes: smart.allowedTypes,
        suggestionReason: smart.reason,
        suggestionWarning: smart.warning ?? null,
        journeyClosed: smart.journeyClosed,
        todayPunches,
        scheduleMode: mode,
        resolvedScheduleEnd,
      },
      { status: 200 },
    );
  } catch (error) {
    if (isDatabaseQuotaExceeded(error)) {
      const fallback = isExitOverrideActive() ? findEmployeeFallback(employeeNumber) : null;
      if (fallback) {
        return NextResponse.json(
          {
            ...fallback,
            lastPunch: null,
            nextType: 'SAIDA',
            suggestedType: 'SAIDA',
            sequentialType: 'SAIDA',
            allowedTypes: ['SAIDA'],
            suggestionReason: 'Modo contingência: registrando saída offline.',
            journeyClosed: false,
            todayPunches: [],
            offlineFallback: true,
          },
          { status: 200 },
        );
      }
      return NextResponse.json(databaseUnavailableResponse(), { status: 503 });
    }
    return NextResponse.json(
      { error: 'Não foi possível consultar o colaborador agora. Tente novamente.' },
      { status: 500 },
    );
  }
}
