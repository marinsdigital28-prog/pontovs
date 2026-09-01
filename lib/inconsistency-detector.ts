import { resolveDaySchedule } from './day-schedule';
import { parseWorkDays } from './timesheet-schedule';

export const BRAZIL_TIME_ZONE = 'America/Sao_Paulo';
export const REQUIRED_PUNCH_TYPES = ['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA'] as const;
export type RequiredPunchType = (typeof REQUIRED_PUNCH_TYPES)[number];

export type DetectorEmployee = {
  id: string;
  name: string;
  employeeNumber: string | null;
  jobTitle: string | null;
  workDays: string | null;
  scheduleStart: string | null;
  scheduleEnd: string | null;
  scheduleByDay: string | null;
};

export type DetectorPunch = {
  id: string;
  userId: string;
  type: string;
  timestamp: Date;
  status: string;
};

export type DetectorException = {
  userId: string;
  startDate: Date;
  endDate: Date;
  status: string;
  type: string;
};

export type DetectedIssue = {
  key: string;
  id: string;
  userId: string;
  punchId: string | null;
  type: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  date: string;
  weekday: string;
  description: string;
  missingTypes: RequiredPunchType[];
  duplicateTypes: string[];
  suggestedTimes: Partial<Record<RequiredPunchType, string>>;
  actualPunches: Array<{ id: string; type: string; timestamp: string }>;
  expectedMinutes: number | null;
  workedMinutes: number | null;
  user: { id: string; name: string; employeeNumber: string | null; jobTitle: string | null };
};

const weekdayNames = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const weekdayCodes = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'];

function dateParts(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return { year, month, day };
}

function dateAtNoon(date: string) {
  const { year, month, day } = dateParts(date);
  return new Date(Date.UTC(year, month - 1, day, 15, 0, 0));
}

function addDays(date: string, amount: number) {
  const value = dateAtNoon(date);
  value.setUTCDate(value.getUTCDate() + amount);
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
}

export function dateKeysBetween(from: string, to: string) {
  const keys: string[] = [];
  for (let current = from; current <= to; current = addDays(current, 1)) keys.push(current);
  return keys;
}

export function parseDateBoundary(value: string | null, endOfDay = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const suffix = endOfDay ? '23:59:59.999' : '00:00:00.000';
  const result = new Date(`${value}T${suffix}-03:00`);
  return Number.isNaN(result.getTime()) ? null : result;
}

