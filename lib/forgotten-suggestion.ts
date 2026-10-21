/**
 * Sugestão inteligente de horário para batidas esquecidas.
 * Prioridade: informado pelo colaborador > mediana dos últimos 10 dias úteis > jornada > regra do almoço.
 */
export type PunchKind = 'ENTRADA' | 'INTERVALO' | 'RETORNO' | 'SAIDA';
export type Confidence = 'ALTA' | 'MEDIA' | 'BAIXA';
export type SuggestionSource = 'COLABORADOR' | 'HISTORICO' | 'JORNADA' | 'REGRA_ALMOCO';
export type Suggestion = { time: string; confidence: Confidence; source: SuggestionSource; detail: string };
export type HistoryPunch = { type: string; timestamp: Date };
export type DaySchedule = { start: string | null; end: string | null; mode: 'FULL' | 'HALF' } | null;

const TZ = 'America/Sao_Paulo';
export const HISTORY_DAYS = 10;
export const HIGH_SPREAD_MINUTES = 10;

export function clockToMinutes(value: string | null | undefined) {
  const m = String(value ?? '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]); const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}
export function minutesToClock(value: number) {
  const v = Math.max(0, Math.min(23 * 60 + 59, Math.round(value)));
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}
export function brazilDayKey(date: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
export function brazilMinutes(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0);
  return get('hour') * 60 + get('minute');
}
export function median(values: number[]) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b); const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}
/** Desvio absoluto mediano: robusto a um dia atípico. */
export function medianAbsoluteDeviation(values: number[]) {
  const m = median(values); if (m === null) return null;
  return median(values.map((v) => Math.abs(v - m)));
}

/** Extrai o horário informado pelo colaborador (ex.: "Horário aproximado: 17:05"). */
export function parseInformedTime(details: string | null | undefined): string | null {
  if (!details) return null;
  const m = details.match(/Hor[áa]rio aproximado:\s*(\d{1,2}:\d{2})/i) || details.match(/(?:às|as)\s*(\d{1,2}:\d{2})/i) || details.match(/~\s*(\d{1,2}:\d{2})/) || details.match(/\b(\d{1,2}:\d{2})\b/);
  if (!m) return null;
  const minutes = clockToMinutes(m[1]);
  return minutes === null ? null : minutesToClock(minutes);
}

/** Últimos N dias distintos (antes de `date`) com batida daquele tipo; usa a primeira do dia (ou a última, para SAIDA). */
export function historySamples(history: HistoryPunch[], type: string, date: string, days = HISTORY_DAYS) {
  const byDay = new Map<string, number>();
  const sorted = [...history].filter((p) => p.type === type).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  for (const p of sorted) {
    const key = brazilDayKey(p.timestamp);
    if (key >= date) continue;
    const minutes = brazilMinutes(p.timestamp);
    if (type === 'SAIDA' || !byDay.has(key)) byDay.set(key, minutes);
  }
  return [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, days).map(([, m]) => m);
}

export function suggestMissingTime(input: { type: PunchKind; date: string; informedTime?: string | null; history: HistoryPunch[]; schedule: DaySchedule }): Suggestion | null {
  const { type, date, informedTime, history, schedule } = input;
  if (informedTime && clockToMinutes(informedTime) !== null) {
    return { time: minutesToClock(clockToMinutes(informedTime)!), confidence: 'ALTA', source: 'COLABORADOR', detail: 'Horário informado pelo próprio colaborador' };
  }
  const samples = historySamples(history, type, date);
  if (samples.length >= 3) {
    const m = median(samples)!; const spread = medianAbsoluteDeviation(samples) ?? 0;
    return { time: minutesToClock(m), confidence: spread <= HIGH_SPREAD_MINUTES ? 'ALTA' : 'MEDIA', source: 'HISTORICO', detail: `Baseado nos últimos ${samples.length} dias: ${minutesToClock(m)} ± ${spread} min` };
  }
  const start = clockToMinutes(schedule?.start); const end = clockToMinutes(schedule?.end);
  if (type === 'ENTRADA' && start !== null) return { time: minutesToClock(start), confidence: 'MEDIA', source: 'JORNADA', detail: `Início da jornada cadastrada (${minutesToClock(start)})` };
  if (type === 'SAIDA' && end !== null) return { time: minutesToClock(end), confidence: 'MEDIA', source: 'JORNADA', detail: `Fim da jornada cadastrada (${minutesToClock(end)})` };
  if ((type === 'INTERVALO' || type === 'RETORNO') && start !== null && end !== null) {
    const lunch = Math.min(end - 60, Math.max(start, 12 * 60));
    const time = type === 'INTERVALO' ? lunch : lunch + 60;
    return { time: minutesToClock(time), confidence: 'BAIXA', source: 'REGRA_ALMOCO', detail: 'Regra padrão: almoço de 1 hora a partir das 12:00' };
  }
  return null;
}

/** Mantém a ordem cronológica das sugestões em relação às batidas existentes (evita sugerir SAIDA antes da ENTRADA). */
export function isChronological(punches: Array<{ type: string; minutes: number }>) {
  const order = ['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA'];
  const sorted = [...punches].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  return sorted.every((p, i) => i === 0 || p.minutes > sorted[i - 1].minutes);
}

export function overallConfidence(list: Array<Suggestion | null>): Confidence {
  if (!list.length || list.some((s) => !s)) return 'BAIXA';
  if (list.every((s) => s!.confidence === 'ALTA')) return 'ALTA';
  if (list.some((s) => s!.confidence === 'BAIXA')) return 'BAIXA';
  return 'MEDIA';
}

export const SOURCE_LABEL: Record<SuggestionSource, string> = { COLABORADOR: 'Informado pelo colaborador', HISTORICO: 'Padrão dos últimos dias', JORNADA: 'Jornada cadastrada', REGRA_ALMOCO: 'Regra do almoço' };
