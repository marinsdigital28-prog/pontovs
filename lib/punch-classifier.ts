/**
 * Leitura inteligente das batidas (o "sistema lê").
 *
 * Princípios:
 *  - A batida original NUNCA é alterada (Portaria 671). Aqui só se calcula a LEITURA do sistema
 *    (qual tipo cada batida representa) e o que falta lançar como ajuste (*).
 *  - Nunca decide só pela ordem: combina escala do dia (scheduleByDay é a fonte da verdade)
 *    + hábito pessoal (medianas dos últimos 30 dias, fallback 60) + duração do almoço.
 *  - Toda leitura tem confiança 0–1. Abaixo de 0,75 não há ajuste automático; abaixo de 0,35 é "dúvida".
 *  - Almoço lançado sempre em horário redondo do HÁBITO; nunca soma +60 cego; nunca propõe almoço < 60 min
 *    nem Retorno ≥ 13:30 se o hábito da pessoa não for esse.
 * Puro (sem banco): usado no servidor (17:20/08:00, totem) e nos testes/backtest.
 */
export type PType = 'ENTRADA' | 'INTERVALO' | 'RETORNO' | 'SAIDA';
export const ORDER: readonly PType[] = ['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA'];
export const LABEL: Record<PType, string> = { ENTRADA: 'Entrada', INTERVALO: 'Intervalo', RETORNO: 'Retorno', SAIDA: 'Saída' };

export const AUTO_MIN_CONFIDENCE = 0.75;
export const DOUBT_MAX_CONFIDENCE = 0.35;
export const MIN_LUNCH = 60;
export const LATE_RETURN_LIMIT = 13 * 60 + 30;

export type ClassSchedule = { start: number; end: number; mode: 'FULL' | 'HALF' };
export type Habit = Record<PType, number> & { lunch: number; n: number; spread: Record<PType, number> };
export type HistoryDay = { date: string; punches: { type: string; min: number }[] };

export const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;
export const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
export const r30 = (m: number) => Math.round(m / 30) * 30;
const floor5 = (m: number) => Math.floor(m / 5) * 5;
const ceil5 = (m: number) => Math.ceil(m / 5) * 5;

export function toClassSchedule(s: { start: string; end: string; mode: 'FULL' | 'HALF' } | null | undefined): ClassSchedule | null {
  if (!s) return null;
  return { start: toMin(s.start), end: toMin(s.end), mode: s.mode === 'HALF' ? 'HALF' : 'FULL' };
}

