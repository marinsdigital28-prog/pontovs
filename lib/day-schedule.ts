export type PunchMode = 'FULL' | 'HALF';
export type DaySchedule = { start: string; end: string; mode: PunchMode };

export const DAY_ORDER = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'] as const;
export const DEFAULT_FULL_SCHEDULE: DaySchedule = { start: '08:00', end: '17:00', mode: 'FULL' };

export function parseScheduleByDay(value: string | null | undefined): Record<string, DaySchedule> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(Object.entries(parsed).flatMap(([day, raw]) => {
      if (!raw || typeof raw !== 'object') return [];
      const item = raw as Partial<DaySchedule>;
      if (!/^\d{2}:\d{2}$/.test(String(item.start)) || !/^\d{2}:\d{2}$/.test(String(item.end))) return [];
      return [[day.toUpperCase(), { start: String(item.start), end: String(item.end), mode: item.mode === 'HALF' ? 'HALF' : 'FULL' }]];
    }));
  } catch { return {}; }
}

export function resolveDaySchedule(scheduleByDay: string | null | undefined, workDays: string | null | undefined, scheduleStart: string | null | undefined, scheduleEnd: string | null | undefined, weekday: number): DaySchedule | null {
  const day = DAY_ORDER[weekday];
  const overrides = parseScheduleByDay(scheduleByDay);
  if (overrides[day]) return overrides[day];
  const days = String(workDays || 'SEG,TER,QUA,QUI,SEX').toUpperCase();
  if (!days.includes(day)) return null;
  if (!scheduleStart || !scheduleEnd) return null;
  const start = scheduleStart.slice(0, 5); const end = scheduleEnd.slice(0, 5);
  const startMinutes = Number(start.slice(0, 2)) * 60 + Number(start.slice(3));
  const endMinutes = Number(end.slice(0, 2)) * 60 + Number(end.slice(3));
  return { start, end, mode: endMinutes - startMinutes <= 6 * 60 ? 'HALF' : 'FULL' };
}

export function defaultScheduleByDay(start: string, end: string, days: string[], halfDays: string[] = []) {
  return JSON.stringify(Object.fromEntries(days.map(day => [day, { start, end, mode: halfDays.includes(day) ? 'HALF' : 'FULL' }])));
}
