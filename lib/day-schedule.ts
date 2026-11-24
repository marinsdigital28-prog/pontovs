export type PunchMode = 'FULL' | 'HALF';
export type DaySchedule = { start: string; end: string; mode: PunchMode };

export const DAY_ORDER = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'] as const;
export const DEFAULT_FULL_SCHEDULE: DaySchedule = { start: '08:00', end: '17:00', mode: 'FULL' };

/**
 * Jornadas fixas por matrícula (quando o cadastro ainda não tem scheduleByDay).
 * Jorge Eduardo Maia Serafim (0028):
 *  - SEG / SEX: 08:00–17:00 integral
 *  - QUA: 12:00–16:00 meio expediente
 *  - TER / QUI: 08:00–17:00 (demais dias úteis)
 */
export const FIXED_SCHEDULE_BY_NUMBER: Record<string, string> = {
  '0028': JSON.stringify({
    SEG: { start: '08:00', end: '17:00', mode: 'FULL' },
    TER: { start: '08:00', end: '17:00', mode: 'FULL' },
    QUA: { start: '12:00', end: '16:00', mode: 'HALF' },
    QUI: { start: '08:00', end: '17:00', mode: 'FULL' },
    SEX: { start: '08:00', end: '17:00', mode: 'FULL' },
  }),
};

export function parseScheduleByDay(value: string | null | undefined): Record<string, DaySchedule> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([day, raw]) => {
        if (!raw || typeof raw !== 'object') return [];
        const item = raw as Partial<DaySchedule>;
        if (!/^\d{2}:\d{2}$/.test(String(item.start)) || !/^\d{2}:\d{2}$/.test(String(item.end))) return [];
        return [
          [
            day.toUpperCase(),
            {
              start: String(item.start),
              end: String(item.end),
              mode: item.mode === 'HALF' ? 'HALF' : 'FULL',
            },
          ],
        ];
      }),
    );
  } catch {
    return {};
  }
}

function normalizeMat(employeeNumber?: string | null): string {
  return String(employeeNumber || '').replace(/\D/g, '');
}

/**
 * Resolve o horário do dia.
 * Prioridade: scheduleByDay do cadastro → jornada fixa por matrícula → workDays + início/fim padrão.
 */
export function resolveDaySchedule(
  scheduleByDay: string | null | undefined,
  workDays: string | null | undefined,
  scheduleStart: string | null | undefined,
  scheduleEnd: string | null | undefined,
  weekday: number,
  employeeNumber?: string | null,
): DaySchedule | null {
  const day = DAY_ORDER[weekday];
  const mat = normalizeMat(employeeNumber);
  const effectiveByDay = scheduleByDay || FIXED_SCHEDULE_BY_NUMBER[mat] || null;
  const overrides = parseScheduleByDay(effectiveByDay);
  if (overrides[day]) return overrides[day];

  const days = String(workDays || 'SEG,TER,QUA,QUI,SEX').toUpperCase();
  if (!days.includes(day)) return null;
  if (!scheduleStart || !scheduleEnd) return null;
  const start = scheduleStart.slice(0, 5);
  const end = scheduleEnd.slice(0, 5);
  const startMinutes = Number(start.slice(0, 2)) * 60 + Number(start.slice(3));
  const endMinutes = Number(end.slice(0, 2)) * 60 + Number(end.slice(3));
  return {
    start,
    end,
    mode: endMinutes - startMinutes <= 6 * 60 ? 'HALF' : 'FULL',
  };
}

export function defaultScheduleByDay(start: string, end: string, days: string[], halfDays: string[] = []) {
  return JSON.stringify(
    Object.fromEntries(
      days.map((day) => [day, { start, end, mode: halfDays.includes(day) ? 'HALF' : 'FULL' }]),
    ),
  );
}

/** Dia da semana (0=DOM) no fuso de Brasília — o Worker roda em UTC, então nunca usar Date#getDay(). */
export function brazilWeekday(date: Date = new Date()): number {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' }).format(date);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd);
}

/** Dia da semana de uma data YYYY-MM-DD (calendário, independe de fuso). */
export function weekdayOfDateKey(dateKey: string): number {
  return new Date(`${dateKey}T12:00:00Z`).getUTCDay();
}

export type ScheduleEmployee = {
  scheduleByDay?: string | null;
  workDays?: string | null;
  scheduleStart?: string | null;
  scheduleEnd?: string | null;
  employeeNumber?: string | null;
};

const WD_ALIASES: Record<string, string> = { SEGUNDA: 'SEG', TERCA: 'TER', QUARTA: 'QUA', QUINTA: 'QUI', SEXTA: 'SEX', SABADO: 'SAB', DOMINGO: 'DOM' };
function legacyWorkDays(value: string | null | undefined): Set<string> | null {
  if (!value || !String(value).trim()) return null;
  let raw: unknown[];
  try { const parsed = JSON.parse(value); raw = Array.isArray(parsed) ? parsed : [value]; } catch { raw = [value]; }
  const days = raw.flatMap((x) => String(x).split(/[;,\s]+/)).map((d) => d.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z]/gi, '').toUpperCase()).map((d) => WD_ALIASES[d] || d).filter((d) => (DAY_ORDER as readonly string[]).includes(d));
  return days.length ? new Set(days) : null;
}

/**
 * Escala efetiva do dia: HORÁRIO vem de scheduleByDay (fonte da verdade); o dia só é de trabalho se também
 * estiver em workDays (mesma regra da folha — evita faltas falsas quando scheduleByDay tem dias a mais).
 */
