/**
 * Verificação automática das 17:20 (America/Sao_Paulo).
 * Lógica PURA (sem banco) para ser testada com casos reais.
 *
 * Regras (Portaria 671): nunca altera batida original; só PROPÕE a leitura correta (tipo efetivo, tabela separada)
 * e a batida que falta como ajuste (*).
 *  - Leitura inteligente (lib/punch-classifier): escala do dia + hábito pessoal + duração do almoço, com confiança.
 *  - 3 batidas num dia integral, confiança ≥ 75% → AUTO (no modo teste vira sugestão). Abaixo disso, pendência;
 *    abaixo de 35%, "dúvida". Nunca soma +60 cego; nunca Retorno ≥ 13:30 fora do hábito.
 *  - ≤2 batidas, tipo estranho, sem foto, fora da escala, pedido do app, atestado/declaração parcial, dúvida → PENDÊNCIA.
 *  - Escala que termina depois das 17:20, ou dia ainda sem Saída às 17:20 → ADIADO (re-checa às 08:00 do dia seguinte).
 */
import { resolveDaySchedule, type DaySchedule } from './day-schedule';
import { isScheduledDay, parseWorkDays } from './timesheet-schedule';
import { getOperationalAbono, shouldSuppressAbono } from './operational-abonos';
import { label as typeLabel } from './day-guards';
import { classifierProfile } from './employee-rules';
import { DISREGARDED, findDuplicatePunches, type DupFinding } from './punch-duplicates';
import { pairWeekSwaps, swapStatusFor, weekOf, dayLabel, type WeekDayStatus } from './day-swap';
import { AUTO_MIN_CONFIDENCE, anchors, computeHabit, describeReading, interpretDay, toClassSchedule, type HistoryDay, type Reading } from './punch-classifier';

export const AUTO_CLOSE_REASON = 'Ajuste automático 17:20';
export const CUTOFF_MINUTES = 17 * 60 + 20;
export const PUNCH_ORDER = ['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA'] as const;
const CODES = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'];
const HOURLY = new Set(['HORAS', 'PERIODO_HORAS', 'TRABALHO_EXTERNO_HORAS', 'CONSULTA_MEDICA', 'SAIDA_MEDICA']);
const ACTIVE = new Set(['ATIVO', 'APROVADO']);

export type ACEmployee = { id: string; name: string; employeeNumber: string | null; workDays: string | null; scheduleStart: string | null; scheduleEnd: string | null; scheduleByDay: string | null; profileJson?: string | null };
export type ACPunch = { id: string; type: string; timestamp: Date | string; status: string; origin?: string | null; hasPhoto: boolean; clientId?: string | null; originalType?: string; interpretation?: { type: string; source: string } | null };
export type ACCert = { id: string; type: string; startDate: Date | string; endDate: Date | string; startTime?: string | null; endTime?: string | null; status: string };
export type ACRequest = { id: string; type: string; status: string; startDate: Date | string; endDate: Date | string; launchedAt?: Date | string | null; reason?: string | null; details?: string | null };
export type Phase = 'TARDE' | 'MANHA' | 'COMPLETO';

export type SuggestionPunch = { type: string; time: string };
export type SuggestionRelabel = { punchId: string; time: string; from: string; to: string };
export type Suggestion =
  | { kind: 'INSERT_PUNCHES'; punches: SuggestionPunch[]; relabels?: SuggestionRelabel[]; confidence?: number; level?: string; resultingDay?: string; text: string; learnedNote?: string | null }
  | { kind: 'DIA_EXTRA'; text: string; learnedNote?: string | null }
  | { kind: 'LAUNCH_REQUEST'; requestId: string; text: string; learnedNote?: string | null }
  | { kind: 'TEXT'; text: string; learnedNote?: string | null };

export type Check = { label: string; ok: boolean };
export type DayDecision = {
  outcome: 'OK' | 'SKIP' | 'DEFER' | 'AUTO' | 'PENDENCIA';
  reason: string;
  /** Nota informativa do dia (ex.: "Troca de dia: veio seg 23/11 no lugar de ter 24/11"). */
  note?: string;
  /** Batidas duplicadas que o sistema decidiu desconsiderar (gravadas em PunchInterpretation, original intacta). */
  duplicates?: DupFinding[];
  employeeId: string; employeeName: string; date: string;
  schedule: DaySchedule | null; scheduled: boolean;
  punchesText: string;
  checks: Check[];
  proposal?: SuggestionPunch;
  /** Tipos que faltam no dia pela leitura do sistema (com ou sem horário sugerido). */
  missingTypes?: string[];
  /** Leitura do sistema para batidas originais com tipo errado no totem (aplicada junto com o ajuste). */
  relabels?: SuggestionRelabel[];
  confidence?: number;
  reading?: Pick<Reading, 'confidence' | 'level' | 'doubt' | 'alternative' | 'resultingDay'>;
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
  // Horário: scheduleByDay manda. Dia de trabalho: precisa estar também em workDays (evita faltas falsas; ver Jorge 0028).
  const workDays = employee.workDays ? parseWorkDays(employee.workDays) : new Set(['SEG', 'TER', 'QUA', 'QUI', 'SEX']);
  const scheduled = Boolean(schedule) && isScheduledDay(workDays, CODES[weekday]);
  return { schedule, scheduled, weekdayCode: CODES[weekday] };
}