function median(values: number[]) {
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Hábito pessoal: medianas dos dias inequívocos (4 batidas originais já na ordem certa) antes de `date`. */
export function computeHabit(history: HistoryDay[], date: string): Habit | null {
  const complete = history
    .filter((d) => d.date < date && d.punches.length === 4 && d.punches.every((p, i) => p.type === ORDER[i]))
    .map((d) => ({ date: d.date, row: Object.fromEntries(d.punches.map((p) => [p.type, p.min])) as Record<PType, number> }));
  let rows = complete.filter((d) => d.date >= addDays(date, -30)).map((d) => d.row);
  if (rows.length < 4) rows = complete.filter((d) => d.date >= addDays(date, -60)).map((d) => d.row);
  if (rows.length < 4) return null;
  const h = {} as Habit;
  for (const t of ORDER) h[t] = median(rows.map((r) => r[t]));
  h.n = rows.length;
  h.lunch = median(rows.map((r) => r.RETORNO - r.INTERVALO));
  h.spread = {} as Record<PType, number>;
  for (const t of ORDER) h.spread[t] = median(rows.map((r) => Math.abs(r[t] - h[t])));
  return h;
}

export function anchors(s: ClassSchedule, h: Habit | null): Record<PType, number> {
  const ls = Math.min(s.end - 60, Math.max(s.start, 720));
  const a: Record<PType, number> = { ENTRADA: s.start, INTERVALO: ls, RETORNO: ls + 60, SAIDA: s.end };
  if (h) for (const t of ORDER) { const w = t === 'INTERVALO' || t === 'RETORNO' ? 0.7 : 0.5; a[t] = w * h[t] + (1 - w) * a[t]; }
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
  const lunch = h ? h.lunch : 60;
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
export type FillResult = { fills: Fill[]; doubt: string | null };

/**
 * O que falta lançar. Entrada/Saída pela escala; almoço no horário redondo do hábito (ou 12:00/13:00 da escala).
 * Se a batida de almoço existente fica a 55–90 min do horário habitual da outra ponta, usa o hábito;
 * senão usa batida ± 60 arredondada em 5 min (nunca < 60 min de almoço).
 */
export function proposeFill(lab: Partial<Record<PType, number>>, s: ClassSchedule, h: Habit | null): FillResult {
  const types: PType[] = s.mode === 'FULL' || Object.keys(lab).length > 2 ? [...ORDER] : ['ENTRADA', 'SAIDA'];
  const base = anchors(s, null);
  const HI = h ? slot(h.INTERVALO) : base.INTERVALO;
  const L = Math.max(MIN_LUNCH, Math.min(h ? r30(h.lunch) : 60, 120));
  const HR = HI + L;
  const fills: Fill[] = [];
  const all: Partial<Record<PType, number>> = { ...lab };
  for (const t of types) {
    if (all[t] !== undefined) continue;
    let m: number;
    if (t === 'ENTRADA') m = s.start;
    else if (t === 'SAIDA') m = s.end;
    else if (t === 'INTERVALO') {
      const r = all.RETORNO;
      m = r === undefined || (r - HI >= 55 && r - HI <= 90) ? HI : floor5(r - 60);
    } else {
      const i = all.INTERVALO;
      m = i === undefined || (HR - i >= 55 && HR - i <= 90) ? HR : ceil5(i + 60);
    }
    all[t] = m;
    fills.push({ type: t, min: m });
  }
  let doubt: string | null = null;
  const seq = types.filter((t) => all[t] !== undefined).map((t) => all[t] as number);
  if (seq.some((m, i) => i > 0 && m <= seq[i - 1] + 1)) doubt = 'A sequência proposta ficaria fora de ordem.';
  if (all.INTERVALO !== undefined && all.RETORNO !== undefined && all.RETORNO - all.INTERVALO < MIN_LUNCH - 5) doubt = 'O almoço ficaria menor que 60 min.';
  const fr = fills.find((f) => f.type === 'RETORNO');
  if (fr && fr.min >= LATE_RETURN_LIMIT && HR < LATE_RETURN_LIMIT) doubt = `Retorno ${hm(fr.min)} foge do hábito (${hm(HR)}).`;
  return { fills, doubt };
}

export type DayPunch = { id: string; min: number; type: string; manual: boolean };
export type Relabel = { punchId: string; min: number; from: PType; to: PType };
export type Reading = {
  labels: Record<string, PType>;
  relabels: Relabel[];
  fills: Fill[];
  confidence: number;
  level: 'ALTA' | 'MEDIA' | 'DUVIDA';
  doubt: string | null;
  alternative: string | null;
  resultingDay: string;
};

/**
 * Leitura completa do dia. `punches` já com o tipo efetivo atual (original ou leitura anterior do gestor).
 * Batidas manuais (*) e leituras confirmadas pelo gestor (`fixed`) são respeitadas; só as originais do totem/app são relidas.
 */
export function interpretDay(input: { punches: (DayPunch & { fixed?: boolean })[]; schedule: ClassSchedule; habit: Habit | null }): Reading {
  const sorted = [...input.punches].sort((a, b) => a.min - b.min);
  const fixed = sorted.filter((p) => p.manual || p.fixed);
  const free = sorted.filter((p) => !p.manual && !p.fixed);
  const fixedTypes = fixed.map((p) => p.type as PType);
  const cls = classify(free.map((p) => p.min), input.schedule, input.habit, fixedTypes);
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
  const fill = proposeFill(lab, input.schedule, input.habit);
  doubt = doubt ?? fill.doubt;
  let confidence = free.length ? cls.confidence : 0.99;
  if (doubt) confidence = Math.min(confidence, 0.3);
  const level = confidence >= AUTO_MIN_CONFIDENCE ? 'ALTA' : confidence < DOUBT_MAX_CONFIDENCE ? 'DUVIDA' : 'MEDIA';
  const items = [
    ...sorted.map((p) => ({ min: p.min, text: `${hm(p.min)} ${LABEL[labels[p.id]]}${p.manual ? '*' : ''}` })),
    ...fill.fills.map((f) => ({ min: f.min, text: `${hm(f.min)} ${LABEL[f.type]}*` })),
  ].sort((a, b) => a.min - b.min);
  const alternative = cls.alternative && free.length ? free.map((p, i) => `${hm(p.min)} ${LABEL[cls.alternative![i]]}`).join(' · ') : null;
  return { labels, relabels, fills: fill.fills, confidence, level, doubt, alternative, resultingDay: items.map((x) => x.text).join(' · ') };
}

/** Texto curto da sugestão (título de pendência). */
export function describeReading(r: Reading): string {
  const parts = [
    ...r.relabels.map((x) => `${hm(x.min)} é ${LABEL[x.to]} (totem: ${LABEL[x.from]})`),
    ...r.fills.map((f) => `${LABEL[f.type]} ${hm(f.min)}*`),
  ];
  return parts.join(' + ');
}
