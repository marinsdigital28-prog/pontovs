const DEFAULT_WORK_DAYS = ['SEG', 'TER', 'QUA', 'QUI', 'SEX'];

const DAY_ALIASES: Record<string, string> = {
  DOM: 'DOM', DOMINGO: 'DOM',
  SEG: 'SEG', SEGUNDA: 'SEG', SEGUNDAFEIRA: 'SEG',
  TER: 'TER', TERCA: 'TER', TERÇAFEIRA: 'TER',
  QUA: 'QUA', QUARTA: 'QUA', QUARTAFEIRA: 'QUA',
  QUI: 'QUI', QUINTA: 'QUI', QUINTAFEIRA: 'QUI',
  SEX: 'SEX', SEXTA: 'SEX', SEXTAFEIRA: 'SEX',
  SAB: 'SAB', SABADO: 'SAB',
};

function cleanDay(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z]/gi, '')
    .toUpperCase();
}

export function parseWorkDays(value: string | null | undefined) {
  if (!value?.trim()) return new Set(DEFAULT_WORK_DAYS);
  let rawValues: unknown[];
  try {
    const parsed = JSON.parse(value);
    rawValues = Array.isArray(parsed) ? parsed : [value];
  } catch {
    rawValues = [value];
  }
  const days = rawValues
    .flatMap((item) => String(item).split(/[;,\s]+/))
    .map(cleanDay)
    .map((day) => DAY_ALIASES[day] || '')
    .filter(Boolean);
  return new Set(days.length ? days : DEFAULT_WORK_DAYS);
}

export function isScheduledDay(workDays: Set<string>, weekdayCode: string) {
  return workDays.has(cleanDay(weekdayCode));
}
