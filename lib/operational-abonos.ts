import { brazilDateKey } from './brazil-time';

/** Matrículas */
export const MAT_KAIO = '0803';
export const MAT_ANA_MARIA = '2904';

/** Datas operacionais fixas (YYYY-MM-DD, fuso SP) */
export const DATA_MESA_BRASIL_ANA = '2026-08-25';
export const DATA_VENDAVAL = '2026-08-07';
export const HORA_SAIDA_VENDAVAL = '15:00';

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

/**
 * Abono operacional por matrícula + data.
 * Não altera matrícula/jornada cadastrada — só justifica na folha.
 */
export function getOperationalAbono(
  employeeNumber: string | null | undefined,
  dateKey: string,
): OperationalAbono | null {
  const mat = String(employeeNumber || '').replace(/\D/g, '');

  // Kaio — jovem aprendiz: curso na última sexta de cada mês
  if (mat === MAT_KAIO && isLastFridayOfMonth(dateKey)) {
    return {
      kind: 'FULL_DAY',
      reason: 'Curso jovem aprendiz (última sexta do mês)',
    };
  }

  // Ana Maria — trabalho externo Mesa Brasil 25/08/2026
  if (mat === MAT_ANA_MARIA && dateKey === DATA_MESA_BRASIL_ANA) {
    return {
      kind: 'FULL_DAY',
      reason: 'Trabalho externo — reunião Mesa Brasil',
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

/** Minutos creditados pelo abono operacional no dia. */
export function operationalJustifiedMinutes(
  abono: OperationalAbono,
  scheduleStart: string | null | undefined,
  scheduleEnd: string | null | undefined,
  expectedMinutes: number | null,
): number {
  if (abono.kind === 'FULL_DAY') {
    return expectedMinutes ?? 0;
  }
  const end = minutesFromClock(scheduleEnd);
  const from = minutesFromClock(abono.fromTime || HORA_SAIDA_VENDAVAL);
  if (end === null || from === null) return 0;
  const raw = Math.max(0, end - from);
  return expectedMinutes !== null ? Math.min(expectedMinutes, raw) : raw;
}

export function shouldHidePunchesForDay(
  employeeNumber: string | null | undefined,
  dateKey: string,
): boolean {
  const mat = String(employeeNumber || '').replace(/\D/g, '');
  // Ana Maria no dia Mesa Brasil: não deve aparecer ponto no dia
  return mat === MAT_ANA_MARIA && dateKey === DATA_MESA_BRASIL_ANA;
}
