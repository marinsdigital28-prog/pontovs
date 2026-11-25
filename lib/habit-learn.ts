/**
 * Aprendizado com as correções do gestor.
 *
 * As batidas originais nunca são alteradas (Portaria 671). O que o gestor corrige
 * (tipo efetivo ou ajuste *) entra nesta camada, à parte, como sinal no hábito
 * ponderado de 90 dias (peso 3× nos 30 recentes) e no recorte por dia da semana.
 *
 * Não baixa a barra do "padrão claro" (≥5 dias e dispersão ≤20 min): sem padrão
 * claro, a leitura continua DÚVIDA, sem horário inventado. O almoço fixo da escala
 * e a jornada flexível são decididos no classificador (não aqui).
 *
 * Puro (sem banco, sem IA).
 */
import type { Habit, HistoryDay, PType } from './punch-classifier';

const ORDER: readonly PType[] = ['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA'];
const HABIT_WINDOW_DAYS = 90;
const HABIT_RECENT_DAYS = 30;
const HABIT_RECENT_WEIGHT = 3;
const HABIT_MIN_DAYS = 4;
const CLEAR_MIN_DAYS = 5;
const CLEAR_MAX_SPREAD = 20;
const LESSON_BOOST = 1.5;

export type LessonKind = 'RELABEL' | 'FILL';
export type LessonSource = 'GESTOR' | 'SUGESTAO_ACEITA';

export type Lesson = {
  date: string;
  type: PType;
  min: number;
  kind: LessonKind;
  source?: LessonSource;
  fromType?: string;
};

export type LearnedFrom = { date: string; type: PType; kind: LessonKind };

const DAY_MS = 86_400_000;

export function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00-03:00`).getDay(); // 0=domingo … 6=sábado (Brasília)
}

export function daysBetween(from: string, to: string): number {
  return Math.round((new Date(`${to}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) / DAY_MS);
}

/** Peso da correção do gestor: quanto mais recente, mais forte (usado nos testes e no recorte por dia). */
export function recencyWeight(lessonDate: string, asOf: string): number {
  const d = daysBetween(lessonDate, asOf);
  if (d <= 7) return 4;
  if (d <= 14) return 3;
  if (d <= 30) return 2.5;
  if (d <= 60) return 2;
  return 1.5;
}

export function weightedMedian(samples: { value: number; weight: number }[]): number | null {
  const s = samples.filter((x) => x.weight > 0 && Number.isFinite(x.value)).sort((a, b) => a.value - b.value);
  if (!s.length) return null;
  const total = s.reduce((a, x) => a + x.weight, 0);
  let acc = 0;
  for (let i = 0; i < s.length; i += 1) {
    acc += s[i].weight;
    if (acc * 2 === total && s[i + 1]) return (s[i].value + s[i + 1].value) / 2;
    if (acc * 2 > total) return s[i].value;
  }
  return s[s.length - 1].value;
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isComplete(punches: { type: string; min: number }[]) {
  return punches.length === 4 && punches.every((p, i) => p.type === ORDER[i]);
}

/** Junta as correções (*) e de tipo ao histórico do dia, sem reescrever originais. */
export function mergeLessonsIntoHistory(history: HistoryDay[], lessons: Lesson[], beforeDate: string): HistoryDay[] {
  const byDate = new Map<string, { type: string; min: number }[]>();
  for (const d of history) {
    if (d.date < beforeDate) byDate.set(d.date, d.punches.map((p) => ({ ...p })));
  }
  for (const l of lessons) {
    if (l.date >= beforeDate) continue;
    const row = byDate.get(l.date) || [];
    const i = row.findIndex((p) => p.type === l.type || (l.kind === 'RELABEL' && l.fromType && p.type === l.fromType && p.min === l.min));
    if (l.kind === 'RELABEL') {
      const hit = row.find((p) => p.min === l.min) || (i >= 0 ? row[i] : null);
      if (hit) hit.type = l.type;
      else row.push({ type: l.type, min: l.min });
    } else if (!row.some((p) => p.type === l.type)) {
      row.push({ type: l.type, min: l.min });
    }
    row.sort((a, b) => a.min - b.min);
    byDate.set(l.date, row);
  }
  return [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, punches]) => ({ date, punches }));
}

