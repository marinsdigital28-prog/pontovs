import { brazilDateKey } from './brazil-time';

/** Matrículas */
export const MAT_KAIO = '0803';
export const MAT_ANA_MARIA = '2904';
export const MAT_VIVIANE = '1404';

/** Datas operacionais fixas (YYYY-MM-DD, fuso SP) */
export const DATA_MESA_BRASIL_ANA = '2026-08-25';
export const DATA_VENDAVAL = '2026-08-07';
export const DATA_INDEPENDENCIA = '2026-09-07';
export const DATA_OBITO_VIVIANE = '2026-09-22';
export const HORA_SAIDA_VENDAVAL = '15:00';
export const HORA_INICIO_ABONO_OBITO_VIVIANE = '15:51';

/** Feriados nacionais (dia integral abonado para quem está na escala) */
export const NATIONAL_HOLIDAYS: Record<string, string> = {
  [DATA_INDEPENDENCIA]: 'Feriado nacional — Independência do Brasil',
};

export type OperationalAbono = {
  kind: 'FULL_DAY' | 'FROM_TIME';
  reason: string;
  /** minutos creditados; null = dia integral (usa expected do colaborador) */
  minutes?: number | null;
  fromTime?: string;
};

/** Última sexta-feira do mês (dateKey YYYY-MM-DD). */
export function lastFridayOfMonth(year: number, month1to12: number): string {
  const lastDay = new Date(year, month1to12, 0).getDate();
  for (let d = lastDay; d >= 1; d -= 1) {
    const date = new Date(year, month1to12 - 1, d, 12, 0, 0);
    if (date.getDay() === 5) {
      return `${year}-${String(month1to12).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }
  return `${year}-${String(month1to12).padStart(2, '0')}-01`;
}

export function isLastFridayOfMonth(dateKey: string): boolean {
  const [y, m, d] = dateKey.split('-').map(Number);
  return lastFridayOfMonth(y, m) === dateKey;
}

export function isNationalHoliday(dateKey: string): boolean {
  return Boolean(NATIONAL_HOLIDAYS[dateKey]);
}

/**
 * Abono operacional por matrícula + data.
 * Não altera matrícula/jornada cadastrada — só justifica na folha.
 * Feriados nacionais abonam todo mundo que está na escala do dia.
 */
export function getOperationalAbono(
  employeeNumber: string | null | undefined,
  dateKey: string,
): OperationalAbono | null {
  const mat = String(employeeNumber || '').replace(/\D/g, '');

  // Feriado nacional — abono integral para quem é do dia (escala)
  const holidayReason = NATIONAL_HOLIDAYS[dateKey];
  if (holidayReason) {
    return {
      kind: 'FULL_DAY',
      reason: holidayReason,
    };
  }

  // Kaio — jovem aprendiz: curso toda terça + última sexta do mês
  if (mat === MAT_KAIO) {
    const [y, m, d] = dateKey.split('-').map(Number);
    const weekday = new Date(y, m - 1, d, 12, 0, 0).getDay(); // 2 = terça
    if (weekday === 2) {
      return {
        kind: 'FULL_DAY',
        reason: 'Curso jovem aprendiz (terça-feira)',
      };
    }
    if (isLastFridayOfMonth(dateKey)) {
      return {
        kind: 'FULL_DAY',
        reason: 'Curso jovem aprendiz (última sexta do mês)',
      };
    }
  }

  // Ana Maria — trabalho externo Mesa Brasil 25/08/2026
  if (mat === MAT_ANA_MARIA && dateKey === DATA_MESA_BRASIL_ANA) {
    return {
      kind: 'FULL_DAY',
      reason: 'Trabalho externo — reunião Mesa Brasil',
    };
  }

  // Viviane 1404 — atestado de óbito em 22/09/2026; abona o restante após a saída registrada.
  if (mat === MAT_VIVIANE && dateKey === DATA_OBITO_VIVIANE) {
    return {
      kind: 'FROM_TIME',
      fromTime: HORA_INICIO_ABONO_OBITO_VIVIANE,
      reason: 'Atestado de óbito — restante do expediente',
    };
  }

  // Vendaval 07/08/2026 — saída liberada às 15h; resto do expediente abonado
  if (dateKey === DATA_VENDAVAL) {
    return {
      kind: 'FROM_TIME',
      fromTime: HORA_SAIDA_VENDAVAL,
      reason: 'Saída antecipada por vendaval (liberação às 15h)',
    };
  }

  return null;
}

export function minutesFromClock(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/**
 * Minutos creditados pelo abono operacional no dia.
 * Feriado / FULL_DAY: conta como HORAS TRABALHADAS (pedido contábil) —
 * credita a jornada prevista integral.
 */
export function operationalJustifiedMinutes(
  abono: OperationalAbono,
  scheduleStart: string | null | undefined,
  scheduleEnd: string | null | undefined,
  expectedMinutes: number | null,
): number {
  if (abono.kind === 'FULL_DAY') {
    // Preferência: jornada prevista do dia. Se não houver expected,
    // calcula pela escala cadastrada (início–fim − almoço se > 6h).
    if (expectedMinutes != null && expectedMinutes > 0) return expectedMinutes;
    const start = minutesFromClock(scheduleStart);
    const end = minutesFromClock(scheduleEnd);
    if (start === null || end === null || end <= start) return 0;
    const span = end - start;
    const lunch = span > 6 * 60 ? 60 : 0;
    return Math.max(0, span - lunch);
  }
  const end = minutesFromClock(scheduleEnd);
  const from = minutesFromClock(abono.fromTime || HORA_SAIDA_VENDAVAL);
  if (end === null || from === null) return 0;
  const raw = Math.max(0, end - from);
  return expectedMinutes !== null ? Math.min(expectedMinutes, raw) : raw;
}

/** True se a data é feriado nacional cadastrado (crédito integral como trabalhado). */
export function isHolidayAbono(abono: OperationalAbono | null | undefined): boolean {
  if (!abono) return false;
  return abono.kind === 'FULL_DAY' && /feriado/i.test(abono.reason || '');
}

export function shouldHidePunchesForDay(
  employeeNumber: string | null | undefined,
  dateKey: string,
): boolean {
  const mat = String(employeeNumber || '').replace(/\D/g, '');
  // Ana Maria no dia Mesa Brasil: não deve aparecer ponto no dia
  return mat === MAT_ANA_MARIA && dateKey === DATA_MESA_BRASIL_ANA;
}
