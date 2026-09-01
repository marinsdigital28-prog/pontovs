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

function clampHourMinutes(item: CertificateCoverageItem, scheduleStart: number, scheduleEnd: number, fullDay: boolean, expected: number | null) {
  const start = clockMinutes(item.startTime); const end = clockMinutes(item.endTime);
  if (start === null || end === null || end <= start) return 0;
  const from = Math.max(scheduleStart, start); const to = Math.min(scheduleEnd, end);
  if (to <= from) return 0;
  let minutes = to - from;
  if (fullDay) minutes -= Math.max(0, Math.min(to, 13 * 60) - Math.max(from, 12 * 60));
  return Math.max(0, expected === null ? minutes : Math.min(expected, minutes));
}

export function certificateMinutesForDay(item: CertificateCoverageItem, date: string, scheduleStart: number | null, scheduleEnd: number | null, fullDay: boolean, expected: number | null) {
  if (!['APROVADO', 'ATIVO'].includes(item.status)) return 0;
  const startDate = dateKey(item.startDate); const endDate = dateKey(item.endDate);
  const itemDate = dateKey(item.eventDate || item.startDate);
  if (isHourCoverage(item)) {
    if (itemDate !== date || scheduleStart === null || scheduleEnd === null) return 0;
    return clampHourMinutes(item, scheduleStart, scheduleEnd, fullDay, expected);
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
