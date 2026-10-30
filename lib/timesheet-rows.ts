/**
 * Cálculo das linhas da Folha de Ponto (fonte única para o PDF assinado).
 * Mesmas regras da tela de conferência (folha-ponto-panel):
 *  - Previsto = jornada do dia (escala por dia → workDays/início-fim), almoço 1h se > 6h; folga = sem previsto.
 *  - Trabalhado = (Saída int. − Entrada) + (Saída − Retorno) + abonos (atestado, ausência aprovada, feriado/abono operacional).
 *  - Falta = max(0, Previsto − Trabalhado); Saldo = Trabalhado − Previsto.
 *  - Dias FUTUROS (depois de hoje, fuso SP) não entram em nenhum total.
 *  - Atestado por horas: lib/certificate-calculation (recorta pela escala e desconta o almoço 12–13h em jornada integral).
 */
import { isPartialRequest, requestCreditMinutes } from './request-credit';
import { isScheduledDay, parseWorkDays } from './timesheet-schedule';
import { resolveDaySchedule } from './day-schedule';
import { filterPunchesOutsideCertificates } from './certificate-conflicts';
import { certificateMinutesForDay, isHourCoverage } from './certificate-calculation';
import {
  getOperationalAbono, isHolidayAbono, operationalJustifiedMinutes, shouldHidePunchesForDay, shouldSuppressAbono,
  type OperationalAbono,
} from './operational-abonos';
import { brazilDateKey } from './brazil-time';

const APP_TZ = 'America/Sao_Paulo';

export type RowsEmployee = {
  name: string; employeeNumber: string | null; workDays: string | null;
  scheduleStart: string | null; scheduleEnd: string | null; scheduleByDay?: string | null;
};
export type RowsPunch = { type: string; timestamp: Date; origin?: string | null };
export type RowsCertificate = {
  type?: string | null; startDate: Date; endDate: Date; startTime?: string | null; endTime?: string | null;
  hoursPerDayMinutes?: number | null; status: string;
};
export type RowsRequest = { type: string; startDate: Date; endDate: string | Date; status: string; reason: string; classification?: string | null; details?: string | null; returnExpected?: boolean | null };

export type SituationTone = 'ok' | 'folga' | 'feriado' | 'abono' | 'falta' | 'alerta' | 'futuro';
export type TimesheetCell = { time: string; manual: boolean } | null;
export type TimesheetRow = {
  date: string; day: number; weekday: number; future: boolean; scheduled: boolean;
  schedule: string; entrada: TimesheetCell; intervalo: TimesheetCell; retorno: TimesheetCell; saida: TimesheetCell;
  extraPunches: number;
  worked: number | null; justified: number; credited: number | null; expected: number | null;
  missing: number | null; balance: number | null;
  situation: string; tone: SituationTone; fullDayAbono: boolean;
};
export type TimesheetTotals = { worked: number; expected: number; missing: number; justified: number; balance: number; workedDays: number; absences: number };

export const CERTIFICATE_LABELS: Record<string, string> = {
  DIA_INTEGRAL: 'Atestado', PERIODO_DIAS: 'Atestado', HORAS: 'Atestado', PERIODO_HORAS: 'Atestado',
  CONSULTA_MEDICA: 'Consulta médica', SAIDA_MEDICA: 'Saída médica',
  TRABALHO_EXTERNO: 'Trabalho externo', TRABALHO_EXTERNO_HORAS: 'Trabalho externo', OUTRO: 'Atestado',
};

