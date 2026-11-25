/**
 * Leitura inteligente das batidas (o "sistema lê").
 *
 * Princípios:
 *  - A batida original NUNCA é alterada (Portaria 671). Aqui só se calcula a LEITURA do sistema
 *    (qual tipo cada batida representa) e o que falta lançar como ajuste (*).
 *  - Nunca decide só pela ordem: combina escala do dia (scheduleByDay é a fonte da verdade)
 *    + PADRÃO REAL da pessoa (últimos 90 dias, peso 3× nos 30 mais recentes) + duração do almoço.
 *  - Sem padrão claro (poucos dias ou dispersão alta) → DÚVIDA, sem inventar horário.
 *  - Almoço fixo configurado na escala (lunchStart/lunchEnd) vale mais que o hábito.
 *  - Jornada flexível (profile.jornadaFlexivel, ex.: vice-diretor) → nunca força padrão: sempre dúvida, sem horário.
 *  - Toda leitura tem confiança 0–1. Abaixo de 0,75 não há ajuste automático; abaixo de 0,35 é "dúvida".
 *  - Almoço lançado sempre em horário redondo do HÁBITO; nunca soma +60 cego; nunca propõe almoço < 60 min
 *    nem Retorno ≥ 13:30 se o hábito da pessoa não for esse.
 * Puro (sem banco): usado no servidor (17:20/08:00, totem) e nos testes/backtest.
 */
import { computeHabitWithLessons, describeLearning, type Lesson } from './habit-learn';

export type PType = 'ENTRADA' | 'INTERVALO' | 'RETORNO' | 'SAIDA';
export const ORDER: readonly PType[] = ['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA'];
export const LABEL: Record<PType, string> = { ENTRADA: 'Entrada', INTERVALO: 'Intervalo', RETORNO: 'Retorno', SAIDA: 'Saída' };

export const AUTO_MIN_CONFIDENCE = 0.75;
export const DOUBT_MAX_CONFIDENCE = 0.35;
export const MIN_LUNCH = 60;
export const LATE_RETURN_LIMIT = 13 * 60 + 30;
/** Janela do padrão real: 90 dias, com peso maior nos 30 mais recentes. */
export const HABIT_WINDOW_DAYS = 90;
export const HABIT_RECENT_DAYS = 30;
export const HABIT_RECENT_WEIGHT = 3;
/** Mínimo de dias completos para existir hábito e para ele ser "claro". */
export const HABIT_MIN_DAYS = 4;
export const CLEAR_MIN_DAYS = 5;
/** Dispersão máxima (mediana do desvio absoluto, em min) para o padrão de um tipo ser "claro". */
export const CLEAR_MAX_SPREAD = 20;
/** Um preenchimento a mais que isso do padrão da pessoa vira dúvida. */
export const OFF_PATTERN_LIMIT = 30;

export type ClassSchedule = { start: number; end: number; mode: 'FULL' | 'HALF'; lunchStart?: number; lunchEnd?: number };
export type Habit = Record<PType, number> & {
  lunch: number;
  /** dias completos na janela de 90 dias */
  n: number;
  /** desses, quantos nos últimos 30 */
  nRecent: number;
  spread: Record<PType, number>;
  lunchSpread: number;
  /** padrão claro por tipo (≥ CLEAR_MIN_DAYS dias e dispersão ≤ CLEAR_MAX_SPREAD) */
  clear: Record<PType, boolean>;
  /** Correções do gestor que alimentaram este hábito (texto do recorte verde). */
  learnedFrom?: { date: string; type: PType; kind: 'RELABEL' | 'FILL' }[];
};
export type ReadOptions = { flexible?: boolean };
export type HistoryDay = { date: string; punches: { type: string; min: number }[] };

export const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;
export const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
export const r30 = (m: number) => Math.round(m / 30) * 30;
const floor5 = (m: number) => Math.floor(m / 5) * 5;
const ceil5 = (m: number) => Math.ceil(m / 5) * 5;

