/**
 * Inconsistências por colaborador e preenchimento automático coerente no fechamento.
 * Regras (Portaria 671): nunca altera marcações originais; só propõe INCLUSÕES manuais (marcadas com * na folha).
 */
export const DEFAULT_LUNCH_MINUTES = 60;
export const BREAK_TOLERANCE_MINUTES = 5; // tolerância (art. 58 §1º CLT) para não alertar 59 min
export const MAX_DAILY_MINUTES = 10 * 60; // jornada > 10h (8h + 2h extras) é alerta

export type FillPunch = { type: string; minutes: number };
export type FillSchedule = { start: string; end: string; mode: 'FULL' | 'HALF'; intervalStart?: string | null; intervalEnd?: string | null };
export type IssueCode = 'SEM_MARCACAO' | 'ENTRADA_FALTANDO' | 'SAIDA_FALTANDO' | 'SEM_INTERVALO' | 'INTERVALO_INCOMPLETO' | 'INTERVALO_CURTO' | 'MARCACOES_IMPARES' | 'JORNADA_EXCEDIDA';
export type ProposedFill = { type: 'ENTRADA' | 'INTERVALO' | 'RETORNO' | 'SAIDA'; minutes: number; time: string; reason: string };

export const ISSUE_LABEL: Record<IssueCode, string> = {
  SEM_MARCACAO: 'Sem marcação no dia',
  ENTRADA_FALTANDO: 'Entrada faltando',
  SAIDA_FALTANDO: 'Saída faltando',
  SEM_INTERVALO: 'Sem almoço/intervalo',
  INTERVALO_INCOMPLETO: 'Intervalo incompleto',
  INTERVALO_CURTO: 'Intervalo menor que o mínimo',
  MARCACOES_IMPARES: 'Marcações ímpares',
  JORNADA_EXCEDIDA: 'Jornada acima do limite',
};

export function toMinutes(clock: string | null | undefined) {
  if (!clock || !/^\d{1,2}:\d{2}/.test(clock)) return null;
  const [h, m] = clock.slice(0, 5).split(':').map(Number);
  return h * 60 + m;
}
export function toClock(min: number) {
  const v = Math.max(0, Math.min(23 * 60 + 59, Math.round(min)));
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}
export const round5 = (min: number) => Math.round(min / 5) * 5;

const first = (ps: FillPunch[], t: string) => ps.find((p) => p.type === t);
const last = (ps: FillPunch[], t: string) => [...ps].reverse().find((p) => p.type === t);

/** Classifica o dia. `punches` = marcações válidas do dia, em minutos locais. */
export function classifyDay(punchesIn: FillPunch[], schedule: FillSchedule, opts: { lunchMinutes?: number; maxDailyMinutes?: number } = {}): IssueCode[] {
  const lunch = opts.lunchMinutes ?? DEFAULT_LUNCH_MINUTES;
  const punches = [...punchesIn].sort((a, b) => a.minutes - b.minutes);
  if (!punches.length) return ['SEM_MARCACAO'];
  const out: IssueCode[] = [];
  const entry = first(punches, 'ENTRADA'); const exit = last(punches, 'SAIDA');
  const iv = first(punches, 'INTERVALO'); const rt = last(punches, 'RETORNO');
  if (!entry) out.push('ENTRADA_FALTANDO');
  if (!exit) out.push('SAIDA_FALTANDO');
  if (schedule.mode === 'FULL') {
    if (!iv && !rt) out.push('SEM_INTERVALO');
    else if (!iv || !rt) out.push('INTERVALO_INCOMPLETO');
    else if (rt.minutes - iv.minutes < lunch - BREAK_TOLERANCE_MINUTES) out.push('INTERVALO_CURTO');
  }
  if (punches.length % 2 === 1) out.push('MARCACOES_IMPARES');
  if (entry && exit) {
    const brk = iv && rt && rt.minutes > iv.minutes ? rt.minutes - iv.minutes : 0;
    if (exit.minutes - entry.minutes - brk > (opts.maxDailyMinutes ?? MAX_DAILY_MINUTES)) out.push('JORNADA_EXCEDIDA');
  }
  return out;
}

