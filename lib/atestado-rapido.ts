/**
 * Lançar atestado rápido — lógica pura (sem banco).
 * Lê as batidas do dia e propõe: manter a entrada, lançar a saída do gestor (*) se faltar,
 * reinterpretar a batida da volta como Retorno e registrar o atestado cobrindo só a ausência
 * (da saída até a volta). Batidas originais nunca são alteradas (Portaria 671).
 */
export type QuickKind = 'ATESTADO_MEDICO' | 'PERICIA_JUDICIAL' | 'DECLARACAO_COMPARECIMENTO' | 'CONSULTA' | 'OUTRO';
export const QUICK_KINDS: Record<QuickKind, { label: string; partialType: string; fullType: string; docLabel: string }> = {
  ATESTADO_MEDICO: { label: 'Atestado médico', partialType: 'HORAS', fullType: 'DIA_INTEGRAL', docLabel: 'Atestado médico' },
  PERICIA_JUDICIAL: { label: 'Perícia / judicial', partialType: 'PERICIA_JUDICIAL', fullType: 'PERICIA_JUDICIAL', docLabel: 'Perícia médica judicial' },
  DECLARACAO_COMPARECIMENTO: { label: 'Declaração de comparecimento', partialType: 'DECLARACAO_COMPARECIMENTO', fullType: 'DECLARACAO_COMPARECIMENTO', docLabel: 'Declaração de comparecimento' },
  CONSULTA: { label: 'Consulta / exame', partialType: 'CONSULTA_MEDICA', fullType: 'DIA_INTEGRAL', docLabel: 'Consulta / exame' },
  OUTRO: { label: 'Outro', partialType: 'OUTRO', fullType: 'OUTRO', docLabel: 'Outro documento' },
};
export function isQuickKind(v: unknown): v is QuickKind { return typeof v === 'string' && v in QUICK_KINDS; }

export type DayPunch = { id: string; type: string; time: string; manual?: boolean };
export type ProposalStep =
  | { kind: 'KEEP'; punchId: string; type: string; time: string; text: string }
  | { kind: 'ADD'; type: string; time: string; text: string }
  | { kind: 'RELABEL'; punchId: string; from: string; to: string; time: string; text: string }
  | { kind: 'CERT'; start: string; end: string; text: string };
export type Proposal = {
  partial: boolean; leave: string | null; back: string | null; abonoStart: string | null; abonoEnd: string | null;
  steps: ProposalStep[]; warnings: string[];
};