function localDateKey(value: Date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: BRAZIL_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  const mapped = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${mapped.year}-${mapped.month}-${mapped.day}`;
}

function minutesFromClock(value: string | null | undefined) {
  if (!value || !/^\d{1,2}:\d{2}$/.test(value.slice(0, 5))) return null;
  const [hour, minute] = value.slice(0, 5).split(':').map(Number);
  return hour * 60 + minute;
}

function clockFromMinutes(value: number) {
  const normalized = Math.max(0, Math.min(23 * 60 + 59, value));
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

function timeToMinutes(value: Date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: BRAZIL_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(value);
  const mapped = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(mapped.hour) * 60 + Number(mapped.minute);
}

function minutesBetween(start: Date, end: Date) {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}

function hasException(exceptions: DetectorException[], userId: string, date: string) {
  return exceptions.some((item) => item.userId === userId && item.startDate <= dateAtNoon(date) && item.endDate >= dateAtNoon(date) && ['APROVADO', 'ATIVO', 'PENDENTE'].includes(item.status));
}

function expectedPunchTypes(mode: 'FULL' | 'HALF') {
  return mode === 'HALF' ? ['ENTRADA', 'SAIDA'] as RequiredPunchType[] : [...REQUIRED_PUNCH_TYPES];
}

export function autoIssueId(key: string) {
  return `auto:${encodeURIComponent(key)}`;
}

export function autoIssueKey(id: string) {
  if (!id.startsWith('auto:')) return null;
  try { return decodeURIComponent(id.slice('auto:'.length)); } catch { return null; }
}

export function autoDescriptionPrefix(key: string) {
  return `AUTO_KEY:${encodeURIComponent(key)}|`;
}

export function autoDescription(key: string, description: string) {
  return `${autoDescriptionPrefix(key)}${description}`;
}

export function extractAutoKey(description: string | null) {
  const match = description?.match(/^AUTO_KEY:([^|]+)\|/);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
}

export function detectInconsistencies({ employees, punches, exceptions, from, to }: { employees: DetectorEmployee[]; punches: DetectorPunch[]; exceptions: DetectorException[]; from: string; to: string }) {
  const punchByDay = new Map<string, DetectorPunch[]>();
  for (const punch of punches) {
    if (punch.status === 'REJECTED') continue;
    const key = `${punch.userId}|${localDateKey(punch.timestamp)}`;
    const list = punchByDay.get(key) || [];
    list.push(punch);
    punchByDay.set(key, list);
  }

  const result: DetectedIssue[] = [];
  for (const employee of employees) {
    const workDays = employee.workDays ? parseWorkDays(employee.workDays) : new Set(['SEG', 'TER', 'QUA', 'QUI', 'SEX']);
    for (const date of dateKeysBetween(from, to)) {
      const dateObject = dateAtNoon(date);
      const weekday = dateObject.getUTCDay();
      const schedule = resolveDaySchedule(employee.scheduleByDay, employee.workDays, employee.scheduleStart, employee.scheduleEnd, weekday);
      if (!schedule || !workDays.has(weekdayCodes[weekday])) continue;
      if (hasException(exceptions, employee.id, date)) continue;

      const dayPunches = (punchByDay.get(`${employee.id}|${date}`) || []).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      const expected = expectedPunchTypes(schedule.mode);
      const byType = new Map<string, DetectorPunch[]>();
      for (const punch of dayPunches) byType.set(punch.type, [...(byType.get(punch.type) || []), punch]);
      const missingTypes = expected.filter((type) => !byType.has(type));
      const duplicateTypes = [...byType.entries()].filter(([, values]) => values.length > 1).map(([type]) => type);
      const startMinutes = minutesFromClock(schedule.start);
      const endMinutes = minutesFromClock(schedule.end);
      const expectedMinutes = startMinutes !== null && endMinutes !== null ? Math.max(0, endMinutes - startMinutes - (schedule.mode === 'FULL' ? 60 : 0)) : null;
      const actualEntry = byType.get('ENTRADA')?.[0];
      const actualExit = byType.get('SAIDA')?.at(-1);
      const workedMinutes = actualEntry && actualExit ? minutesBetween(actualEntry.timestamp, actualExit.timestamp) - (schedule.mode === 'FULL' ? 60 : 0) : dayPunches.length ? null : 0;
      const suggestedTimes: Partial<Record<RequiredPunchType, string>> = {
        ENTRADA: schedule.start,
        SAIDA: schedule.end,
      };
      if (schedule.mode === 'FULL' && startMinutes !== null && endMinutes !== null) {
        const lunchStart = Math.min(endMinutes - 60, Math.max(startMinutes, 12 * 60));
        suggestedTimes.INTERVALO = clockFromMinutes(lunchStart);
        suggestedTimes.RETORNO = clockFromMinutes(lunchStart + 60);
      }

      if (!dayPunches.length) {
        result.push({ key: `${employee.id}|${date}|ABSENCE`, id: autoIssueId(`${employee.id}|${date}|ABSENCE`), userId: employee.id, punchId: null, type: 'ABSENCE', severity: 'HIGH', date, weekday: weekdayNames[weekday], description: `Nenhuma batida encontrada em dia previsto de trabalho (${schedule.start} às ${schedule.end}).`, missingTypes: expected, duplicateTypes: [], suggestedTimes, actualPunches: [], expectedMinutes, workedMinutes: 0, user: { id: employee.id, name: employee.name, employeeNumber: employee.employeeNumber, jobTitle: employee.jobTitle } });
        continue;
      }

      const sequence = dayPunches.map((punch) => punch.type).filter((type) => expected.includes(type as RequiredPunchType));
      const expectedIndexes = sequence.map((type) => expected.indexOf(type as RequiredPunchType));
      const invalidSequence = expectedIndexes.some((value, index) => index > 0 && value < expectedIndexes[index - 1]);
      const issueTypes: string[] = [];
      if (missingTypes.length) issueTypes.push('MISSING_PUNCHES');
      if (duplicateTypes.length) issueTypes.push('DUPLICATE_PUNCHES');
      if (invalidSequence) issueTypes.push('INVALID_SEQUENCE');
      const entryLate = startMinutes !== null && actualEntry && timeToMinutes(actualEntry.timestamp) > startMinutes + 5;
      if (entryLate) issueTypes.push('LATE_ENTRY');
      if (!missingTypes.length && expectedMinutes !== null && workedMinutes !== null && workedMinutes < expectedMinutes - 5) issueTypes.push('UNDERWORKED');
      if (!issueTypes.length) continue;
      const missingLabel = missingTypes.length ? ` Faltam: ${missingTypes.join(', ')}.` : '';
      const duplicateLabel = duplicateTypes.length ? ` Duplicadas: ${duplicateTypes.join(', ')}.` : '';
      result.push({ key: `${employee.id}|${date}|${issueTypes.join('+')}`, id: autoIssueId(`${employee.id}|${date}|${issueTypes.join('+')}`), userId: employee.id, punchId: dayPunches[0]?.id || null, type: issueTypes.join('+'), severity: missingTypes.length || invalidSequence ? 'HIGH' : entryLate ? 'MEDIUM' : 'LOW', date, weekday: weekdayNames[weekday], description: `${issueTypes.includes('ABSENCE') ? 'Ausência' : 'Revisar jornada.'}${missingLabel}${duplicateLabel}`, missingTypes, duplicateTypes, suggestedTimes, actualPunches: dayPunches.map((punch) => ({ id: punch.id, type: punch.type, timestamp: punch.timestamp.toISOString() })), expectedMinutes, workedMinutes, user: { id: employee.id, name: employee.name, employeeNumber: employee.employeeNumber, jobTitle: employee.jobTitle } });
    }
  }
  return result;
}