/**
 * Propõe inclusões coerentes para o dia. Retorna [] quando não há preenchimento seguro.
 * - Entrada/saída faltando → horário da escala (se mantiver a ordem cronológica).
 * - Sem almoço → intervalo de exatamente `lunchMinutes`: usa o intervalo da escala se couber
 *   dentro de entrada..saída; senão centraliza no meio da jornada (arredondado a 5 min).
 * - Só INTERVALO ou só RETORNO → completa o par com exatamente `lunchMinutes`.
 */
export function proposeFill(punchesIn: FillPunch[], schedule: FillSchedule, opts: { lunchMinutes?: number } = {}): ProposedFill[] {
  const lunch = opts.lunchMinutes ?? DEFAULT_LUNCH_MINUTES;
  const punches = [...punchesIn].sort((a, b) => a.minutes - b.minutes);
  if (!punches.length) return []; // falta/ausência: não inventar jornada
  const fills: ProposedFill[] = [];
  const sStart = toMinutes(schedule.start); const sEnd = toMinutes(schedule.end);
  let entry = first(punches, 'ENTRADA')?.minutes ?? null;
  let exit = last(punches, 'SAIDA')?.minutes ?? null;
  const firstAny = punches[0].minutes; const lastAny = punches[punches.length - 1].minutes;
  if (entry === null && sStart !== null && sStart < firstAny) { entry = sStart; fills.push({ type: 'ENTRADA', minutes: sStart, time: toClock(sStart), reason: 'Entrada da escala' }); }
  if (exit === null && sEnd !== null && sEnd > lastAny) { exit = sEnd; fills.push({ type: 'SAIDA', minutes: sEnd, time: toClock(sEnd), reason: 'Saída da escala' }); }
  if (schedule.mode === 'FULL' && entry !== null && exit !== null) {
    const iv = first(punches, 'INTERVALO')?.minutes ?? null;
    const rt = last(punches, 'RETORNO')?.minutes ?? null;
    const inside = (a: number, b: number) => a > entry! && b < exit! && b - a === lunch;
    if (iv === null && rt === null) {
      const others = punches.map((p) => p.minutes);
      const clash = (a: number, b: number) => others.some((m) => m > a && m < b) || others.includes(a) || others.includes(b);
      let start: number | null = null;
      const si = toMinutes(schedule.intervalStart ?? null);
      if (si !== null && inside(si, si + lunch) && !clash(si, si + lunch)) start = si;
      if (start === null) {
        const c = round5((entry + exit) / 2 - lunch / 2);
        // tenta o centro arredondado e vizinhos múltiplos de 5 que caibam estritamente dentro da jornada
        for (const d of [0, -5, 5, -10, 10, -15, 15]) { const k = c + d; if (inside(k, k + lunch) && !clash(k, k + lunch)) { start = k; break; } }
      }
      if (start !== null) {
        fills.push({ type: 'INTERVALO', minutes: start, time: toClock(start), reason: si === start ? 'Intervalo da escala' : 'Intervalo centralizado na jornada' });
        fills.push({ type: 'RETORNO', minutes: start + lunch, time: toClock(start + lunch), reason: `Intervalo de ${lunch} min` });
      }
    } else if (iv !== null && rt === null) {
      if (iv + lunch < exit) fills.push({ type: 'RETORNO', minutes: iv + lunch, time: toClock(iv + lunch), reason: `Completa intervalo de ${lunch} min` });
    } else if (iv === null && rt !== null) {
      if (rt - lunch > entry) fills.push({ type: 'INTERVALO', minutes: rt - lunch, time: toClock(rt - lunch), reason: `Completa intervalo de ${lunch} min` });
    }
  }
  return fills.sort((a, b) => a.minutes - b.minutes);
}

/** Lê intervalo opcional da escala (scheduleByDay[DIA].intervalStart/intervalEnd), sem exigir mudança de schema. */
export function scheduledInterval(scheduleByDay: string | null | undefined, dayCode: string) {
  try { const v = JSON.parse(scheduleByDay || '{}')?.[dayCode]; return v && /^\d{2}:\d{2}$/.test(v.intervalStart || '') ? { intervalStart: v.intervalStart as string, intervalEnd: (v.intervalEnd as string) || null } : null; } catch { return null; }
}
