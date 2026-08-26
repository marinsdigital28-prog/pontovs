import { parseWorkDays as parseStoredWorkDays } from './timesheet-schedule';

const BRASIL_TIME_ZONE = 'America/Sao_Paulo';
const DAY_CODES = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'];

export type AnalyticsEmployee = {
  id: string;
  workDays: string | null;
  scheduleStart: string | null;
};

export type AnalyticsPunch = {
  userId: string;
  type: string;
  timestamp: Date;
};

export type DailyAttendance = {
  date: string;
  day: string;
  scheduled: number;
  present: number;
  absent: number;
  off: number;
  punctual: number;
  punctualityEvaluated: number;
  late: number;
  averageDelayMinutes: number | null;
};

function partsInBrazil(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BRASIL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}

export function localDateKey(date: Date) {
  const parts = partsInBrazil(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function localMinutes(date: Date) {
  const parts = partsInBrazil(date);
  return Number(parts.hour) * 60 + Number(parts.minute);
}

export function scheduleMinutes(value: string | null) {
  const match = String(value || '').match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function dayCodeForDate(dateKey: string) {
  const date = new Date(`${dateKey}T12:00:00-03:00`);
  return DAY_CODES[date.getUTCDay()];
}

export function dateKeysBetween(from: string, to: string) {
  const start = new Date(`${from}T12:00:00-03:00`);
  const end = new Date(`${to}T12:00:00-03:00`);
  const result: string[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    result.push(cursor.toISOString().slice(0, 10));
  }
  return result;
}

export function rangeStart(dateKey: string) {
  return new Date(`${dateKey}T00:00:00-03:00`);
}

export function rangeEndExclusive(dateKey: string) {
  const end = new Date(`${dateKey}T00:00:00-03:00`);
  end.setUTCDate(end.getUTCDate() + 1);
  return end;
}

export function analyzeAttendance(employees: AnalyticsEmployee[], punches: AnalyticsPunch[], from: string, to: string) {
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const punchDays = new Map<string, AnalyticsPunch[]>();
  for (const punch of punches) {
    if (!employeeById.has(punch.userId)) continue;
    const key = `${punch.userId}|${localDateKey(punch.timestamp)}`;
    const list = punchDays.get(key) || [];
    list.push(punch);
    punchDays.set(key, list);
  }

  const daily: DailyAttendance[] = dateKeysBetween(from, to).map((date) => {
    const dayCode = dayCodeForDate(date);
    let scheduled = 0;
    let present = 0;
    let punctual = 0;
    let punctualityEvaluated = 0;
    let late = 0;
    let delayTotal = 0;
    for (const employee of employees) {
      const workDays = parseStoredWorkDays(employee.workDays);
      if (!workDays.has(dayCode)) continue;
      scheduled += 1;
      const dayPunches = punchDays.get(`${employee.id}|${date}`) || [];
      if (!dayPunches.length) continue;
      present += 1;
      const expected = scheduleMinutes(employee.scheduleStart);
      const entry = dayPunches.filter((punch) => punch.type === 'ENTRADA').sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())[0];
      if (expected === null || !entry) continue;
      punctualityEvaluated += 1;
      const delay = localMinutes(entry.timestamp) - expected;
      if (delay <= 0) punctual += 1;
      else { late += 1; delayTotal += delay; }
    }
    return { date, day: dayCode, scheduled, present, absent: scheduled - present, off: employees.length - scheduled, punctual, punctualityEvaluated, late, averageDelayMinutes: late ? Math.round(delayTotal / late) : null };
  });

  const summary = daily.reduce((result, day) => {
    result.scheduled += day.scheduled;
    result.present += day.present;
    result.absent += day.absent;
    result.punctual += day.punctual;
    result.punctualityEvaluated += day.punctualityEvaluated;
    result.late += day.late;
    result.delayTotal += day.late && day.averageDelayMinutes !== null ? day.late * day.averageDelayMinutes : 0;
    return result;
  }, { scheduled: 0, present: 0, absent: 0, punctual: 0, punctualityEvaluated: 0, late: 0, delayTotal: 0 });

  return {
    from,
    to,
    employeeCount: employees.length,
    daily,
    summary: {
      scheduledDays: summary.scheduled,
      presentDays: summary.present,
      absentDays: summary.absent,
      punctualArrivals: summary.punctual,
      punctualityEvaluated: summary.punctualityEvaluated,
      lateArrivals: summary.late,
      attendanceRate: summary.scheduled ? Math.round((summary.present / summary.scheduled) * 1000) / 10 : null,
      punctualityRate: summary.punctualityEvaluated ? Math.round((summary.punctual / summary.punctualityEvaluated) * 1000) / 10 : null,
      averageDelayMinutes: summary.late ? Math.round(summary.delayTotal / summary.late) : null,
    },
  };
}

