/**
 * Checklist de fechamento do mês (gaveta do card). Feriados, curso do Kaio e
 * troca de dia (jornada flexível) não entram como falta. Só leitura.
 */
import { scheduleFor, toMin, type ACEmployee } from './auto-close';
import { DISREGARDED } from './punch-duplicates';
import { getOperationalAbono } from './operational-abonos';
import { isFlexibleEmployee, monthSwapMarks, pairWeekSwaps, weekOf, type WeekDayStatus } from './day-swap';

export type ClosingPunch = { userId: string; date: string; type: string; rejected: boolean };
export type ClosingReq = { employeeId: string; type: string; status: string; start: string; end: string; reason: string | null; launchedAt: string | null };
export type ClosingCert = { userId: string; status: string; start: string; end: string };
export type ClosingEmp = ACEmployee & { jobTitle?: string | null; profileJson?: string | null; profile?: { jornadaFlexivel?: boolean } | null };
export type ClosingItem = {
  kind: 'falta' | 'incompleto' | 'aguardando' | 'troca' | 'pedido_pendente' | 'nao_lancado' | 'atestado_pendente' | 'sugestao' | 'sem_escala';
  label: string;
  days?: string[];
  n?: number;
  detail?: { reason: string; dates: string }[];
  okish?: boolean;
};
export type ClosingPerson = {
  id: string;
  name: string;
  jobTitle: string | null;
  employeeNumber: string | null;
  flexible: boolean;
  items: ClosingItem[];
  faltas: string[];
  incompletos: string[];
  waiting: string[];
  trocas: string[];
  ok: boolean;
};

