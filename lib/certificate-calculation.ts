export type CertificateCoverageItem = {
  type?: string | null;
  coverageType?: string | null;
  startDate: Date | string;
  endDate: Date | string;
  eventDate?: Date | string | null;
  startTime?: string | null;
  endTime?: string | null;
  hoursPerDayMinutes?: number | null;
  durationMinutes?: number | null;
  status: string;
};

const hourTypes = new Set(['HORAS', 'PERIODO_HORAS', 'SAIDA_MEDICA']);

export function isHourCoverage(item: Pick<CertificateCoverageItem, 'type' | 'coverageType'>) {
  return item.coverageType === 'HOURS' || hourTypes.has(String(item.type || ''));
}

function dateKey(value: Date | string) {
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

function clockMinutes(value: string | null | undefined) {
  const match = value?.match(/^(\d{2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function minutesBetweenClocks(start: string | null | undefined, end: string | null | undefined) {
  const startMinutes = clockMinutes(start); const endMinutes = clockMinutes(end);
  return startMinutes === null || endMinutes === null ? null : endMinutes - startMinutes;
}

/** Minutos do dia (fuso SP, com fração de segundos) de um instante, relativos à data YYYY-MM-DD. */
export function dayMinuteOf(ts: Date | string, date: string) {
  return (new Date(ts).getTime() - new Date(`${date}T00:00:00-03:00`).getTime()) / 60000;
}

/** Tamanho de [from,to] menos a união dos trechos `subs` (recortados a [from,to]). */
function uncoveredMinutes(from: number, to: number, subs: Array<[number, number]>) {
  const cut = subs.map(([a, b]) => [Math.max(from, a), Math.min(to, b)] as [number, number]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let covered = 0; let cursor = from;
  for (const [a, b] of cut) { const s = Math.max(a, cursor); if (b > s) { covered += b - s; cursor = b; } }
  return Math.max(0, to - from - covered);
}

/**
 * Atestado parcial (com horário): abona só os minutos da janela que ficaram SEM batida, dentro da escala,
 * descontando o almoço 12–13h na jornada integral. `worked` = trechos trabalhados do dia (minutos do dia).
 * Sem trechos trabalhados dentro da janela, o resultado é o mesmo de antes (janela ∩ escala − almoço).
 */
function clampHourMinutes(item: CertificateCoverageItem, scheduleStart: number, scheduleEnd: number, fullDay: boolean, expected: number | null, worked: Array<[number, number]> = []) {
  const start = clockMinutes(item.startTime); const end = clockMinutes(item.endTime);
  if (start === null || end === null || end <= start) return 0;
  const from = Math.max(scheduleStart, start); const to = Math.min(scheduleEnd, end);
  if (to <= from) return 0;
  const subs: Array<[number, number]> = [...(fullDay ? [[12 * 60, 13 * 60] as [number, number]] : []), ...worked];
  const minutes = Math.round(uncoveredMinutes(from, to, subs));
  return Math.max(0, expected === null ? minutes : Math.min(expected, minutes));
}

export function certificateMinutesForDay(item: CertificateCoverageItem, date: string, scheduleStart: number | null, scheduleEnd: number | null, fullDay: boolean, expected: number | null, worked: Array<[number, number]> = []) {
  if (!['APROVADO', 'ATIVO'].includes(item.status)) return 0;
  if (item.type === 'DIA_EXTRA') return 0; // dia extra não abona: conta as batidas reais
  const startDate = dateKey(item.startDate); const endDate = dateKey(item.endDate);
  const itemDate = dateKey(item.eventDate || item.startDate);
  if (isHourCoverage(item)) {
    if (itemDate !== date || scheduleStart === null || scheduleEnd === null) return 0;
    return clampHourMinutes(item, scheduleStart, scheduleEnd, fullDay, expected, worked);
  }
  if (startDate > date || endDate < date || expected === null) return 0;
  return expected;
}

export function sumCertificateMinutesForDay(items: CertificateCoverageItem[], date: string, scheduleStart: number | null, scheduleEnd: number | null, fullDay: boolean, expected: number | null) {
  return items.reduce((total, item) => total + certificateMinutesForDay(item, date, scheduleStart, scheduleEnd, fullDay, expected), 0);
}

export function formatCertificateDuration(minutes: number | null | undefined) {
  if (minutes === null || minutes === undefined || minutes < 0) return '—';
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}h${String(minutes % 60).padStart(2, '0')}`;
}