export function toClassSchedule(s: { start: string; end: string; mode: 'FULL' | 'HALF'; lunchStart?: string | null; lunchEnd?: string | null } | null | undefined): ClassSchedule | null {
  if (!s) return null;
  const out: ClassSchedule = { start: toMin(s.start), end: toMin(s.end), mode: s.mode === 'HALF' ? 'HALF' : 'FULL' };
  if (s.lunchStart && s.lunchEnd && toMin(s.lunchEnd) > toMin(s.lunchStart)) { out.lunchStart = toMin(s.lunchStart); out.lunchEnd = toMin(s.lunchEnd); }
  return out;
}

/** Mediana ponderada (peso maior para os dias recentes). */
function wmedian(values: number[], weights: number[]) {
  const idx = values.map((v, i) => ({ v, w: weights[i] })).sort((a, b) => a.v - b.v);
  const total = idx.reduce((a, x) => a + x.w, 0);
  let acc = 0;
  for (let i = 0; i < idx.length; i += 1) {
    acc += idx[i].w;
    if (acc * 2 === total && i + 1 < idx.length) return (idx[i].v + idx[i + 1].v) / 2;
    if (acc * 2 > total) return idx[i].v;
  }
  return idx[idx.length - 1].v;
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Padrão real da pessoa: dias inequívocos (4 batidas originais já na ordem certa) dos últimos 90 dias antes de `date`,
 * mediana ponderada com peso 3× nos últimos 30 dias. Também mede a dispersão para saber se o padrão é claro.
 */
export function computeHabit(history: HistoryDay[], date: string, lessons: Lesson[] = []): Habit | null {
  if (lessons.some((l) => l.date < date)) return computeHabitWithLessons(history, date, lessons);
  const from = addDays(date, -HABIT_WINDOW_DAYS);
  const recent = addDays(date, -HABIT_RECENT_DAYS);
  const rows = history
    .filter((d) => d.date < date && d.date >= from && d.punches.length === 4 && d.punches.every((p, i) => p.type === ORDER[i]))
    .map((d) => ({ w: d.date >= recent ? HABIT_RECENT_WEIGHT : 1, row: Object.fromEntries(d.punches.map((p) => [p.type, p.min])) as Record<PType, number> }));
  if (rows.length < HABIT_MIN_DAYS) return null;
  const w = rows.map((r) => r.w);
  const h = {} as Habit;
  for (const t of ORDER) h[t] = wmedian(rows.map((r) => r.row[t]), w);
  h.n = rows.length;
  h.nRecent = rows.filter((r) => r.w > 1).length;
  const lunches = rows.map((r) => r.row.RETORNO - r.row.INTERVALO);
  h.lunch = wmedian(lunches, w);
  h.lunchSpread = wmedian(lunches.map((x) => Math.abs(x - h.lunch)), w);
  h.spread = {} as Record<PType, number>;
  h.clear = {} as Record<PType, boolean>;
  for (const t of ORDER) {
    h.spread[t] = wmedian(rows.map((r) => Math.abs(r.row[t] - h[t])), w);
    h.clear[t] = h.n >= CLEAR_MIN_DAYS && h.spread[t] <= CLEAR_MAX_SPREAD;
  }
  return h;
}

/** Almoço de referência: escala configurada (lunchStart/lunchEnd) > padrão claro da pessoa > nenhum. */
export function lunchReference(s: ClassSchedule, h: Habit | null): { start: number; minutes: number; source: 'ESCALA' | 'HABITO' } | null {
  if (s.lunchStart !== undefined && s.lunchEnd !== undefined) return { start: s.lunchStart, minutes: s.lunchEnd - s.lunchStart, source: 'ESCALA' };
  if (h && h.clear.INTERVALO && h.clear.RETORNO) return { start: slot(h.INTERVALO), minutes: Math.max(MIN_LUNCH, Math.min(r30(h.lunch), 120)), source: 'HABITO' };
  return null;
}

export function anchors(s: ClassSchedule, h: Habit | null): Record<PType, number> {
  const ls = s.lunchStart ?? Math.min(s.end - 60, Math.max(s.start, 720));
  const le = s.lunchEnd ?? ls + 60;
  const a: Record<PType, number> = { ENTRADA: s.start, INTERVALO: ls, RETORNO: le, SAIDA: s.end };
  if (h) {
    for (const t of ORDER) {
      const lunchType = t === 'INTERVALO' || t === 'RETORNO';
      // Padrão claro pesa forte; padrão disperso pesa pouco. Almoço configurado na escala divide o peso com o hábito.
      let w = lunchType ? 0.7 : 0.5;
      if (!h.clear[t]) w *= 0.5;
      if (lunchType && s.lunchStart !== undefined) w = Math.min(w, 0.5);
      a[t] = w * h[t] + (1 - w) * a[t];
    }
  }
  return a;
}

function combinations<T>(items: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (items.length < k) return [];
  const [first, ...rest] = items;
  return [...combinations(rest, k - 1).map((c) => [first, ...c]), ...combinations(rest, k)];
}

export type Classification = { labels: PType[]; confidence: number; alternative: PType[] | null };

/** Rotula batidas (minutos, em ordem). Não usa só a ordem: custo = distância à escala+hábito + duração do almoço. */
export function classify(times: number[], s: ClassSchedule, h: Habit | null, exclude: PType[] = []): Classification {
  const a = anchors(s, h);
  let types: PType[] = s.mode === 'FULL' || times.length > 2 ? [...ORDER] : ['ENTRADA', 'SAIDA'];
  types = types.filter((t) => !exclude.includes(t));
  if (!times.length) return { labels: [], confidence: 0.99, alternative: null };
  if (times.length > types.length) return { labels: [], confidence: 0, alternative: null };
  const lunch = s.lunchStart !== undefined && s.lunchEnd !== undefined ? s.lunchEnd - s.lunchStart : h ? h.lunch : 60;
  const scored: { c: number; combo: PType[] }[] = [];
  for (const combo of combinations(types, times.length)) {
    let c = 0;
    combo.forEach((ty, i) => { c += Math.abs(times[i] - a[ty]); });
    const lab = Object.fromEntries(combo.map((ty, i) => [ty, times[i]])) as Partial<Record<PType, number>>;
    if (lab.INTERVALO !== undefined && lab.RETORNO !== undefined) {
      const dur = lab.RETORNO - lab.INTERVALO;
      c += 0.5 * Math.abs(dur - lunch) + (dur < 20 || dur > 180 ? 200 : 0);
    }
    if (lab.ENTRADA === undefined && !exclude.includes('ENTRADA')) c += 25;
    if (lab.SAIDA === undefined && times.length >= 2 && !exclude.includes('SAIDA')) c += 15;
    scored.push({ c, combo });
  }
  scored.sort((x, y) => x.c - y.c);
  const best = scored[0];
  const second = scored[1] ?? { c: best.c + 999, combo: null as unknown as PType[] };
  const margin = second.c - best.c;
  const worst = Math.max(...best.combo.map((ty, i) => Math.abs(times[i] - a[ty])));
  const conf = Math.max(0.05, Math.min(0.99, (margin / (margin + 40)) * (worst <= 90 ? 1 : 0.5)));
  return { labels: best.combo, confidence: Math.round(conf * 100) / 100, alternative: scored[1] ? second.combo : null };
}

/** Horário redondo do hábito: :00/:30 se estiver a ≤10 min, senão arredonda para baixo. */
export function slot(m: number) {
  const n = r30(m);
  return Math.abs(n - m) <= 10 ? n : Math.floor(m / 30) * 30;
}

export type Fill = { type: PType; min: number };
export type FillResult = { fills: Fill[]; missing: PType[]; doubt: string | null };

const round5 = (m: number) => Math.round(m / 5) * 5;

/**
 * O que falta lançar — só com base no que a pessoa REALMENTE faz:
 *  - Entrada/Saída: escala do dia; se o padrão real é claro e difere > 20 min da escala, usa o padrão real.
 *  - Almoço: escala configurada (lunchStart/lunchEnd) ou padrão claro da pessoa (horário redondo). Se a outra ponta
 *    existe e fica a 55–90 min do habitual, usa o habitual; senão ±60 da batida (nunca < 60 min de almoço).
 *  - Sem padrão claro para o que falta → o tipo vai para `missing` (sem horário inventado) e a leitura é DÚVIDA.
 *  - Jornada flexível → nada é preenchido; tudo que falta vai para `missing` como dúvida.
 */
export function proposeFill(lab: Partial<Record<PType, number>>, s: ClassSchedule, h: Habit | null, opts: ReadOptions = {}): FillResult {
  const types: PType[] = s.mode === 'FULL' || Object.keys(lab).length > 2 ? [...ORDER] : ['ENTRADA', 'SAIDA'];
  const absent = types.filter((t) => lab[t] === undefined);
  if (opts.flexible) {
    return { fills: [], missing: absent, doubt: absent.length ? 'Jornada flexível (sem horário fixo): o sistema não sugere horário — confirme com a pessoa.' : null };
  }
  const ref = lunchReference(s, h);
  const fills: Fill[] = [];
  const missing: PType[] = [];
  const reasons: string[] = [];
  const all: Partial<Record<PType, number>> = { ...lab };
  for (const t of types) {
    if (all[t] !== undefined) continue;
    let m: number | null = null;
    if (t === 'ENTRADA' || t === 'SAIDA') {
      const esc = t === 'ENTRADA' ? s.start : s.end;
      if (!h) reasons.push(`poucos dias completos no histórico para confirmar a ${LABEL[t]}`);
      else if (!h.clear[t]) reasons.push(`${LABEL[t]} sem padrão claro (varia ±${Math.round(h.spread[t])} min)`);
      m = h && h.clear[t] && Math.abs(h[t] - esc) > 20 ? round5(h[t]) : esc;
    } else if (ref) {
      const HI = ref.start;
      const HR = ref.start + ref.minutes;
      if (t === 'INTERVALO') {
        const r = all.RETORNO;
        m = r === undefined || (r - HI >= 55 && r - HI <= 90) ? HI : floor5(r - 60);
      } else {
        const i = all.INTERVALO;
        m = i === undefined || (HR - i >= 55 && HR - i <= 90) ? HR : ceil5(i + 60);
      }
    } else {
      missing.push(t);
      reasons.push(`${LABEL[t]}: sem padrão claro de almoço (${h ? `varia ±${Math.round(Math.max(h.spread.INTERVALO, h.spread.RETORNO))} min` : 'poucos dias de histórico'}) — sem horário sugerido`);
      continue;
    }
    all[t] = m;
    fills.push({ type: t, min: m });
  }
  let doubt: string | null = null;
  const seq = types.filter((t) => all[t] !== undefined).map((t) => all[t] as number);
  if (seq.some((m, i) => i > 0 && m <= seq[i - 1] + 1)) doubt = 'A sequência proposta ficaria fora de ordem.';
  if (all.INTERVALO !== undefined && all.RETORNO !== undefined && all.RETORNO - all.INTERVALO < MIN_LUNCH - 5) doubt = 'O almoço ficaria menor que 60 min.';
  const HR = ref ? ref.start + ref.minutes : null;
  const fr = fills.find((f) => f.type === 'RETORNO');
  if (fr && fr.min >= LATE_RETURN_LIMIT && (HR === null || HR < LATE_RETURN_LIMIT)) doubt = `Retorno ${hm(fr.min)} foge do padrão da pessoa${HR !== null ? ` (${hm(HR)})` : ''}.`;
  // Nada fora do que a pessoa costuma fazer: preenchimento longe do padrão claro → dúvida.
  if (!doubt && h) {
    const off = fills.find((f) => {
      if ((f.type === 'INTERVALO' || f.type === 'RETORNO') && ref?.source === 'ESCALA') return false;
      return h.clear[f.type] && Math.abs(f.min - h[f.type]) > OFF_PATTERN_LIMIT;
    });
    if (off) doubt = `${LABEL[off.type]} ${hm(off.min)} fica longe do padrão da pessoa (${hm(h[off.type])}).`;
  }
  if (!doubt && reasons.length) doubt = `Sem padrão claro: ${reasons.join('; ')}.`;
  return { fills, missing, doubt };
}

export type DayPunch = { id: string; min: number; type: string; manual: boolean };
export type Relabel = { punchId: string; min: number; from: PType; to: PType };
export type Reading = {
  labels: Record<string, PType>;
  relabels: Relabel[];
  fills: Fill[];
  /** tipos que faltam e para os quais o sistema NÃO sugere horário (sem padrão claro / jornada flexível) */
  missing: PType[];
  confidence: number;
  level: 'ALTA' | 'MEDIA' | 'DUVIDA';
  doubt: string | null;
  alternative: string | null;
  resultingDay: string;
  /** Ex.: "Aprendido com sua correção de 05/10". Nulo na jornada flexível ou sem correções. */
  learnedNote: string | null;
};

/**
 * Leitura completa do dia. `punches` já com o tipo efetivo atual (original ou leitura anterior do gestor).
 * Batidas manuais (*) e leituras confirmadas pelo gestor (`fixed`) são respeitadas; só as originais do totem/app são relidas.
 */
export function interpretDay(input: { punches: (DayPunch & { fixed?: boolean })[]; schedule: ClassSchedule; habit: Habit | null; options?: ReadOptions }): Reading {
  const opts = input.options || {};
  // Jornada flexível: não força padrão nenhum (nem o hábito, que para essa pessoa não é regra).
  const habit = opts.flexible ? null : input.habit;
  const sorted = [...input.punches].sort((a, b) => a.min - b.min);
  const fixed = sorted.filter((p) => p.manual || p.fixed);
  const free = sorted.filter((p) => !p.manual && !p.fixed);
  const fixedTypes = fixed.map((p) => p.type as PType);
  const cls = classify(free.map((p) => p.min), input.schedule, habit, fixedTypes);
  const labels: Record<string, PType> = {};
  fixed.forEach((p) => { labels[p.id] = p.type as PType; });
  const relabels: Relabel[] = [];
  let doubt: string | null = null;
  if (free.length && !cls.labels.length) doubt = 'Há mais batidas do que tipos possíveis no dia.';
  free.forEach((p, i) => {
    const to = cls.labels[i] ?? (p.type as PType);
    labels[p.id] = to;
    if (to !== p.type) relabels.push({ punchId: p.id, min: p.min, from: p.type as PType, to });
  });
  const lab: Partial<Record<PType, number>> = {};
  for (const p of sorted) { const t = labels[p.id]; if (lab[t] === undefined) lab[t] = p.min; }
  const fill = proposeFill(lab, input.schedule, habit, opts);
  doubt = doubt ?? fill.doubt;
  if (!doubt && opts.flexible && relabels.length) doubt = 'Jornada flexível (sem horário fixo): leitura dos tipos só como dúvida — confirme com a pessoa.';
  let confidence = free.length ? cls.confidence : 0.99;
  if (doubt) confidence = Math.min(confidence, 0.3);
  const level = confidence >= AUTO_MIN_CONFIDENCE ? 'ALTA' : confidence < DOUBT_MAX_CONFIDENCE ? 'DUVIDA' : 'MEDIA';
  const items = [
    ...sorted.map((p) => ({ min: p.min, text: `${hm(p.min)} ${LABEL[labels[p.id]]}${p.manual ? '*' : ''}` })),
    ...fill.fills.map((f) => ({ min: f.min, text: `${hm(f.min)} ${LABEL[f.type]}*` })),
  ].sort((a, b) => a.min - b.min);
  const alternative = cls.alternative && free.length ? free.map((p, i) => `${hm(p.min)} ${LABEL[cls.alternative![i]]}`).join(' · ') : null;
  const resultingDay = [...items.map((x) => x.text), ...fill.missing.map((t) => `${LABEL[t]} ?`)].join(' · ');
  const learnedNote = opts.flexible ? null : describeLearning(input.habit?.learnedFrom);
  return { labels, relabels, fills: fill.fills, missing: fill.missing, confidence, level, doubt, alternative, resultingDay, learnedNote };
}

/** Texto curto da sugestão (título de pendência). */
export function describeReading(r: Reading): string {
  const parts = [
    ...r.relabels.map((x) => `${hm(x.min)} é ${LABEL[x.to]} (totem: ${LABEL[x.from]})`),
    ...r.fills.map((f) => `${LABEL[f.type]} ${hm(f.min)}*`),
    ...(r.missing || []).map((t) => `falta ${LABEL[t]} (sem horário sugerido)`),
  ];
  return parts.join(' + ');
}
