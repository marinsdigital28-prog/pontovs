/**
 * Regras dos cards do painel Hoje. Usadas no card e na gaveta para os números
 * nunca divergirem. Só leitura — não grava batida.
 */
import { toMin } from './auto-close';
import { DISREGARDED } from './punch-duplicates';

export type KpiPunch = { type: string; time: string; rejected: boolean };
export type KpiSchedule = { start: string; end: string; mode: string; lunchStart?: string | null; lunchEnd?: string | null };
export type KpiPerson = {
  id: string;
  name: string;
  scheduled: boolean;
  schedule: KpiSchedule | null;
  punches: KpiPunch[];
  lastType: string | null;
  absence: unknown | null;
};

export function kpiGroups<T extends KpiPerson>(people: T[], nowMin: number) {
  const today = people.filter((p) => p.scheduled || p.punches.some((x) => !x.rejected));
  const working = people.filter((p) => p.lastType && p.lastType !== 'SAIDA');
  const inLunch = people.filter((p) => p.lastType === 'INTERVALO');
  const left = people.filter((p) => p.lastType === 'SAIDA');
  const leftHalf = left.filter((p) => p.schedule?.mode === 'HALF');
  const leftAbs = left.filter((p) => p.absence);
  const noRecord = people.filter((p) => p.scheduled && p.schedule && !p.absence && !p.punches.some((x) => !x.rejected) && nowMin >= toMin(p.schedule.start));
  return { today, working, inLunch, left, leftHalf, leftAbs, noRecord };
}

export function kpiCounts<T extends KpiPerson>(people: T[], nowMin: number) {
  const g = kpiGroups(people, nowMin);
  return {
    working: g.working.length,
    today: g.today.length,
    inLunch: g.inLunch.length,
    left: g.left.length,
    leftHalf: g.leftHalf.length,
    leftAbs: g.leftAbs.length,
    noRecord: g.noRecord.length,
  };
}

const COUNTED = new Set(['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA']);

/** Horas trabalhadas no dia (ignora rejeitadas e DESCONSIDERADA). Se o turno está aberto, conta até nowMin. */
export function workedMinutes(punches: KpiPunch[], nowMin: number, stillOpen = true) {
  const valid = punches
    .filter((p) => !p.rejected && p.type !== DISREGARDED && COUNTED.has(p.type))
    .map((p) => ({ type: p.type, m: toMin(p.time) }))
    .filter((p) => Number.isFinite(p.m))
    .sort((a, b) => a.m - b.m);
  let total = 0;
  let open: number | null = null;
  for (const x of valid) {
    if (x.type === 'ENTRADA' || x.type === 'RETORNO') open = x.m;
    else if (open != null && (x.type === 'INTERVALO' || x.type === 'SAIDA')) {
      total += Math.max(0, x.m - open);
      open = null;
    }
  }
  if (stillOpen && open != null) total += Math.max(0, nowMin - open);
  return total;
}

export function fmtH(min: number) {
  const m = Math.round(Math.abs(min));
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
}

export function expectedMinutes(schedule: KpiSchedule | null) {
  if (!schedule) return null;
  const span = toMin(schedule.end) - toMin(schedule.start);
  if (!Number.isFinite(span) || span <= 0) return null;
  return span > 6 * 60 ? span - 60 : span;
}

export function workStatus(p: KpiPerson): { key: 'em_intervalo' | 'voltou' | 'trabalhando'; label: string } {
  const lastEffective = [...p.punches].reverse().find((x) => !x.rejected && x.type !== DISREGARDED);
  const t = lastEffective?.type || p.lastType;
  const time = lastEffective?.time;
  if (t === 'INTERVALO') return { key: 'em_intervalo', label: time ? `No almoço desde ${time}` : 'No almoço' };
  if (t === 'RETORNO') return { key: 'voltou', label: time ? `Voltou às ${time}` : 'Voltou do almoço' };
  if (t === 'ENTRADA') return { key: 'trabalhando', label: p.schedule?.mode === 'HALF' ? 'Meio período' : 'Trabalhando (ainda não saiu p/ almoço)' };
  return { key: 'trabalhando', label: 'Trabalhando' };
}

export function entradaOf(p: KpiPerson) {
  const e = p.punches.find((x) => !x.rejected && x.type !== DISREGARDED && x.type === 'ENTRADA');
  return e?.time || p.punches.find((x) => !x.rejected && x.type !== DISREGARDED)?.time || null;
}

export function pendenciaCounts(pendencias: { level: string }[]) {
  const lv = (l: string) => pendencias.filter((p) => p.level === l).length;
  return { alta: lv('ALTA'), media: lv('MEDIA'), conferir: lv('DUVIDA') + lv('CONFERIR'), openCount: pendencias.length };
}

export function isLate14Suggestion(suggestion: { kind?: string; punches?: { type: string; time: string }[] } | null | undefined) {
  if (!suggestion || suggestion.kind !== 'INSERT_PUNCHES') return false;
  return (suggestion.punches || []).some((x) => x.type === 'RETORNO' && toMin(x.time) >= 13 * 60 + 30);
}

export function capJob(title: string | null | undefined) {
  if (!title) return '—';
  const t = title.trim().toLowerCase();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '—';
}