export function effectiveDaySchedule(employee: ScheduleEmployee, weekday: number): DaySchedule | null {
  const s = resolveDaySchedule(employee.scheduleByDay, employee.workDays, employee.scheduleStart, employee.scheduleEnd, weekday, employee.employeeNumber);
  if (!s) return null;
  const days = legacyWorkDays(employee.workDays);
  return !days || days.has(DAY_ORDER[weekday]) ? s : null;
}

/** Escala do dia (horário de scheduleByDay). */
export function scheduleForDateKey(employee: ScheduleEmployee, dateKey: string): DaySchedule | null {
  return effectiveDaySchedule(employee, weekdayOfDateKey(dateKey));
}

export function scheduleForNow(employee: ScheduleEmployee, now: Date = new Date()): DaySchedule | null {
  return effectiveDaySchedule(employee, brazilWeekday(now));
}

/** Resumo legível da escala a partir de scheduleByDay (ex.: "SEG–SEX 07:30–11:30" ou "SEG–SEX 08:00–17:00 · QUA 12:00–16:00"). */
export function scheduleSummary(employee: ScheduleEmployee): string {
  const groups = new Map<string, string[]>();
  for (const wd of [1, 2, 3, 4, 5, 6, 0]) {
    const s = effectiveDaySchedule(employee, wd);
    if (!s) continue;
    const key = `${s.start}–${s.end}`;
    groups.set(key, [...(groups.get(key) || []), DAY_ORDER[wd]]);
  }
  if (!groups.size) return 'Conforme escala';
  const all = DAY_ORDER.slice(1).concat(DAY_ORDER[0]).filter((d) => [...groups.values()].some((days) => days.includes(d)));
  const fmtDays = (days: string[]) => (days.join(',') === 'SEG,TER,QUA,QUI,SEX' ? 'SEG–SEX' : days.join('/'));
  const ordered = [...groups.entries()].sort((x, y) => y[1].length - x[1].length);
  const [mainKey, mainDays] = ordered[0];
  const head = `${all.join(',') === 'SEG,TER,QUA,QUI,SEX' && ordered.length > 1 ? 'SEG–SEX' : fmtDays(mainDays)} ${mainKey}`;
  return [head, ...ordered.slice(1).map(([key, days]) => `${fmtDays(days)} ${key}`)].join(' · ');
}

/** Escala de cada dia da semana (SEG..DOM) para exibir no app/painel. */
export function weekScheduleList(employee: ScheduleEmployee) {
  return [1, 2, 3, 4, 5, 6, 0].map((wd) => {
    const s = effectiveDaySchedule(employee, wd);
    return { day: DAY_ORDER[wd], start: s?.start || null, end: s?.end || null, mode: s?.mode || null };
  });
}

/** Lista contradições entre campos legados (início/fim/dias) e scheduleByDay — só para relatório. */
export function legacyScheduleConflicts(employee: ScheduleEmployee): string[] {
  const by = parseScheduleByDay(employee.scheduleByDay);
  if (!Object.keys(by).length) return [];
  const out: string[] = [];
  const ls = (employee.scheduleStart || '').slice(0, 5);
  const le = (employee.scheduleEnd || '').slice(0, 5);
  for (const [day, s] of Object.entries(by)) if (s.start !== ls || s.end !== le) out.push(`${day}: escala ${s.start}–${s.end} × legado ${ls || '--'}–${le || '--'}`);
  const wd = new Set(String(employee.workDays || '').toUpperCase().split(/[,;\s]+/).filter(Boolean));
  const bd = new Set(Object.keys(by));
  const missing = [...bd].filter((d) => !wd.has(d));
  const extra = [...wd].filter((d) => !bd.has(d));
  if (missing.length || extra.length) out.push(`dias: escala ${[...bd].join(',')} × legado ${[...wd].join(',')}`);
  return out;
}

/** Quando há escala por dia (cadastro ou fixa por matrícula), ela decide se o dia é de trabalho — workDays legado é ignorado. */
export function hasScheduleByDay(employee: ScheduleEmployee): boolean {
  if (Object.keys(parseScheduleByDay(employee.scheduleByDay)).length) return true;
  return Boolean(FIXED_SCHEDULE_BY_NUMBER[normalizeMat(employee.employeeNumber)]);
}

/** Escala "principal" (a mais frequente na semana) — para exibir quando hoje é folga. */
export function primarySchedule(employee: ScheduleEmployee): DaySchedule | null {
  const counts = new Map<string, { s: DaySchedule; n: number }>();
  for (let wd = 0; wd < 7; wd += 1) {
    const s = effectiveDaySchedule(employee, wd);
    if (!s) continue;
    const k = `${s.start}-${s.end}-${s.mode}`;
    counts.set(k, { s, n: (counts.get(k)?.n || 0) + 1 });
  }
  return [...counts.values()].sort((a, b) => b.n - a.n)[0]?.s || null;
}

/** Dias de trabalho conforme a escala por dia (ex.: "SEG–SEX" ou "TER/QUA/QUI"). */
export function workDaysLabel(employee: ScheduleEmployee): string {
  const days = [1, 2, 3, 4, 5, 6, 0].filter((wd) => effectiveDaySchedule(employee, wd)).map((wd) => DAY_ORDER[wd]);
  if (!days.length) return 'dias não informados';
  return days.join(',') === 'SEG,TER,QUA,QUI,SEX' ? 'SEG–SEX' : days.join('/');
}