/** Escala termina depois das 17:20 → só dá para fechar na manhã seguinte. */
export function endsAfterCutoff(schedule: DaySchedule | null) {
  return Boolean(schedule && toMin(schedule.end) > CUTOFF_MINUTES);
}

/** Completa as batidas que faltam (regra nova: hábito/escala, almoço redondo do hábito, nunca +60 cego). */
export function fillMissing(present: { type: string; min: number }[], schedule: DaySchedule | null, required: readonly string[], history: HistoryDay[] = [], date = ''): SuggestionPunch[] | null {
  const s = toClassSchedule(schedule);
  if (!s) return null;
  const lab: Record<string, number> = {};
  for (const p of present) if (lab[p.type] === undefined) lab[p.type] = p.min;
  const reading = interpretDay({ punches: present.map((p, i) => ({ id: `f${i}`, min: p.min, type: p.type, manual: false, fixed: true })), schedule: s, habit: date ? computeHabit(history, date) : null });
  if (reading.doubt || reading.missing.length) return null;
  return reading.fills.filter((f) => required.includes(f.type)).map((f) => ({ type: f.type, time: toHm(f.min) }));
}

export function evaluateDay({ employee, date, punches, certificates = [], requests = [], phase = 'COMPLETO', undoneTypes = [], history = [], lessons = [], week, today }: {
  employee: ACEmployee; date: string; punches: ACPunch[]; certificates?: ACCert[]; requests?: ACRequest[]; phase?: Phase; undoneTypes?: string[];
  /** Dias anteriores do colaborador (batidas originais, tipo efetivo) para o hábito pessoal. */
  history?: HistoryDay[];
  /** Correções do gestor anteriores ao dia (não se aplica à jornada flexível). */
  lessons?: import('./habit-learn').Lesson[];
  /** Jornada flexível: situação dos dias da semana (seg–dom) para a troca de dia. */
  week?: WeekDayStatus[];
  /** Hoje (Brasília) — define se a semana já acabou. */
  today?: string;
}): DayDecision {
  let valid = normalizePunches(punches.filter((p) => p.status === 'VALID' && dateKeyOf(p.timestamp) === date));
  const alreadyDisregarded = valid.filter((p) => p.type === DISREGARDED);
  valid = valid.filter((p) => p.type !== DISREGARDED);
  const profile = classifierProfile(employee.profileJson);
  const sched0 = scheduleFor(employee, date);
  let schedule = sched0.schedule;
  let scheduled = sched0.scheduled;
  // Troca de dia (só jornada flexível): grade não muda; compensação dentro da semana seg–dom.
  const todayKey = today || date;
  const swap = profile.flexible && week?.length ? swapStatusFor(date, pairWeekSwaps(week, todayKey)) : null;
  const swapNote = swap?.note || null;
  if (swap?.kind === 'TROCA' && !scheduled && valid.length) {
    // Veio no lugar de um dia da grade: avalia como dia de trabalho, com a escala do dia trocado.
    schedule = scheduleFor(employee, swap.swap.missed).schedule;
    scheduled = Boolean(schedule);
  }
  // Duplicadas em intervalo curto: fica a mais próxima do horário real (escala/padrão); a outra é desconsiderada.
  const habit = profile.flexible ? null : computeHabit(history, date, lessons);
  const cs0 = toClassSchedule(schedule);
  const duplicates = cs0 ? findDuplicatePunches(valid.map((p) => ({ id: p.id, min: toMin(hmOf(p.timestamp)), type: p.type, eligible: !isManual(p) && !['GESTOR', 'SUGESTAO_ACEITA'].includes(String(p.interpretation?.source || '')) })), anchors(cs0, habit)) : [];
  if (duplicates.length) {
    const drop = new Set(duplicates.map((d) => d.discardId));
    const keepAs = new Map(duplicates.filter((d) => d.keepAs).map((d) => [d.keepId, d.keepAs!]));
    valid = valid.filter((p) => !drop.has(p.id)).map((p) => keepAs.has(p.id) ? { ...p, type: keepAs.get(p.id)!, interpretation: { type: keepAs.get(p.id)!, source: 'AUTO' } } : p);
  }
  const punchesText = valid.length ? valid.map((p) => `${hmOf(p.timestamp)} ${typeLabel(p.type)}${p.hasPhoto ? '' : (isManual(p) ? '*' : ' (sem foto)')}`).join(' · ') : 'nenhuma batida';
  const base = { employeeId: employee.id, employeeName: employee.name, date, schedule, scheduled, punchesText, checks: [] as Check[], forgotten: false, ...(swapNote ? { note: swapNote } : {}) };
  const checks = base.checks;
  if (duplicates.length) (base as any).duplicates = duplicates;
  for (const d of duplicates) checks.push({ label: `${d.reason} → desconsiderada (duplicada)`, ok: true });
  for (const p of alreadyDisregarded) checks.push({ label: `${hmOf(p.timestamp)} desconsiderada (duplicada)`, ok: true });
  if (swapNote) checks.push({ label: swapNote, ok: swap?.kind === 'TROCA' });
  const pend = (kind: string, title: string, detail: string, suggestion: Suggestion | null, forgotten: boolean): DayDecision =>
    ({ ...base, outcome: 'PENDENCIA', reason: title, pendencia: { kind, title, detail: swapNote ? `${detail} ${swapNote}.` : detail, suggestion }, forgotten: forgotten && valid.length > 0 });

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
  if (complete) return { ...base, outcome: 'OK', reason: swap?.kind === 'TROCA' ? `Dia completo · ${swapNote}` : 'Dia completo' };

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

  if (!valid.length && profile.flexible && swap?.kind === 'TROCA') return { ...base, outcome: 'SKIP', reason: swapNote! };
  if (!valid.length && profile.flexible && (swap?.kind === 'AGUARDANDO' || (week?.length && date >= todayKey && todayKey <= weekOf(date).end))) {
    return { ...base, outcome: 'DEFER', reason: swapNote || `Aguardando compensação: pode vir em outro dia até ${dayLabel(weekOf(date).end)} (jornada flexível)` };
  }
  if (!valid.length) return pend('SEM_BATIDAS', 'Sem nenhuma batida', `Dia de escala (${schedule?.start}–${schedule?.end}) sem batida, atestado ou abono.`, { kind: 'TEXT', text: 'Falta? Se tiver justificativa, lance no Dia do colaborador.' }, false);

  // Lançamento manual de madrugada (ex.: 12:00 digitado como 00:00 / 12 AM): nunca interpretar, o gestor confere.
  const odd = valid.find((p) => isManual(p) && !p.hasPhoto && toMin(hmOf(p.timestamp)) < 5 * 60);
  checks.push({ label: 'Horário dos lançamentos manuais', ok: !odd });
  if (odd) return pend('HORARIO_SUSPEITO', `${typeLabel(odd.type)}* lançada às ${hmOf(odd.timestamp)}`, `${punchesText}. Lançamento manual de madrugada — provavelmente meio-dia digitado como 00:00 (12 AM). A batida não foi alterada.`, { kind: 'TEXT', text: `Confira: se era ${typeLabel(odd.type)} 12:00, cancele a batida das ${hmOf(odd.timestamp)}* e lance a correta no Dia do colaborador.` }, false);

  // Duplicadas a menos de 2 min: clique duplo/erro de totem → o gestor decide qual vale.
  const nearDup = valid.find((p, i) => i > 0 && +new Date(p.timestamp) - +new Date(valid[i - 1].timestamp) < 2 * 60_000);
  checks.push({ label: 'Sobreposição e duplicadas', ok: !nearDup });
  if (nearDup) return pend('TIPO_ERRADO', 'Batidas a menos de 2 min', `${punchesText}. Batidas a menos de 2 min.`, { kind: 'TEXT', text: wrongTypeHint(valid, required) }, true);

  const cs = toClassSchedule(schedule);
  const photosOk = valid.every((p) => p.hasPhoto || isManual(p));
  checks.push({ label: `Fotos das ${valid.length} batidas`, ok: photosOk });
  checks.push({ label: `Escala do dia${schedule ? ` (${schedule.start}–${schedule.end})` : ''}`, ok: Boolean(cs) });
  if (!cs) return pend('POUCAS_BATIDAS', `${valid.length} batida(s) sem escala`, `${punchesText}. Sem escala no cadastro para este dia.`, { kind: 'TEXT', text: 'Sem sugestão segura: cadastre a escala (por dia) e informe os horários no Ajustar.' }, true);

  const reading = interpretDay({
    options: { flexible: profile.flexible },
    punches: valid.map((p) => ({ id: p.id, min: toMin(hmOf(p.timestamp)), type: p.type, manual: isManual(p), fixed: isManual(p) || ['GESTOR', 'SUGESTAO_ACEITA'].includes(String(p.interpretation?.source || '')) })),
    schedule: cs,
    habit,
  });
  const pct = Math.round(reading.confidence * 100);
  const readingInfo = { confidence: reading.confidence, level: reading.level, doubt: reading.doubt, alternative: reading.alternative, resultingDay: reading.resultingDay, learnedNote: reading.learnedNote };
  checks.push({ label: `Leitura do sistema (${profile.flexible ? 'jornada flexível: sem padrão fixo' : habit ? `padrão real de ${habit.n} dias (${habit.nRecent} nos últimos 30)` : 'sem padrão: poucos dias de histórico'}) · ${pct}%`, ok: reading.level === 'ALTA' });
  if (reading.doubt && /mais batidas/.test(reading.doubt)) return pend('CONFLITO', 'Batidas a mais', `${punchesText}.`, { kind: 'TEXT', text: 'Confira e cancele a batida indevida no Dia do colaborador.' }, false);
  const relabels: SuggestionRelabel[] = reading.relabels.map((r) => ({ punchId: r.punchId, time: toHm(r.min), from: r.from, to: r.to }));
  const fills: SuggestionPunch[] = reading.fills.filter((f) => required.includes(f.type) || valid.length > 2).map((f) => ({ type: f.type, time: toHm(f.min) }));
  if (!relabels.length && !fills.length && !reading.missing.length) return { ...base, outcome: 'OK', reason: 'Dia completo (leitura do sistema)', reading: readingInfo };

  const text = describeReading(reading);
  const lastP = valid[valid.length - 1];
  const earlyExit = reading.labels[lastP.id] === 'SAIDA' && toMin(hmOf(lastP.timestamp)) < toMin(schedule!.end) - 5 ? ` Saída antecipada às ${hmOf(lastP.timestamp)} fica como está.` : '';
  const learned = reading.learnedNote ? ` ${reading.learnedNote}.` : '';
  const suggestion: Suggestion = reading.doubt
    ? { kind: 'TEXT', text: `Dúvida: ${reading.doubt} Leitura provável: ${reading.resultingDay}. Informe os horários no Ajustar.${learned}`, learnedNote: reading.learnedNote }
    : { kind: 'INSERT_PUNCHES', punches: fills, relabels, confidence: reading.confidence, level: reading.level, resultingDay: reading.resultingDay, text: `Sugestão (${pct}%): ${text}. Dia fica: ${reading.resultingDay}.${earlyExit}${learned}`, learnedNote: reading.learnedNote };

  if (!half && valid.length === 3 && fills.length === 1 && !reading.doubt && !reading.missing.length && !profile.flexible && reading.confidence >= AUTO_MIN_CONFIDENCE && photosOk && !undoneTypes.includes(fills[0].type)) {
    return { ...base, outcome: 'AUTO', reason: `Falta ${typeLabel(fills[0].type)}`, proposal: fills[0], relabels, confidence: reading.confidence, reading: readingInfo, pendencia: { kind: 'AJUSTE_SUGERIDO', title: `Ajuste sugerido (${pct}%): ${text}`, detail: '', suggestion }, forgotten: true };
  }
  const missingLabels = [...reading.fills.map((f) => typeLabel(f.type)), ...reading.missing.map((t) => typeLabel(t))].join(', ');
  const why = !photosOk ? 'batida sem foto' : reading.doubt ? reading.doubt : undoneTypes.length ? 'um ajuste automático deste dia foi desfeito' : reading.level !== 'ALTA' ? `confiança ${pct}% (< 75%)` : `${valid.length} batida(s)`;
  const kind = !photosOk ? 'SEM_FOTO' : reading.level === 'DUVIDA' || reading.doubt || reading.missing.length ? 'DUVIDA' : !fills.length ? 'TIPO_ERRADO' : 'POUCAS_BATIDAS';
  const title = kind === 'DUVIDA' ? `Dúvida (${pct}%): ${text || 'confira o dia'}` : kind === 'TIPO_ERRADO' ? `Tipo trocado no totem (${pct}%): ${text}` : valid.length <= 2 ? `Só ${valid.length} batida${valid.length > 1 ? 's' : ''} (${pct}%): ${text}` : `Sugestão (${pct}%): ${text}`;
  const d = pend(kind, title, `${punchesText}.${missingLabels ? ` Falta: ${missingLabels}` : ''} (${why}).${reading.alternative ? ` Outra leitura possível: ${reading.alternative}.` : ''}`, suggestion, fills.length > 0 || reading.missing.length > 0);
  return { ...d, relabels, confidence: reading.confidence, reading: readingInfo, missingTypes: [...reading.fills.map((f) => f.type), ...reading.missing] };
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
