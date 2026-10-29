/**
 * Checklist de atestados — auditoria mensal (prova contra contestações).
 * Cruza, por funcionário e dia, as ocorrências do ponto (falta, manhã sem entrada/atraso,
 * saída antecipada, ajustes * e solicitações do app) com os atestados/ausências lançados.
 * Somente LEITURA: não cria nem altera marcações (Portaria 671). Reaproveita a escala de
 * lib/day-schedule (a mesma usada por lib/auto-adjust e lib/inconsistency-fill).
 */
import { resolveDaySchedule } from './day-schedule';
import { toClock, toMinutes } from './inconsistency-fill';
import type { AdjustEmployee } from './auto-adjust';

export type ChecklistPunch = { userId: string; date: string; type: string; minutes: number; manual?: boolean };
export type ChecklistCertificate = { id: string; userId: string; type: string; startDate: string; endDate: string; startTime?: string | null; endTime?: string | null; status: string; documentName?: string | null; observation?: string | null };
export type ChecklistRequest = { id: string; employeeId: string; type: string; status: string; startDate: string; endDate: string; reason?: string | null };
export type OccurrenceKind = 'FALTA' | 'MANHA_SEM_ENTRADA' | 'ATRASO' | 'SAIDA_ANTECIPADA' | 'AJUSTE' | 'SOLICITACAO' | 'ABONO_FORA';
export type ChecklistStatus = 'COBERTO' | 'SEM_DOCUMENTO' | 'PARCIAL' | 'FORA_JORNADA' | 'AJUSTE_CONFLITA' | 'AJUSTE_OK';
export type Occurrence = {
  key: string; employeeId: string; employeeName: string; date: string; kind: OccurrenceKind; label: string;
  window: string; gapMinutes: number; status: ChecklistStatus; certificateId?: string; documentLabel?: string;
  abonoMinutes: number; detail?: string;
};

export const STATUS_LABEL: Record<ChecklistStatus, string> = {
  COBERTO: 'Coberto por atestado', SEM_DOCUMENTO: 'Sem documento', PARCIAL: 'Parcial · horário não bate',
  FORA_JORNADA: 'Fora da jornada', AJUSTE_CONFLITA: 'Ajuste * conflita', AJUSTE_OK: 'Ajuste * sem documento',
};
export const LATE_TOLERANCE = 10;      // minutos (art. 58 §1º CLT)
export const MORNING_GAP = 120;        // ≥ 2h sem entrada = "manhã sem entrada"
const TYPE_PT: Record<string, string> = { ENTRADA: 'entrada', INTERVALO: 'saída almoço', RETORNO: 'retorno', SAIDA: 'saída' };
const CERT_PT: Record<string, string> = { DIA_INTEGRAL: 'Atestado', PERIODO_DIAS: 'Atestado', HORAS: 'Declaração', PERIODO_HORAS: 'Declaração', CONSULTA_MEDICA: 'Consulta médica', SAIDA_MEDICA: 'Saída médica', TRABALHO_EXTERNO: 'Trabalho externo', TRABALHO_EXTERNO_HORAS: 'Trabalho externo', OUTRO: 'Documento' };

const eachDay = (from: string, to: string) => { const out: string[] = []; const d = new Date(`${from}T12:00:00Z`); const e = new Date(`${to}T12:00:00Z`); while (d <= e) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); } return out; };
const overlap = (a: [number, number], b: [number, number]) => Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));
export const fmtHours = (min: number) => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;

function certWindow(c: ChecklistCertificate): [number, number] | null {
  const s = toMinutes(c.startTime ?? null); const e = toMinutes(c.endTime ?? null);
  return s !== null && e !== null && e > s ? [s, e] : null; // null = dia inteiro
}
const certLabel = (c: ChecklistCertificate) => { const w = certWindow(c); return `${CERT_PT[c.type] || 'Documento'}${w ? ` · ${c.startTime}–${c.endTime}` : ' · dia inteiro'}`; };

/** Cobertura de um intervalo sem trabalho pelo(s) documento(s) do dia. */
function cover(gap: [number, number], certs: ChecklistCertificate[]) {
  if (!certs.length) return { status: 'SEM_DOCUMENTO' as ChecklistStatus, abono: 0 };
  const full = certs.find((c) => !certWindow(c));
  if (full) return { status: 'COBERTO' as ChecklistStatus, abono: gap[1] - gap[0], cert: full };
  let covered = 0; let best = certs[0];
  for (const c of certs) { const o = overlap(gap, certWindow(c)!); if (o > covered) { covered = o; best = c; } }
  const need = gap[1] - gap[0];
  if (covered >= need - LATE_TOLERANCE) return { status: 'COBERTO' as ChecklistStatus, abono: covered, cert: best };
  if (covered > 0) return { status: 'PARCIAL' as ChecklistStatus, abono: covered, cert: best };
  return { status: 'PARCIAL' as ChecklistStatus, abono: 0, cert: best }; // há documento no dia, mas o horário não bate
}