export function formatClock(value: number | null) {
  if (value === null) return '—';
  const abs = Math.abs(Math.round(value));
  return `${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}
/** Usa o sinal de menos tipográfico (fonte embutida suporta U+2212). */
export function formatSigned(value: number | null) {
  if (value === null) return '—';
  if (value === 0) return '00:00';
  return `${value < 0 ? '−' : '+'}${formatClock(value)}`;
}
function clockOf(value: Date) {
  return value.toLocaleTimeString('pt-BR', { timeZone: APP_TZ, hour: '2-digit', minute: '2-digit', hour12: false });
}
function keyOf(value: Date | string) {
  return typeof value === 'string' ? value.slice(0, 10) : brazilDateKey(value);
}
function certKey(value: Date | string) {
  // datas de atestado são gravadas como data (00:00Z); usar a parte de data UTC evita voltar um dia no fuso SP
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}
function minutesFromClock(value: string | null | undefined) {
  const m = value?.match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
export function workedMinutes(punches: RowsPunch[]) {
  const ordered = [...punches].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const entry = ordered.find((p) => p.type === 'ENTRADA');
  const interval = ordered.find((p) => p.type === 'INTERVALO' && entry && p.timestamp > entry.timestamp);
  const retorno = ordered.find((p) => p.type === 'RETORNO' && interval && p.timestamp > interval.timestamp);
  const saida = ordered.find((p) => p.type === 'SAIDA' && retorno && p.timestamp > retorno.timestamp);
  const pairs: Array<[Date, Date]> = [];
  if (entry && interval) pairs.push([entry.timestamp, interval.timestamp]);
  if (retorno && saida) pairs.push([retorno.timestamp, saida.timestamp]);
  if (!pairs.length && ordered.length >= 2) pairs.push([ordered[0].timestamp, ordered[ordered.length - 1].timestamp]);
  const diff = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
  return ordered.length ? pairs.reduce((t, [a, b]) => t + diff(a, b), 0) : null;
}
export function isManualPunch(p: { origin?: string | null }) {
  return p.origin === 'ADJUSTED' || p.origin === 'MANUAL';
}
function holidayName(abono: OperationalAbono) {
  return (abono.reason || 'Feriado').replace(/^feriado( nacional)?\s*[—–-]\s*/i, '').trim() || 'Feriado';
}
function conciseReason(reason: string) {
  if (/curso jovem aprendiz/i.test(reason)) return 'Curso jovem aprendiz';
  if (/mesa brasil/i.test(reason)) return 'Trabalho externo · Mesa Brasil';
  if (/trabalho externo/i.test(reason)) return 'Trabalho externo';
  if (/atestado de óbito/i.test(reason)) return 'Atestado de óbito';
  if (/vendaval/i.test(reason)) return 'Liberação por vendaval';
  return reason;
}

/** Minutos de atestado no dia, com as regras de lib/certificate-calculation. */
export function certificateDayMinutes(
  cert: RowsCertificate, date: string, dayStart: number | null, dayEnd: number | null, fullDay: boolean, expected: number | null,
) {
  const startDate = certKey(cert.startDate); const endDate = certKey(cert.endDate);
  if (startDate > date || endDate < date) return 0;
  const hours = Boolean(cert.startTime && cert.endTime) || isHourCoverage(cert);
  if (hours) {
    if (!cert.startTime || !cert.endTime) {
      if (cert.hoursPerDayMinutes == null || expected === null) return 0;
      return Math.min(expected, Math.max(0, cert.hoursPerDayMinutes));
    }
    // período por horas em vários dias: vale em cada dia do intervalo
    return certificateMinutesForDay(
      { type: cert.type, coverageType: 'HOURS', startDate, endDate, eventDate: date, startTime: cert.startTime, endTime: cert.endTime, status: cert.status },
      date, dayStart, dayEnd, fullDay, expected,
    );
  }
  return certificateMinutesForDay({ type: cert.type, coverageType: 'DAYS', startDate, endDate, status: cert.status }, date, dayStart, dayEnd, fullDay, expected);
}

export function buildTimesheetRows({
  employee, punches, certificates = [], requests = [], month, today = brazilDateKey(new Date()), extraHolidays = {},
}: {
  employee: RowsEmployee; punches: RowsPunch[]; certificates?: RowsCertificate[]; requests?: RowsRequest[];
  month: string; today?: string; extraHolidays?: Record<string, string>;
}): { rows: TimesheetRow[]; totals: TimesheetTotals } {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  const workDays = employee.workDays ? parseWorkDays(employee.workDays) : new Set(['SEG', 'TER', 'QUA', 'QUI', 'SEX']);
  const codes = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
  const rows: TimesheetRow[] = [];
  const totals: TimesheetTotals = { worked: 0, expected: 0, missing: 0, justified: 0, balance: 0, workedDays: 0, absences: 0 };

  for (let day = 1; day <= lastDay; day += 1) {
    const date = `${month}-${String(day).padStart(2, '0')}`;
    const weekday = new Date(`${date}T12:00:00-03:00`).getUTCDay();
    const future = date > today;
    const suppress = shouldSuppressAbono(employee.employeeNumber, date);
    const hide = shouldHidePunchesForDay(employee.employeeNumber, date);
    const raw = hide ? [] : punches.filter((p) => keyOf(p.timestamp) === date);
    const conflictCerts = suppress ? [] : certificates.map((c) => ({
      userId: '', type: c.type, startDate: c.startDate, endDate: c.endDate, startTime: c.startTime, endTime: c.endTime, status: c.status,
    }));
    const kept = new Set(filterPunchesOutsideCertificates(
      raw.map((p, i) => ({ id: String(i), userId: '', type: p.type, timestamp: p.timestamp, status: 'VALID' })),
      conflictCerts as any,
    ).map((p) => p.id));
    const dayPunches = raw.filter((_, i) => kept.has(String(i))).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    const daySchedule = resolveDaySchedule(employee.scheduleByDay, employee.workDays, employee.scheduleStart, employee.scheduleEnd, weekday, employee.employeeNumber);
    const scheduled = Boolean(daySchedule) && isScheduledDay(workDays, codes[weekday]);
    const dayStart = daySchedule ? minutesFromClock(daySchedule.start) : minutesFromClock(employee.scheduleStart);
    const dayEnd = daySchedule ? minutesFromClock(daySchedule.end) : minutesFromClock(employee.scheduleEnd);
    const span = dayStart !== null && dayEnd !== null ? Math.max(0, dayEnd - dayStart) : null;
    const lunch = span !== null && span > 6 * 60 ? 60 : 0;
    const expectedRaw = scheduled && span !== null ? Math.max(0, span - lunch) : null;
    const fullDay = daySchedule?.mode === 'FULL';

    const cert = suppress ? undefined : certificates.find((c) =>
      ['APROVADO', 'ATIVO'].includes(c.status) && certKey(c.startDate) <= date && certKey(c.endDate) >= date);
    const certMinutes = cert ? certificateDayMinutes(cert, date, dayStart, dayEnd, fullDay, expectedRaw) : 0;
    const request = suppress ? undefined : requests.find((r) => r.status === 'APROVADO' && (
      (r.type === 'AUSENCIA' && keyOf(r.startDate) <= date && keyOf(r.endDate) >= date)
      || (r.type === 'TROCA_DIA' && (keyOf(r.startDate) === date || keyOf(r.endDate) === date))));
    let abono = getOperationalAbono(employee.employeeNumber, date);
    if (!abono && extraHolidays[date]) abono = { kind: 'FULL_DAY', reason: `Feriado — ${extraHolidays[date]}` };
    const abonoMinutes = abono && scheduled
      ? operationalJustifiedMinutes(abono, daySchedule?.start || employee.scheduleStart, daySchedule?.end || employee.scheduleEnd, expectedRaw)
      : 0;

    const pick = (type: string): TimesheetCell => {
      const p = dayPunches.find((x) => x.type === type);
      return p ? { time: clockOf(p.timestamp), manual: isManualPunch(p) } : null;
    };
    const firsts = ['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA'].map((t) => dayPunches.find((x) => x.type === t)).filter(Boolean);
    const extraPunches = dayPunches.length - firsts.length;
    const scheduleLabel = !scheduled ? 'Folga' : daySchedule ? `${daySchedule.start}–${daySchedule.end}` : '—';

    const base = {
      date, day, weekday, future, scheduled, schedule: scheduleLabel,
      entrada: pick('ENTRADA'), intervalo: pick('INTERVALO'), retorno: pick('RETORNO'), saida: pick('SAIDA'), extraPunches,
    };
    if (future) {
      rows.push({ ...base, entrada: null, intervalo: null, retorno: null, saida: null, extraPunches: 0, worked: null, justified: 0, credited: null, expected: null, missing: null, balance: null, situation: scheduled ? '—' : 'Folga', tone: scheduled ? 'futuro' : 'folga', fullDayAbono: false });
      continue;
    }

    const worked = workedMinutes(dayPunches);
    const requestMinutes = request ? requestCreditMinutes(request, expectedRaw, worked, dayStart, dayEnd) : 0;
    const requestPartial = request ? isPartialRequest(request) : false;
    const justified = suppress ? 0 : Math.max(certMinutes, requestMinutes, abonoMinutes);
    const credited = worked === null ? (justified > 0 ? justified : (expectedRaw !== null ? 0 : null)) : worked + justified;
    const expected = expectedRaw;
    const balance = credited === null || expected === null ? null : credited - expected;
    const missing = credited === null || expected === null ? null : Math.max(0, expected - credited);
    const plus = justified > 0 ? ` · +${formatClock(justified)}` : '';

    let situation = 'OK'; let tone: SituationTone = 'ok'; let fullDayAbono = false;
    const types = new Set(dayPunches.map((p) => p.type));
    if (!scheduled && !dayPunches.length) { situation = 'Folga'; tone = 'folga'; }
    else if (abono && abonoMinutes > 0 && justified === abonoMinutes && isHolidayAbono(abono)) {
      situation = `Feriado · ${holidayName(abono)}${plus}`; tone = 'feriado'; fullDayAbono = !dayPunches.length;
    } else if (cert && certMinutes > 0 && justified === certMinutes) {
      const label = CERTIFICATE_LABELS[cert.type || ''] || 'Atestado';
      const range = cert.startTime && cert.endTime ? `${cert.startTime.slice(0, 5)}–${cert.endTime.slice(0, 5)}` : (certMinutes >= (expected || 0) ? 'dia' : formatClock(certMinutes));
      situation = range === 'dia' ? `${label} · dia${plus}` : `${label} ${range}${plus}`; tone = 'abono'; fullDayAbono = !dayPunches.length;
    } else if (request?.type === 'AUSENCIA' && requestMinutes > 0) {
      situation = `${request.reason || 'Ausência aprovada'} · ${requestPartial ? 'parcial' : 'dia'}${plus}`; tone = 'abono'; fullDayAbono = !dayPunches.length;
    } else if (abono && abonoMinutes > 0) {
      const end = (daySchedule?.end || employee.scheduleEnd || '').slice(0, 5);
      const period = abono.kind === 'FROM_TIME' && abono.fromTime ? `${abono.fromTime.slice(0, 5)}–${end}` : 'dia';
      situation = `${conciseReason(abono.reason)} · ${period}${plus}`; tone = 'abono'; fullDayAbono = !dayPunches.length;
    } else if (scheduled && !dayPunches.length) { situation = 'Falta'; tone = 'falta'; totals.absences += 1; }
    else if (scheduled && (!types.has('ENTRADA') || !types.has('SAIDA'))) { situation = 'Incompleto'; tone = 'alerta'; }
    else if (request?.type === 'TROCA_DIA') { situation = 'Troca de dia'; tone = 'ok'; }
    if (extraPunches > 0 && tone !== 'falta') situation += ` · +${extraPunches} marc.`;

    if (credited !== null && (expected !== null || worked !== null)) totals.worked += credited;
    if (expected !== null) totals.expected += expected;
    if (missing !== null) totals.missing += missing;
    if (balance !== null) totals.balance += balance;
    else if (expected === null && worked !== null) totals.balance += credited || 0; // trabalho em folga = saldo positivo
    totals.justified += justified;
    if (worked !== null) totals.workedDays += 1;

    rows.push({ ...base, worked, justified, credited: expected === null && worked === null ? null : credited, expected, missing, balance: balance ?? (expected === null && worked !== null ? worked : null), situation, tone, fullDayAbono });
  }
  return { rows, totals };
}
