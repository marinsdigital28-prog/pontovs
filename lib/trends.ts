import { resolveDaySchedule } from './day-schedule';
import { resolveHoliday } from './holidays';

export type TrendEmployee = { id: string; name: string; employeeNumber?: string | null; jobTitle?: string | null; workDays?: string | null; scheduleStart?: string | null; scheduleEnd?: string | null; scheduleByDay?: string | null };
export type TrendPunch = { userId: string; type: string; timestamp: Date; status?: string | null };
export type TrendRow = {
  userId: string; name: string; employeeNumber: string | null;
  lateDays: number; lateMinutes: number; workedDays: number; incompleteDays: number;
  overtime50Minutes: number; overtime100Minutes: number; overtimeMinutes: number;
};

export const LATE_TOLERANCE_MINUTES = 15;
/** CLT art. 58 §1º: variações de até 10 min no dia não contam como extra. */
export const OVERTIME_TOLERANCE_MINUTES = 10;

const TZ = 'America/Sao_Paulo';
function dayKey(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); }
function minutesOf(d: Date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  return Number(parts.find((p) => p.type === 'hour')?.value) * 60 + Number(parts.find((p) => p.type === 'minute')?.value);
}
function clock(v?: string | null) { const m = String(v || '').match(/^(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }

/** Minutos trabalhados no dia (pares entrada→saída). null se a sequência estiver incompleta. */
export function workedMinutes(punches: Array<{ type: string; timestamp: Date }>) {
  const sorted = [...punches].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  let total = 0; let open: Date | null = null;
  for (const p of sorted) {
    if (p.type === 'ENTRADA' || p.type === 'RETORNO') { if (open) return null; open = p.timestamp; }
    else if (p.type === 'INTERVALO' || p.type === 'SAIDA') { if (!open) return null; total += Math.round((p.timestamp.getTime() - open.getTime()) / 60000); open = null; }
  }
  return open ? null : total;
}

export function computeTrends(input: { employees: TrendEmployee[]; punches: TrendPunch[]; from: string; to: string }): TrendRow[] {
  const byUserDay = new Map<string, TrendPunch[]>();
  for (const p of input.punches) {
    if (p.status === 'REJECTED') continue;
    const k = `${p.userId}|${dayKey(p.timestamp)}`; const list = byUserDay.get(k) || []; list.push(p); byUserDay.set(k, list);
  }
  return input.employees.map((e) => {
    const row: TrendRow = { userId: e.id, name: e.name, employeeNumber: e.employeeNumber ?? null, lateDays: 0, lateMinutes: 0, workedDays: 0, incompleteDays: 0, overtime50Minutes: 0, overtime100Minutes: 0, overtimeMinutes: 0 };
    for (const [k, list] of byUserDay) {
      if (!k.startsWith(`${e.id}|`)) continue;
      const date = k.slice(e.id.length + 1);
      if (date < input.from || date > input.to) continue;
      const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
      const schedule = resolveDaySchedule(e.scheduleByDay, e.workDays, e.scheduleStart, e.scheduleEnd, weekday, e.employeeNumber);
      const holiday = resolveHoliday(date);
      const worked = workedMinutes(list);
      const start = clock(schedule?.start); const end = clock(schedule?.end);
      const firstIn = list.filter((p) => p.type === 'ENTRADA').map((p) => minutesOf(p.timestamp)).sort((a, b) => a - b)[0];
      // Atraso conta mesmo com o dia ainda em aberto (ex.: hoje).
      if (schedule && !holiday && start !== null && firstIn !== undefined && firstIn > start + LATE_TOLERANCE_MINUTES) { row.lateDays += 1; row.lateMinutes += firstIn - start; }
      if (worked === null) { row.incompleteDays += 1; continue; }
      row.workedDays += 1;
      if (!schedule || holiday || weekday === 0) { row.overtime100Minutes += worked; continue; }
      const span = start !== null && end !== null ? Math.max(0, end - start) : 0;
      const expected = Math.max(0, span - (span > 6 * 60 ? 60 : 0));
      const surplus = worked - expected;
      if (surplus > OVERTIME_TOLERANCE_MINUTES) row.overtime50Minutes += surplus;
    }
    row.overtimeMinutes = row.overtime50Minutes + row.overtime100Minutes;
    return row;
  });
}

/** Custo estimado: horas 50% × valor-hora × 1,5 + horas 100% × valor-hora × 2. */
export function overtimeCost(row: Pick<TrendRow, 'overtime50Minutes' | 'overtime100Minutes'>, hourly: number) {
  if (!(hourly > 0)) return 0;
  return Math.round(((row.overtime50Minutes / 60) * hourly * 1.5 + (row.overtime100Minutes / 60) * hourly * 2) * 100) / 100;
}