/**
 * Hábito de 90 dias com as correções do gestor como sinal (peso 3× nos 30 recentes, leve
 * reforço no dia corrigido). Sem lessons, use `computeHabit` do classificador.
 */
export function computeHabitWithLessons(history: HistoryDay[], date: string, lessons: Lesson[]): Habit | null {
  const prior = lessons.filter((l) => l.date < date);
  const merged = mergeLessonsIntoHistory(history, prior, date);
  const from = addDays(date, -HABIT_WINDOW_DAYS);
  const recent = addDays(date, -HABIT_RECENT_DAYS);
  const complete = merged.filter((d) => d.date < date && d.date >= from && isComplete(d.punches));

  const dayWeight = (day: string) => {
    const base = day >= recent ? HABIT_RECENT_WEIGHT : 1;
    return prior.some((l) => l.date === day) ? base * LESSON_BOOST : base;
  };

  const rows = complete.map((d) => ({
    date: d.date,
    w: dayWeight(d.date),
    row: Object.fromEntries(d.punches.map((p) => [p.type, p.min])) as Record<PType, number>,
  }));

  const extra: { date: string; type: PType; min: number; w: number }[] = [];
  for (const l of prior) {
    if (l.date < from) continue;
    if (rows.some((r) => r.date === l.date && r.row[l.type] !== undefined)) continue;
    extra.push({ date: l.date, type: l.type, min: l.min, w: (l.date >= recent ? HABIT_RECENT_WEIGHT : 1) * LESSON_BOOST });
  }

  if (rows.length < HABIT_MIN_DAYS && prior.filter((l) => l.date >= from).length < 2) return null;
  if (!rows.length && !extra.length) return null;

  const samplesFor = (type: PType) => {
    const s = rows.map((r) => ({ value: r.row[type], weight: r.w }));
    for (const e of extra) if (e.type === type) s.push({ value: e.min, weight: e.w });
    return s;
  };

  const h = { spread: {} as Record<PType, number>, clear: {} as Record<PType, boolean> } as Habit;
  for (const t of ORDER) {
    const m = weightedMedian(samplesFor(t));
    if (m === null) return null;
    h[t] = m;
  }

  // Recorte por pessoa+dia da semana só com evidência forte: ≥5 dias completos daquele weekday
  // com dispersão baixa, ou ≥2 correções do gestor daquele tipo no mesmo weekday.
  // Não mistura só porque há 3 dias — isso tipava Entrada para 07:20 e furava a escala.
  const wd = weekdayOf(date);
  const wdRows = rows.filter((r) => weekdayOf(r.date) === wd);
  const wdLessons = prior.filter((l) => weekdayOf(l.date) === wd && l.date >= from);
  for (const t of ORDER) {
    const typLessons = wdLessons.filter((l) => l.type === t);
    const s = [
      ...wdRows.map((r) => ({ value: r.row[t], weight: 1 })),
      ...typLessons.map((l) => ({ value: l.min, weight: 1 })),
    ];
    const wm = weightedMedian(s);
    if (wm === null) continue;
    const wdSpread = weightedMedian(s.map((x) => ({ value: Math.abs(x.value - wm), weight: 1 }))) ?? 999;
    const strongDays = wdRows.length >= 5 && wdSpread <= 20;
    const strongLessons = typLessons.length >= 2;
    if (!strongDays && !strongLessons) continue;
    const mix = strongDays || typLessons.length >= 3 ? 0.5 : 0.3;
    h[t] = mix * wm + (1 - mix) * h[t];
  }

  h.n = rows.length;
  h.nRecent = rows.filter((r) => r.date >= recent).length;
  const lunchSamples = rows.map((r) => ({ value: r.row.RETORNO - r.row.INTERVALO, weight: r.w }));
  h.lunch = Math.max(60, (lunchSamples.length ? weightedMedian(lunchSamples) : null) ?? 60);
  h.lunchSpread = (lunchSamples.length ? weightedMedian(lunchSamples.map((x) => ({ value: Math.abs(x.value - h.lunch), weight: x.weight }))) : null) ?? 0;
  for (const t of ORDER) {
    h.spread[t] = weightedMedian(samplesFor(t).map((s) => ({ value: Math.abs(s.value - h[t]), weight: s.weight }))) ?? 0;
    // a lição não reduz o mínimo de dias nem a dispersão exigida para "padrão claro"
    h.clear[t] = h.n >= CLEAR_MIN_DAYS && h.spread[t] <= CLEAR_MAX_SPREAD;
  }

  // Sem ≥2 correções daquele tipo, não deixa a lição (ex.: um dia completado com *)
  // empurrar Entrada/Saída para longe do padrão de 90 dias já calculado sem lessons.
  const baselineRows = history
    .filter((d) => d.date < date && d.date >= from && isComplete(d.punches))
    .map((d) => ({
      date: d.date,
      w: d.date >= recent ? HABIT_RECENT_WEIGHT : 1,
      row: Object.fromEntries(d.punches.map((p) => [p.type, p.min])) as Record<PType, number>,
    }));
  if (baselineRows.length >= HABIT_MIN_DAYS) {
    const bw = baselineRows.map((r) => r.w);
    const bval = (type: PType) => weightedMedian(baselineRows.map((r) => ({ value: r.row[type], weight: r.w })))!;
    for (const typ of ['ENTRADA', 'SAIDA'] as PType[]) {
      if (prior.filter((l) => l.type === typ && l.date >= from).length >= 2) continue;
      const bv = bval(typ);
      const bSpread = weightedMedian(baselineRows.map((r) => ({ value: Math.abs(r.row[typ] - bv), weight: r.w }))) ?? 0;
      h[typ] = bv;
      h.spread[typ] = bSpread;
      h.clear[typ] = baselineRows.length >= CLEAR_MIN_DAYS && bSpread <= CLEAR_MAX_SPREAD;
    }
  }

  const seen = new Set<string>();
  h.learnedFrom = [...prior]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((l) => ({ date: l.date, type: l.type, kind: l.kind }))
    .filter((l) => {
      const k = `${l.date}:${l.type}:${l.kind}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  return h;
}

export function formatLessonDate(date: string) {
  const [, m, d] = date.split('-');
  return `${d}/${m}`;
}

/** Texto curto para o card da sugestão, ex.: "Aprendido com sua correção de 05/10". */
export function describeLearning(learnedFrom: LearnedFrom[] | undefined | null, focus?: PType): string | null {
  if (!learnedFrom?.length) return null;
  const list = focus ? learnedFrom.filter((l) => l.type === focus) : learnedFrom;
  const dates = [...new Set((list.length ? list : learnedFrom).map((l) => l.date))].sort().reverse();
  if (!dates.length) return null;
  if (dates.length === 1) return `Aprendido com sua correção de ${formatLessonDate(dates[0])}`;
  if (dates.length === 2) return `Aprendido com suas correções de ${formatLessonDate(dates[0])} e ${formatLessonDate(dates[1])}`;
  return `Aprendido com suas correções de ${formatLessonDate(dates[0])}, ${formatLessonDate(dates[1])} e outras`;
}

/** Monta lessons a partir das correções (relabel) e lançamentos * (fill) de um backtest. */
export function lessonsFromCorrections(input: {
  relabels?: { date: string; type: PType; min: number; fromType?: string }[];
  fills?: { date: string; type: PType; min: number }[];
}): Lesson[] {
  const out: Lesson[] = [];
  for (const r of input.relabels || []) out.push({ date: r.date, type: r.type, min: r.min, kind: 'RELABEL', fromType: r.fromType, source: 'GESTOR' });
  for (const f of input.fills || []) out.push({ date: f.date, type: f.type, min: f.min, kind: 'FILL', source: 'GESTOR' });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