/** Trechos efetivamente trabalhados segundo as batidas ORIGINAIS (entrada/retorno → intervalo/saída). */
function workedSegments(ps: ChecklistPunch[]): [number, number][] {
  const out: [number, number][] = []; let open: number | null = null;
  for (const p of ps) { if (p.type === 'ENTRADA' || p.type === 'RETORNO') open = p.minutes; else if (open !== null && (p.type === 'INTERVALO' || p.type === 'SAIDA')) { out.push([open, p.minutes]); open = null; } }
  return out;
}

/** Feriados nacionais (fixos + Sexta-feira Santa). Feriados estaduais/municipais podem ser passados em `holidays`. */
export function nationalHolidays(year: number): string[] {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const easter = new Date(Date.UTC(year, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1));
  const goodFriday = new Date(easter.getTime() - 2 * 86400000).toISOString().slice(0, 10);
  return [...['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'].map((x) => `${year}-${x}`), goodFriday];
}

export function buildChecklist(input: { employees: AdjustEmployee[]; punches: ChecklistPunch[]; certificates: ChecklistCertificate[]; requests: ChecklistRequest[]; month: string; untilDate: string; holidays?: string[] }): Occurrence[] {
  const { month, untilDate } = input;
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const holidays = [...nationalHolidays(Number(month.slice(0, 4))), ...(input.holidays || [])];
  const days = eachDay(`${month}-01`, `${month}-${String(last).padStart(2, '0')}`).filter((d) => d < untilDate && !holidays.includes(d));
  const certs = input.certificates.filter((c) => c.status === 'ATIVO');
  const certsOn = (uid: string, d: string) => certs.filter((c) => c.userId === uid && c.startDate.slice(0, 10) <= d && c.endDate.slice(0, 10) >= d);
  const byDay = new Map<string, ChecklistPunch[]>();
  for (const p of input.punches) { const k = `${p.userId}|${p.date}`; byDay.set(k, [...(byDay.get(k) || []), p]); }
  const out: Occurrence[] = [];

  for (const e of input.employees) {
    for (const d of days) {
      const weekday = new Date(`${d}T12:00:00-03:00`).getUTCDay();
      const sch = resolveDaySchedule(e.scheduleByDay, e.workDays, e.scheduleStart, e.scheduleEnd, weekday, e.employeeNumber);
      const list = (byDay.get(`${e.id}|${d}`) || []).slice().sort((a, b) => a.minutes - b.minutes);
      const originals = list.filter((p) => !p.manual); const manuals = list.filter((p) => p.manual);
      const dayCerts = certsOn(e.id, d);
      const base = { employeeId: e.id, employeeName: e.name, date: d };
      const push = (o: Omit<Occurrence, 'employeeId' | 'employeeName' | 'date'>) => out.push({ ...base, ...o });
      const sStart = sch ? toMinutes(sch.start) : null; const sEnd = sch ? toMinutes(sch.end) : null;

      if (sch && sStart !== null && sEnd !== null) {
        if (!list.length) {
          const c = cover([sStart, sEnd], dayCerts);
          push({ key: `${e.id}|${d}|FALTA`, kind: 'FALTA', label: 'Falta', window: 'Dia integral', gapMinutes: sEnd - sStart, status: c.status, certificateId: c.cert?.id, documentLabel: c.cert ? certLabel(c.cert) : undefined, abonoMinutes: c.abono });
        } else if (originals.length) {
          const firstEntry = originals.find((p) => p.type === 'ENTRADA');
          const firstAny = originals[0];
          const startAt = firstEntry && firstEntry.minutes === firstAny.minutes ? firstEntry.minutes : firstAny.minutes;
          if (startAt - sStart > LATE_TOLERANCE) {
            const morning = startAt - sStart >= MORNING_GAP || !firstEntry;
            const c = cover([sStart, startAt], dayCerts);
            push({ key: `${e.id}|${d}|${morning ? 'MANHA' : 'ATRASO'}`, kind: morning ? 'MANHA_SEM_ENTRADA' : 'ATRASO', label: morning ? 'Manhã sem entrada' : 'Atraso', window: `${sch.start}–${toClock(startAt)}`, gapMinutes: startAt - sStart, status: c.status, certificateId: c.cert?.id, documentLabel: c.cert ? certLabel(c.cert) : undefined, abonoMinutes: c.abono });
          }
          const lastExit = [...originals].reverse().find((p) => p.type === 'SAIDA');
          if (lastExit && sEnd - lastExit.minutes > LATE_TOLERANCE) {
            const c = cover([lastExit.minutes, sEnd], dayCerts);
            push({ key: `${e.id}|${d}|SAIDA`, kind: 'SAIDA_ANTECIPADA', label: 'Saída antecipada', window: `${toClock(lastExit.minutes)}–${sch.end}`, gapMinutes: sEnd - lastExit.minutes, status: c.status, certificateId: c.cert?.id, documentLabel: c.cert ? certLabel(c.cert) : undefined, abonoMinutes: c.abono });
          }
        }
      }
      // Ajustes * (inclusões manuais): conflitam quando caem dentro de um período abonado
      for (const m of manuals) {
        const hit = dayCerts.find((c) => { const w = certWindow(c); return !w || (m.minutes >= w[0] && m.minutes <= w[1]); });
        push({ key: `${e.id}|${d}|AJUSTE|${m.type}|${m.minutes}`, kind: 'AJUSTE', label: `Ajuste * ${TYPE_PT[m.type] || m.type.toLowerCase()} ${toClock(m.minutes)}*`, window: `${toClock(m.minutes)}*`, gapMinutes: 0, status: hit ? 'AJUSTE_CONFLITA' : 'AJUSTE_OK', certificateId: hit?.id, documentLabel: hit ? certLabel(hit) : undefined, abonoMinutes: 0, detail: hit ? `Há ${certLabel(hit)} no dia: sugestão é cancelar o ajuste * e abonar pelo documento (a marcação original não é alterada).` : undefined });
      }
      // Abono por horas lançado num período em que a pessoa estava trabalhando (ex.: terapia 17–18 sem saída antecipada)
      for (const c of dayCerts) {
        const w = certWindow(c); if (!w || !originals.length) continue;
        const outsideSchedule = !sch || (sStart !== null && sEnd !== null && overlap(w, [sStart, sEnd]) === 0);
        const workedThrough = workedSegments(originals).some(([a, b]) => w[0] >= a && w[1] <= b);
        if (outsideSchedule || workedThrough) push({ key: `${e.id}|${d}|FORA|${c.id}`, kind: 'ABONO_FORA', label: 'Abono sem ausência no ponto', window: `${c.startTime}–${c.endTime}`, gapMinutes: 0, status: 'FORA_JORNADA', certificateId: c.id, documentLabel: certLabel(c), abonoMinutes: w[1] - w[0], detail: outsideSchedule ? 'O abono está fora da jornada do dia.' : 'O ponto mostra a pessoa trabalhando nesse horário — revise se o abono é necessário.' });
      }
    }
  }
  // Solicitações feitas no app (ausência/atraso/esqueci ponto) dentro do mês
  for (const r of input.requests) {
    if (['RECUSADA', 'REJEITADA', 'CANCELADA', 'REJEITADO', 'CANCELADO'].includes(r.status)) continue;
    const emp = input.employees.find((x) => x.id === r.employeeId); if (!emp) continue;
    const d = r.startDate.slice(0, 10); if (d.slice(0, 7) !== month) continue;
    const c = certsOn(r.employeeId, d)[0];
    out.push({ key: `${r.employeeId}|${d}|APP|${r.id}`, employeeId: r.employeeId, employeeName: emp.name, date: d, kind: 'SOLICITACAO', label: `Solicitação no app${r.reason ? ` · ${r.reason.slice(0, 40)}` : ''}`, window: r.endDate.slice(0, 10) !== d ? `até ${r.endDate.slice(8, 10)}/${r.endDate.slice(5, 7)}` : '—', gapMinutes: 0, status: c ? 'COBERTO' : 'SEM_DOCUMENTO', certificateId: c?.id, documentLabel: c ? certLabel(c) : undefined, abonoMinutes: 0, detail: `Status no app: ${r.status}` });
  }
  return out.sort((a, b) => a.employeeName.localeCompare(b.employeeName) || a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
}

export type ChecklistEvent = { action: string; key?: string; actorName?: string; createdAt: string; note?: string };
/** Estado vigente por ocorrência = último evento registrado na trilha de auditoria. */
export function verificationState(events: ChecklistEvent[]) {
  const state: Record<string, { verified: boolean; charged: boolean; by?: string; at?: string }> = {};
  for (const ev of [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (!ev.key) continue;
    const cur = state[ev.key] || { verified: false, charged: false };
    if (ev.action === 'CHECKLIST_VERIFIED') state[ev.key] = { ...cur, verified: true, by: ev.actorName, at: ev.createdAt };
    else if (ev.action === 'CHECKLIST_UNVERIFIED') state[ev.key] = { ...cur, verified: false, by: ev.actorName, at: ev.createdAt };
    else if (ev.action === 'CHECKLIST_CHARGED') state[ev.key] = { ...cur, charged: true };
  }
  return state;
}
export const canClose = (occ: Occurrence[], state: ReturnType<typeof verificationState>) => occ.length > 0 && occ.every((o) => state[o.key]?.verified);