export const toMinutes = (hm: string | null | undefined) => { const m = String(hm || '').match(/^(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
export const toClock = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const TYPE_LABEL: Record<string, string> = { ENTRADA: 'Entrada', INTERVALO: 'Saída', RETORNO: 'Entrada (retorno)', SAIDA: 'Saída' };
export const punchLabel = (t: string) => TYPE_LABEL[t] || t;

export function proposeDay(input: {
  punches: DayPunch[]; scheduleStart: string | null; scheduleEnd: string | null; partial: boolean;
  docStart?: string | null; docEnd?: string | null; requestStart?: string | null; requestEnd?: string | null;
  leave?: string | null; back?: string | null; docLabel?: string; mode?: 'GAP' | 'DOC';
}): Proposal {
  const warnings: string[] = []; const steps: ProposalStep[] = [];
  const doc = input.docLabel || 'Atestado';
  const ps = [...input.punches].sort((a, b) => (toMinutes(a.time) ?? 0) - (toMinutes(b.time) ?? 0));
  if (!input.partial) {
    if (ps.length) warnings.push('Há batidas neste dia: o atestado de dia inteiro abona o dia e as batidas continuam na folha.');
    steps.push({ kind: 'CERT', start: input.scheduleStart || '', end: input.scheduleEnd || '', text: `Registrar ${doc.toLowerCase()} · dia inteiro` });
    return { partial: false, leave: null, back: null, abonoStart: null, abonoEnd: null, steps, warnings };
  }
  const ds = toMinutes(input.docStart); const de = toMinutes(input.docEnd);
  const ss = toMinutes(input.scheduleStart); const se = toMinutes(input.scheduleEnd);
  if (ds === null || de === null || de <= ds) return { partial: true, leave: null, back: null, abonoStart: null, abonoEnd: null, steps, warnings: ['Informe o horário do documento (início e fim).'] };

  if (input.mode === 'DOC') {
    // só o horário do documento: nenhuma batida muda
    steps.push({ kind: 'CERT', start: toClock(ds), end: toClock(de), text: `Registrar ${doc.toLowerCase()} ${toClock(ds)}–${toClock(de)}` });
    return { partial: true, leave: null, back: null, abonoStart: toClock(ds), abonoEnd: toClock(de), steps, warnings };
  }
  const entry = ps.find((p) => (toMinutes(p.time) ?? 0) <= ds);
  const leaveOverride = toMinutes(input.leave); const backOverride = toMinutes(input.back);
  // batida já existente que marca a saída (entre a entrada e o início do documento, depois da entrada)
  const existingLeave = entry ? [...ps].reverse().find((p) => p !== entry && (toMinutes(p.time) ?? 0) > (toMinutes(entry.time) ?? 0) && (toMinutes(p.time) ?? 0) <= ds) : undefined;
  let leave: number | null = null; let leaveFrom: 'PUNCH' | 'REQUEST' | 'OVERRIDE' | 'DEFAULT' | null = null;
  if (entry) {
    if (leaveOverride !== null) { leave = leaveOverride; leaveFrom = 'OVERRIDE'; }
    else if (existingLeave) { leave = toMinutes(existingLeave.time); leaveFrom = 'PUNCH'; }
    else if (toMinutes(input.requestStart) !== null && (toMinutes(input.requestStart) as number) <= ds) { leave = toMinutes(input.requestStart); leaveFrom = 'REQUEST'; }
    else { leave = Math.max(toMinutes(entry.time) ?? ds, ds - 60); leaveFrom = 'DEFAULT'; }
  }
  const backPunch = ps.find((p) => (toMinutes(p.time) ?? 0) >= de && p !== entry && p !== existingLeave);
  const back = backOverride ?? (backPunch ? toMinutes(backPunch.time) : null);
  const abonoStart = leave ?? ss; const abonoEnd = back ?? se;
  if (abonoStart === null || abonoEnd === null || abonoEnd <= abonoStart) return { partial: true, leave: null, back: null, abonoStart: null, abonoEnd: null, steps, warnings: ['Não deu para montar o período da ausência — confira os horários.'] };

  if (entry) steps.push({ kind: 'KEEP', punchId: entry.id, type: entry.type, time: entry.time, text: `Manter ${punchLabel(entry.type)} ${entry.time}` });
  const leaveType = back !== null ? 'INTERVALO' : 'SAIDA';
  if (leave !== null) {
    if (leaveFrom === 'PUNCH' && existingLeave) {
      if (existingLeave.type !== leaveType) steps.push({ kind: 'RELABEL', punchId: existingLeave.id, from: existingLeave.type, to: leaveType, time: existingLeave.time, text: `${existingLeave.time} passa a valer como Saída` });
      else steps.push({ kind: 'KEEP', punchId: existingLeave.id, type: existingLeave.type, time: existingLeave.time, text: `Manter Saída ${existingLeave.time}` });
    } else {
      steps.push({ kind: 'ADD', type: leaveType, time: toClock(leave), text: `Lançar Saída ${toClock(leave)}` });
    }
  }
  if (backPunch && back !== null && backOverride === null) {
    if (backPunch.type !== 'RETORNO' && entry) steps.push({ kind: 'RELABEL', punchId: backPunch.id, from: backPunch.type, to: 'RETORNO', time: backPunch.time, text: `${backPunch.time} passa a valer como Entrada (retorno)` });
    else steps.push({ kind: 'KEEP', punchId: backPunch.id, type: backPunch.type, time: backPunch.time, text: `Manter ${punchLabel(backPunch.type)} ${backPunch.time}` });
  }
  const used = new Set([entry?.id, existingLeave?.id, backPunch?.id].filter(Boolean));
  const rest = ps.filter((p) => !used.has(p.id));
  const last = rest[rest.length - 1];
  if (last && back !== null) {
    if (last.type !== 'SAIDA') steps.push({ kind: 'RELABEL', punchId: last.id, from: last.type, to: 'SAIDA', time: last.time, text: `${last.time} passa a valer como Saída` });
    else steps.push({ kind: 'KEEP', punchId: last.id, type: last.type, time: last.time, text: `Manter Saída ${last.time}` });
  }
  if (rest.length > 1) warnings.push(`O dia tem ${ps.length} batidas: confira se a proposta pegou as batidas certas.`);
  if (!entry) warnings.push('Sem entrada antes do documento: o abono começa no início da escala.');
  if (back === null) warnings.push('Sem batida de volta: o abono vai até o fim da escala.');
  steps.push({ kind: 'CERT', start: toClock(abonoStart), end: toClock(abonoEnd), text: `Registrar ${doc.toLowerCase()} ${toClock(abonoStart)}–${toClock(abonoEnd)}` });
  return { partial: true, leave: leave === null ? null : toClock(leave), back: back === null ? null : toClock(back), abonoStart: toClock(abonoStart), abonoEnd: toClock(abonoEnd), steps, warnings };
}
