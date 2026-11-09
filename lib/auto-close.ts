/**
 * Verificação automática das 17:20 (America/Sao_Paulo).
 * Lógica PURA (sem banco) para ser testada com casos reais.
 *
 * Regras (Portaria 671): nunca altera batida original; só PROPÕE inserir a batida que falta como ajuste (*).
 *  - 3 batidas num dia integral, tudo coerente → AUTO (insere a que falta pelo horário da escala, almoço redondo).
 *  - ≤2 batidas, tipo estranho, sem foto, fora da escala, pedido do app, atestado/declaração parcial, dúvida → PENDÊNCIA.
 *  - Escala que termina depois das 17:20, ou dia ainda sem Saída às 17:20 → ADIADO (re-checa às 08:00 do dia seguinte).
 */
import { resolveDaySchedule, type DaySchedule } from './day-schedule';
import { isScheduledDay, parseWorkDays } from './timesheet-schedule';
import { getOperationalAbono, shouldSuppressAbono } from './operational-abonos';
import { label as typeLabel, roundLunchTime } from './day-guards';

export const AUTO_CLOSE_REASON = 'Ajuste automático 17:20';
export const CUTOFF_MINUTES = 17 * 60 + 20;
export const PUNCH_ORDER = ['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA'] as const;
const CODES = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'];
const HOURLY = new Set(['HORAS', 'PERIODO_HORAS', 'TRABALHO_EXTERNO_HORAS', 'CONSULTA_MEDICA', 'SAIDA_MEDICA']);
const ACTIVE = new Set(['ATIVO', 'APROVADO']);

export type ACEmployee = { id: string; name: string; employeeNumber: string | null; workDays: string | null; scheduleStart: string | null; scheduleEnd: string | null; scheduleByDay: string | null };
export type ACPunch = { id: string; type: string; timestamp: Date | string; status: string; origin?: string | null; hasPhoto: boolean; clientId?: string | null };
export type ACCert = { id: string; type: string; startDate: Date | string; endDate: Date | string; startTime?: string | null; endTime?: string | null; status: string };
export type ACRequest = { id: string; type: string; status: string; startDate: Date | string; endDate: Date | string; launchedAt?: Date | string | null; reason?: string | null; details?: string | null };
export type Phase = 'TARDE' | 'MANHA' | 'COMPLETO';

export type SuggestionPunch = { type: string; time: string };
export type Suggestion =
  | { kind: 'INSERT_PUNCHES'; punches: SuggestionPunch[]; text: string }
  | { kind: 'DIA_EXTRA'; text: string }
  | { kind: 'LAUNCH_REQUEST'; requestId: string; text: string }
  | { kind: 'TEXT'; text: string };

export type Check = { label: string; ok: boolean };
export type DayDecision = {
  outcome: 'OK' | 'SKIP' | 'DEFER' | 'AUTO' | 'PENDENCIA';
  reason: string;
  employeeId: string; employeeName: string; date: string;
  schedule: DaySchedule | null; scheduled: boolean;
  punchesText: string;
  checks: Check[];
  proposal?: SuggestionPunch;
  pendencia?: { kind: string; title: string; detail: string; suggestion: Suggestion | null };
  /** Esquecimento de batida → entra nas ocorrências do colaborador. */
  forgotten: boolean;
};

