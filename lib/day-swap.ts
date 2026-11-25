/**
 * Troca de dia (compensação na semana) — SÓ para quem tem jornada flexível no cadastro (ex.: Cássio 0506).
 * A grade de dias não muda. Na mesma semana (seg–dom, Brasília):
 *  - veio num dia fora da grade E faltou num dia da grade → é troca: nenhuma pendência "Fora da escala"/"Sem nenhuma batida";
 *  - veio fora da grade sem faltar → continua "dia extra" informativo;
 *  - faltou sem compensar → vira falta só quando a semana acaba; antes disso fica "aguardando compensação".
 * Puro (sem banco).
 */
export type WeekDayStatus = {
  date: string;
  /** dia da grade (workDays + escala) */
  scheduled: boolean;
  /** tem batida válida */
  worked: boolean;
  /** coberto por atestado/abono/feriado do dia inteiro */
  covered: boolean;
};
export type Swap = { extra: string; missed: string };
export type WeekSwapResult = { swaps: Swap[]; waiting: string[]; unmatchedMissed: string[]; unmatchedExtra: string[]; weekEnded: boolean; weekEnd: string };

const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

/** Segunda a domingo da semana de `date` (datas já em horário de Brasília). */
export function weekOf(date: string) {
  const start = addDays(date, -((weekdayOf(date) + 6) % 7));
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return { start, end: days[6], days };
}

export const dayLabel = (date: string) => `${WD[weekdayOf(date)]} ${date.slice(8, 10)}/${date.slice(5, 7)}`;

/**
 * Casa dias extras com faltas da mesma semana (um para um, mais próximo primeiro).
 * `today` = data de hoje em Brasília: um dia da grade só conta como falta depois que passou (date < today).
 */
export function pairWeekSwaps(days: WeekDayStatus[], today: string): WeekSwapResult {
  const { end } = weekOf(days[0]?.date || today);
  const missed = days.filter((d) => d.scheduled && !d.worked && !d.covered && d.date < today).map((d) => d.date).sort();
  const extras = days.filter((d) => !d.scheduled && d.worked).map((d) => d.date).sort();
  const swaps: Swap[] = [];
  const freeExtras = [...extras];
  const unmatchedMissed: string[] = [];
  for (const m of missed) {
    if (!freeExtras.length) { unmatchedMissed.push(m); continue; }
    const dist = (x: string) => Math.abs(+new Date(`${x}T12:00:00Z`) - +new Date(`${m}T12:00:00Z`));
    const best = [...freeExtras].sort((a, b) => dist(a) - dist(b) || a.localeCompare(b))[0];
    freeExtras.splice(freeExtras.indexOf(best), 1);
    swaps.push({ extra: best, missed: m });
  }
  const weekEnded = today > end;
  return { swaps, waiting: weekEnded ? [] : unmatchedMissed, unmatchedMissed, unmatchedExtra: freeExtras, weekEnded, weekEnd: end };
}

export function swapNote(s: Swap) {
  return `Troca de dia: veio ${dayLabel(s.extra)} no lugar de ${dayLabel(s.missed)}`;
}

/** Situação de um dia específico dentro da semana. */
export function swapStatusFor(date: string, r: WeekSwapResult): { kind: 'TROCA'; note: string; swap: Swap } | { kind: 'AGUARDANDO'; note: string } | null {
  const s = r.swaps.find((x) => x.extra === date || x.missed === date);
  if (s) return { kind: 'TROCA', note: swapNote(s), swap: s };
  if (r.waiting.includes(date)) return { kind: 'AGUARDANDO', note: `Aguardando compensação: pode vir em outro dia até ${dayLabel(r.weekEnd)} (jornada flexível)` };
  return null;
}