const COUNTED = new Set(['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA']);
const addDays = (key: string, n: number) => {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const inRange = (start: string, end: string, day: string) => start <= day && day <= end;

function monthBounds(month: string) {
  const [y, m] = month.split('-').map(Number);
  const from = `${month}-01`;
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { from, last };
}

function punchesOn(list: ClosingPunch[], day: string) {
  return list.filter((p) => p.date === day && !p.rejected && p.type !== DISREGARDED && COUNTED.has(p.type));
}

function covered(emp: ClosingEmp, day: string, certs: ClosingCert[], reqs: ClosingReq[]) {
  const abono = getOperationalAbono(emp.employeeNumber, day);
  if (abono?.kind === 'FULL_DAY') return true;
  if (certs.some((c) => (c.status === 'ATIVO' || c.status === 'APROVADO') && inRange(c.start, c.end, day))) return true;
  if (reqs.some((r) => r.type === 'AUSENCIA' && r.status === 'APROVADO' && r.launchedAt && inRange(r.start, r.end, day))) return true;
  return false;
}

function weekStatuses(emp: ClosingEmp, punches: ClosingPunch[], certs: ClosingCert[], reqs: ClosingReq[], from: string, last: string): WeekDayStatus[] {
  const padFrom = addDays(weekOf(from).start, 0);
  const padTo = weekOf(last).end;
  const days: WeekDayStatus[] = [];
  for (let d = padFrom; d <= padTo; d = addDays(d, 1)) {
    const { schedule, scheduled } = scheduleFor(emp, d);
    days.push({
      date: d,
      scheduled: Boolean(scheduled && schedule),
      worked: punchesOn(punches, d).length > 0,
      covered: covered(emp, d, certs, reqs),
    });
  }
  return days;
}

export function buildClosing(input: {
  employees: ClosingEmp[];
  punches: ClosingPunch[];
  requests: ClosingReq[];
  certificates: ClosingCert[];
  today: string;
  month: string;
  openPendencias: { userId: string }[];
}): { people: ClosingPerson[]; totals: Record<string, number>; holidaysNote: string } {
  const { from, last } = monthBounds(input.month);
  const yesterday = addDays(input.today, -1);
  const until = yesterday < last ? yesterday : last;
  const byUser = new Map<string, ClosingPunch[]>();
  for (const p of input.punches) {
    const arr = byUser.get(p.userId) || [];
    arr.push(p);
    byUser.set(p.userId, arr);
  }
  const people: ClosingPerson[] = [];
  for (const emp of input.employees) {
    const mine = byUser.get(emp.id) || [];
    const certs = input.certificates.filter((c) => c.userId === emp.id);
    const reqs = input.requests.filter((r) => r.employeeId === emp.id);
    const flex = isFlexibleEmployee(emp);
    const statuses = flex ? weekStatuses(emp, mine, certs, reqs, from, last) : [];
    const marks = flex ? monthSwapMarks(statuses, input.today) : new Map();
    const waiting: string[] = [];
    if (flex) {
      const byWeek = new Map<string, WeekDayStatus[]>();
      for (const s of statuses) {
        const k = weekOf(s.date).start;
        byWeek.set(k, [...(byWeek.get(k) || []), s]);
      }
      for (const list of byWeek.values()) {
        list.sort((a, b) => a.date.localeCompare(b.date));
        for (const d of pairWeekSwaps(list, input.today).waiting) {
          if (d >= from && d <= until) waiting.push(d);
        }
      }
    }
    const faltas: string[] = [];
    const incompletos: string[] = [];
    const trocas: string[] = [];
    const items: ClosingItem[] = [];
    const mat = String(emp.employeeNumber || '').replace(/\D/g, '');
    const noSch = !emp.scheduleStart && !emp.scheduleEnd && !emp.scheduleByDay && mat !== '0028';
    if (noSch) items.push({ kind: 'sem_escala', label: 'Sem horário cadastrado' });

    for (let d = from; d <= until; d = addDays(d, 1)) {
      const mark = marks.get(d);
      if (mark?.role === 'MISSED' && d >= from) { trocas.push(d); continue; }
      if (waiting.includes(d)) continue;
      const { schedule, scheduled } = scheduleFor(emp, d);
      const configured = Boolean(scheduled && schedule);
      if (!configured) continue;
      if (schedule) {
        const span = toMin(schedule.end) - toMin(schedule.start);
        if (!(span > 0)) continue;
      }
      const cov = covered(emp, d, certs, reqs);
      const dayP = punchesOn(mine, d);
      const types = new Set(dayP.map((p) => p.type));
      if (!cov && !dayP.length) faltas.push(d);
      if (!cov && dayP.length && (!types.has('ENTRADA') || !types.has('SAIDA'))) incompletos.push(d);
    }

    if (faltas.length) items.push({ kind: 'falta', label: faltas.length === 1 ? '1 falta' : `${faltas.length} faltas`, days: faltas });
    if (incompletos.length) items.push({ kind: 'incompleto', label: incompletos.length === 1 ? '1 dia incompleto' : `${incompletos.length} dias incompletos`, days: incompletos });
    if (waiting.length) items.push({ kind: 'aguardando', label: `Aguardando compensação (${waiting.length})`, days: waiting });
    if (trocas.length) items.push({ kind: 'troca', label: trocas.length === 1 ? '1 troca de dia (ok)' : `${trocas.length} trocas de dia (ok)`, days: trocas, okish: true });

    const pendReq = reqs.filter((r) => r.status === 'PENDENTE' && r.start <= last && r.end >= from);
    const unlaunch = reqs.filter((r) => r.type === 'AUSENCIA' && r.status === 'APROVADO' && !r.launchedAt && r.start <= last && r.end >= from);
    const pendCert = certs.filter((c) => c.status === 'PENDENTE' && c.start <= last && c.end >= from);
    if (pendReq.length) items.push({ kind: 'pedido_pendente', label: pendReq.length === 1 ? '1 pedido pendente' : `${pendReq.length} pedidos pendentes`, n: pendReq.length, detail: pendReq.map((r) => ({ reason: r.reason || 'Pedido', dates: `${r.start}–${r.end}` })) });
    if (unlaunch.length) items.push({ kind: 'nao_lancado', label: unlaunch.length === 1 ? '1 ausência aprovada não lançada' : `${unlaunch.length} ausências aprovadas não lançadas`, n: unlaunch.length, detail: unlaunch.map((r) => ({ reason: r.reason || 'Ausência', dates: `${r.start}–${r.end}` })) });
    if (pendCert.length) items.push({ kind: 'atestado_pendente', label: pendCert.length === 1 ? '1 atestado pendente' : `${pendCert.length} atestados pendentes`, n: pendCert.length });
    const openP = input.openPendencias.filter((p) => p.userId === emp.id).length;
    if (openP) items.push({ kind: 'sugestao', label: openP === 1 ? '1 sugestão' : `${openP} sugestões`, n: openP });

    const blocking = items.filter((i) => i.kind !== 'troca');
    people.push({
      id: emp.id, name: emp.name, jobTitle: emp.jobTitle || null, employeeNumber: emp.employeeNumber,
      flexible: flex, items, faltas, incompletos, waiting, trocas, ok: blocking.length === 0,
    });
  }
  people.sort((a, b) => Number(a.ok) - Number(b.ok) || a.name.localeCompare(b.name, 'pt-BR'));
  const withIssues = people.filter((p) => !p.ok);
  const totals = {
    peopleWithIssues: withIssues.length,
    peopleOk: people.length - withIssues.length,
    employees: people.length,
    faltas: people.reduce((n, p) => n + p.faltas.length, 0),
    incompletos: people.reduce((n, p) => n + p.incompletos.length, 0),
    aguardando: people.reduce((n, p) => n + p.waiting.length, 0),
    pedidosPendentes: input.requests.filter((r) => r.status === 'PENDENTE' && r.start <= last && r.end >= from).length,
    ausenciasNaoLancadas: input.requests.filter((r) => r.type === 'AUSENCIA' && r.status === 'APROVADO' && !r.launchedAt && r.start <= last && r.end >= from).length,
    atestadosPendentes: input.certificates.filter((c) => c.status === 'PENDENTE' && c.start <= last && c.end >= from).length,
    sugestoes: input.openPendencias.length,
  };
  return {
    people,
    totals,
    holidaysNote: 'Feriados já abonados na folha (não entram como falta): 02/11 Finados e 20/11 Consciência Negra. Hoje ainda está em andamento e não entra como dia incompleto.',
  };
}

export function remainingBusinessDays(today: string, lastDay: string) {
  const days: string[] = [];
  for (let d = today; d <= lastDay; d = addDays(d, 1)) {
    const w = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (w !== 0 && w !== 6) days.push(d);
  }
  return days;
}