export const hmOf = (v: Date | string) => new Date(v).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false });
export const dateKeyOf = (v: Date | string) => new Date(v).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
export const toMin = (hhmm: string) => { const m = String(hhmm).match(/^(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
export const toHm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
/** Datas de atestado são gravadas ao meio-dia UTC: usa a parte UTC da data. */
const certKey = (v: Date | string) => new Date(v).toISOString().slice(0, 10);

export function weekdayOf(date: string) { return new Date(`${date}T12:00:00-03:00`).getUTCDay(); }

export function scheduleFor(employee: ACEmployee, date: string) {
  const weekday = weekdayOf(date);
  const schedule = resolveDaySchedule(employee.scheduleByDay, employee.workDays, employee.scheduleStart, employee.scheduleEnd, weekday, employee.employeeNumber);
  const workDays = employee.workDays ? parseWorkDays(employee.workDays) : new Set(['SEG', 'TER', 'QUA', 'QUI', 'SEX']);
  const scheduled = Boolean(schedule) && isScheduledDay(workDays, CODES[weekday]);
  return { schedule, scheduled, weekdayCode: CODES[weekday] };
}

/** Escala termina depois das 17:20 → só dá para fechar na manhã seguinte. */
export function endsAfterCutoff(schedule: DaySchedule | null) {
  return Boolean(schedule && toMin(schedule.end) > CUTOFF_MINUTES);
}

/** Completa as batidas que faltam: Entrada/Saída pela escala, almoço redondo (múltiplo de 30 min). */
export function fillMissing(present: { type: string; min: number }[], schedule: DaySchedule | null, required: readonly string[]): SuggestionPunch[] | null {
  if (!schedule) return null;
  const byType = new Map(present.map((p) => [p.type, p.min]));
  const out: SuggestionPunch[] = [];
  const all = new Map(byType);
  for (const type of required) {
    if (byType.has(type)) continue;
    let min: number;
    if (type === 'ENTRADA') min = toMin(schedule.start);
    else if (type === 'SAIDA') min = toMin(schedule.end);
    else if (type === 'INTERVALO') min = all.has('RETORNO') ? toMin(roundLunchTime(toHm(all.get('RETORNO')! - 60))) : 12 * 60;
    else min = all.has('INTERVALO') ? toMin(roundLunchTime(toHm(all.get('INTERVALO')! + 60))) : 13 * 60;
    if (Number.isNaN(min)) return null;
    all.set(type, min);
    out.push({ type, time: toHm(min) });
  }
  // Ordem cronológica Entrada < Intervalo < Retorno < Saída, com pelo menos 2 min entre batidas.
  const seq = required.map((t) => all.get(t)!);
  for (let i = 1; i < seq.length; i += 1) if (!(seq[i] - seq[i - 1] >= 2)) return null;
  return out;
}

export function evaluateDay({ employee, date, punches, certificates = [], requests = [], phase = 'COMPLETO', undoneTypes = [] }: {
  employee: ACEmployee; date: string; punches: ACPunch[]; certificates?: ACCert[]; requests?: ACRequest[]; phase?: Phase; undoneTypes?: string[];
}): DayDecision {
  const valid = normalizePunches(punches.filter((p) => p.status === 'VALID' && dateKeyOf(p.timestamp) === date));
  const { schedule, scheduled } = scheduleFor(employee, date);
  const punchesText = valid.length ? valid.map((p) => `${hmOf(p.timestamp)} ${typeLabel(p.type)}${p.hasPhoto ? '' : (isManual(p) ? '*' : ' (sem foto)')}`).join(' · ') : 'nenhuma batida';
  const base = { employeeId: employee.id, employeeName: employee.name, date, schedule, scheduled, punchesText, checks: [] as Check[], forgotten: false };
  const checks = base.checks;
  const pend = (kind: string, title: string, detail: string, suggestion: Suggestion | null, forgotten: boolean): DayDecision =>
    ({ ...base, outcome: 'PENDENCIA', reason: title, pendencia: { kind, title, detail, suggestion }, forgotten: forgotten && valid.length > 0 });

  const suppress = shouldSuppressAbono(employee.employeeNumber, date);
  const ops = suppress ? null : getOperationalAbono(employee.employeeNumber, date);
  if (ops?.kind === 'FULL_DAY') return { ...base, outcome: 'SKIP', reason: ops.reason };
  const dayCerts = suppress ? [] : certificates.filter((c) => ACTIVE.has(c.status) && certKey(c.startDate) <= date && certKey(c.endDate) >= date);
  const extraDay = dayCerts.some((c) => c.type === 'DIA_EXTRA');
  const fullCert = dayCerts.find((c) => c.type !== 'DIA_EXTRA' && !HOURLY.has(c.type) && !(c.startTime && c.endTime));
  if (fullCert) return { ...base, outcome: 'SKIP', reason: `Atestado/abono do dia (${fullCert.type})` };
  const partialCerts = dayCerts.filter((c) => c.type !== 'DIA_EXTRA' && c !== fullCert);

  if (!scheduled && !extraDay) {
    if (!valid.length) return { ...base, outcome: 'SKIP', reason: 'Folga (fora da escala)' };
    return pend('FORA_ESCALA', 'Fora da escala', `Bateu ponto num dia fora da escala da ficha (${punchesText}).`, { kind: 'DIA_EXTRA', text: 'Lançar como Dia extra (hora extra, soma no mês). Se a escala mudou, corrija a ficha.' }, false);
  }
  if (phase === 'TARDE' && endsAfterCutoff(schedule)) return { ...base, outcome: 'DEFER', reason: `Escala até ${schedule!.end}: re-checa amanhã de manhã` };
  // Às 17:20 quem ainda não bateu a saída pode estar fazendo hora extra: gravar Saída* agora
  // encerraria a jornada e bloquearia a saída real no totem. Decide às 08:00 do dia seguinte.
  if (phase === 'TARDE' && valid.length > 0 && !valid.some((p) => p.type === 'SAIDA')) return { ...base, outcome: 'DEFER', reason: 'Ainda sem saída às 17:20 (pode estar em hora extra): confere amanhã às 08:00' };

  const half = schedule?.mode === 'HALF' || (schedule ? toMin(schedule.end) - toMin(schedule.start) <= 6 * 60 : false);
  const required: readonly string[] = half ? ['ENTRADA', 'SAIDA'] : PUNCH_ORDER;
  const types = valid.map((p) => p.type);
  const distinct = new Set(types);
  const inOrder = types.every((t, i) => i === 0 || PUNCH_ORDER.indexOf(t as any) > PUNCH_ORDER.indexOf(types[i - 1] as any));
  const complete = required.every((t) => distinct.has(t)) && inOrder && types.length === required.length;
  if (complete) return { ...base, outcome: 'OK', reason: 'Dia completo' };

  // Pedido do app (pendente, ou aprovado e ainda não lançado) no dia → dúvida, o gestor decide.
  const dayRequests = requests.filter((r) => ['PENDENTE', 'APROVADO'].includes(r.status) && dateKeyOf(r.startDate) <= date && dateKeyOf(r.endDate) >= date);
  const unlaunched = dayRequests.find((r) => r.status === 'PENDENTE' || (r.status === 'APROVADO' && !r.launchedAt));
  checks.push({ label: 'Pedidos do app não lançados', ok: !unlaunched });
  if (unlaunched) {
    const what = `${unlaunched.type === 'ESQUECI_PONTO' ? 'Pedido "esqueci de bater"' : 'Pedido do app'} ${unlaunched.status === 'PENDENTE' ? 'pendente' : 'aprovado e não lançado'}: "${String(unlaunched.reason || '').slice(0, 80)}"`;
    return pend('PEDIDO_NAO_LANCADO', 'Pedido do app não lançado', `${punchesText}. ${what}.`, unlaunched.status === 'APROVADO' ? { kind: 'LAUNCH_REQUEST', requestId: unlaunched.id, text: 'Dúvida: o pedido explica o dia? Se valer, lance na folha.' } : { kind: 'TEXT', text: 'Aprove ou recuse o pedido em Solicitações antes de ajustar.' }, true);
  }
  checks.push({ label: 'Atestados e abonos', ok: !partialCerts.length && ops?.kind !== 'FROM_TIME' });
  if (partialCerts.length || ops?.kind === 'FROM_TIME') {
    const c = partialCerts[0];
    const what = c ? `${c.type}${c.startTime ? ` ${c.startTime}–${c.endTime}` : ''}` : String(ops?.reason);
    return pend('CONFLITO', 'Abono parcial no dia', `${punchesText}. Existe abono/declaração parcial (${what}); a batida que falta pode ser legítima.`, { kind: 'TEXT', text: 'Confira se a declaração cobre o horário que falta antes de ajustar.' }, false);
  }

  if (!valid.length) return pend('SEM_BATIDAS', 'Sem nenhuma batida', `Dia de escala (${schedule?.start}–${schedule?.end}) sem batida, atestado ou abono.`, { kind: 'TEXT', text: 'Falta? Se tiver justificativa, lance no Dia do colaborador.' }, false);

  // Duplicadas (mesmo tipo repetido ou < 2 min).
  const dupType = types.find((t, i) => types.indexOf(t) !== i);
  const nearDup = valid.find((p, i) => i > 0 && +new Date(p.timestamp) - +new Date(valid[i - 1].timestamp) < 2 * 60_000);
  checks.push({ label: 'Sobreposição e duplicadas', ok: !dupType && !nearDup });
  checks.push({ label: 'Tipo de cada batida', ok: inOrder && !dupType });
  if (dupType || nearDup || !inOrder) {
    const hint = wrongTypeHint(valid, required);
    return pend('TIPO_ERRADO', 'Tipo de batida estranho', `${punchesText}. ${dupType ? `${typeLabel(dupType)} repetido.` : nearDup ? 'Batidas a menos de 2 min.' : 'Sequência fora de ordem.'}`, { kind: 'TEXT', text: hint }, true);
  }
  if (types.length > required.length) return pend('CONFLITO', 'Batidas a mais', `${punchesText}.`, { kind: 'TEXT', text: 'Confira e cancele a batida indevida no Dia do colaborador.' }, false);

  const present = valid.map((p) => ({ type: p.type, min: toMin(hmOf(p.timestamp)) }));
  const fill = fillMissing(present, schedule, required);
  const photosOk = valid.every((p) => p.hasPhoto || isManual(p));
  checks.push({ label: `Fotos das ${valid.length} batidas`, ok: photosOk });
  checks.push({ label: `Escala do dia${schedule ? ` (${schedule.start}–${schedule.end})` : ''}`, ok: Boolean(schedule) });
  const lastType = types[types.length - 1];
  // Intervalo como última batida às ≥13:30 sem volta → provavelmente era Saída (não corrige sozinho).
  const lastIsLateBreak = lastType === 'INTERVALO' && present[present.length - 1].min >= 13 * 60 + 30 && !half;

  if (!half && valid.length === 3 && fill && fill.length === 1 && photosOk && !undoneTypes.includes(fill[0].type)) {
    checks.push({ label: 'Almoço em horário redondo', ok: true });
    return { ...base, outcome: 'AUTO', reason: `Falta ${typeLabel(fill[0].type)}`, proposal: fill[0], forgotten: true };
  }
  if (lastIsLateBreak) return pend('TIPO_ERRADO', 'Saída marcada como Intervalo?', `${punchesText}. A última batida é Intervalo às ${toHm(present[present.length - 1].min)} e não há volta.`, { kind: 'TEXT', text: `Sugestão: mudar o tipo da batida das ${toHm(present[present.length - 1].min)} para Saída (Ajustar).` }, true);

  const why = !photosOk ? 'batida sem foto' : !schedule ? 'sem escala no cadastro' : !fill ? 'o horário da escala não encaixa nas batidas' : undoneTypes.length ? 'um ajuste automático deste dia foi desfeito' : `${valid.length} batida(s)`;
  const kind = !photosOk ? 'SEM_FOTO' : 'POUCAS_BATIDAS';
  const missingLabels = required.filter((t) => !distinct.has(t)).map(typeLabel).join(', ');
  const suggestion: Suggestion | null = fill && fill.length
    ? { kind: 'INSERT_PUNCHES', punches: fill, text: `Sugestão: ${fill.map((p) => `${typeLabel(p.type)} ${p.time}*`).join(' e ')}.${lastType === 'SAIDA' && present[present.length - 1].min < toMin(schedule!.end) - 5 ? ` Saída antecipada às ${toHm(present[present.length - 1].min)} fica como está.` : ''}` }
    : { kind: 'TEXT', text: 'Sem sugestão segura: informe os horários no Ajustar.' };
  return pend(kind, valid.length <= 2 ? `Só ${valid.length} batida${valid.length > 1 ? 's' : ''}` : `Falta ${missingLabels}`, `${punchesText}. Falta: ${missingLabels} (${why}).`, suggestion, true);
}

/**
 * Quando o gestor lançou uma batida manual (*) no mesmo minuto de uma original de outro tipo
 * (ex.: Saída* 15:58 ao lado do Intervalo 15:58), a manual é a correção: a original não conta na análise.
 */
export function normalizePunches(list: ACPunch[]) {
  const sorted = [...list].sort((a, b) => +new Date(a.timestamp) - +new Date(b.timestamp));
  const manual = sorted.filter((p) => isManual(p) && !p.hasPhoto);
  return sorted.filter((p) => isManual(p) && !p.hasPhoto ? true : !manual.some((m) => m.type !== p.type && Math.abs(+new Date(m.timestamp) - +new Date(p.timestamp)) < 60_000));
}

function isManual(p: ACPunch) {
  return p.origin === 'ADJUSTED' || String(p.clientId || '').startsWith('manual-') || String(p.clientId || '').startsWith('auto-');
}

function wrongTypeHint(valid: ACPunch[], required: readonly string[]) {
  const n = valid.length;
  if (n === required.length) {
    const wrong = valid.map((p, i) => ({ p, want: required[i] })).filter((x) => x.p.type !== x.want);
    if (wrong.length) return `Sugestão: ${wrong.map((x) => `a batida das ${hmOf(x.p.timestamp)} está como ${typeLabel(x.p.type)}, deveria ser ${typeLabel(x.want)}`).join('; ')} (Ajustar).`;
  }
  return 'Confira os tipos das batidas no Ajustar (uma Saída pode ter sido marcada como Intervalo).';
}

export function summarize(decisions: DayDecision[]) {
  const count = (o: DayDecision['outcome']) => decisions.filter((d) => d.outcome === o).length;
  return { total: decisions.length, ok: count('OK'), skip: count('SKIP'), defer: count('DEFER'), auto: count('AUTO'), pendencias: count('PENDENCIA'), forgotten: decisions.filter((d) => d.forgotten).length };
}
