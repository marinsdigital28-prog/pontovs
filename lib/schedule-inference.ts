import { dayCodeForDate, localDateKey, localMinutes } from './attendance-analytics';
import { normalizeToOfficialSchedule } from './official-schedules';

const DAY_ORDER = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'];

type Punch = { userId: string; type: string; timestamp: Date };

type DailyPattern = { date: string; day: string; entry: number | null; exit: number | null };

export type InferredSchedule = { workDays?: string; scheduleStart?: string; scheduleEnd?: string; observedDays: number };

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function clock(minutes: number | null) {
  if (minutes === null) return undefined;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function inferSchedulesFromPunches(punches: Punch[]) {
  const byEmployee = new Map<string, Map<string, Punch[]>>();
  for (const punch of punches) {
    const employeeDays = byEmployee.get(punch.userId) || new Map<string, Punch[]>();
    const date = localDateKey(punch.timestamp);
    const dayPunches = employeeDays.get(date) || [];
    dayPunches.push(punch);
    employeeDays.set(date, dayPunches);
    byEmployee.set(punch.userId, employeeDays);
  }

  const result = new Map<string, InferredSchedule>();
  for (const [userId, employeeDays] of byEmployee) {
    const patterns: DailyPattern[] = [];
    for (const [date, dayPunches] of employeeDays) {
      const ordered = [...dayPunches].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      const entries = ordered.filter((punch) => punch.type === 'ENTRADA');
      const exits = ordered.filter((punch) => punch.type === 'SAIDA');
      patterns.push({ date, day: dayCodeForDate(date), entry: entries.length ? localMinutes(entries[0].timestamp) : null, exit: exits.length ? localMinutes(exits[exits.length - 1].timestamp) : null });
    }
    const observed = patterns.filter((pattern) => pattern.entry !== null || pattern.exit !== null);
    if (!observed.length) continue;
    const days = [...new Set(observed.map((pattern) => pattern.day))].sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
    const starts = observed.flatMap((pattern) => pattern.entry === null ? [] : [pattern.entry]);
    const ends = observed.flatMap((pattern) => pattern.exit === null ? [] : [pattern.exit]);
    const inferredStart = clock(median(starts));
    const inferredEnd = clock(median(ends));
    const official = inferredStart && inferredEnd ? normalizeToOfficialSchedule(inferredStart, inferredEnd) : null;
    result.set(userId, {
      workDays: days.join(','),
      scheduleStart: official?.scheduleStart ?? inferredStart,
      scheduleEnd: official?.scheduleEnd ?? inferredEnd,
      observedDays: observed.length,
    });
  }
  return result;
}
