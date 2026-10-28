/**
 * Ajuste inteligente no fechamento — apenas SUGESTÕES para revisão do gestor.
 * Portaria 671: nunca altera marcações originais; cada sugestão aprovada vira uma
 * NOVA inclusão manual (origin ADJUSTED, marcada com * na folha) via POST /api/admin/punches.
 */
import { classifyDay, proposeFill, scheduledInterval, toClock, DEFAULT_LUNCH_MINUTES, type FillPunch, type ProposedFill } from './inconsistency-fill';
import { resolveDaySchedule, DAY_ORDER } from './day-schedule';

export type AdjustEmployee = { id: string; name: string; employeeNumber: string | null; jobTitle?: string | null; workDays?: string | null; scheduleStart?: string | null; scheduleEnd?: string | null; scheduleByDay?: string | null };
export type AdjustPunch = { userId: string; date: string; type: string; minutes: number; manual?: boolean };
export type AdjustKind = 'EXTERNO_SEM_ALMOCO' | 'COMPLETAR';
export type AdjustSuggestion = {
  key: string; employee: AdjustEmployee; date: string; schedule: string; kind: AdjustKind;
  punches: { type: string; time: string; manual?: boolean }[];
  fills: ProposedFill[];           // inclusões propostas (vazio = só confirmar)
  lunchAlternative: ProposedFill[]; // p/ EXTERNO: opção de lançar o almoço
  workedMinutes: number;            // horas do dia se a sugestão for aprovada
  note: string;
};

const worked = (ps: { type: string; minutes: number }[]) => {
  const s = [...ps].sort((a, b) => a.minutes - b.minutes);
  let total = 0; let open: number | null = null;
  for (const p of s) {
    if (p.type === 'ENTRADA' || p.type === 'RETORNO') open = p.minutes;
    else if ((p.type === 'INTERVALO' || p.type === 'SAIDA') && open !== null) { total += p.minutes - open; open = null; }
  }
  return total;
};

export function buildSuggestions(employees: AdjustEmployee[], punches: AdjustPunch[], opts: { untilDate: string; lunchMinutes?: number }): AdjustSuggestion[] {
  const lunch = opts.lunchMinutes ?? DEFAULT_LUNCH_MINUTES;
  const byDay = new Map<string, AdjustPunch[]>();
  for (const p of punches) { const k = `${p.userId}|${p.date}`; byDay.set(k, [...(byDay.get(k) || []), p]); }
  const out: AdjustSuggestion[] = [];
  for (const e of employees) {
    for (const [k, list] of byDay) {
      const [uid, date] = k.split('|');
      if (uid !== e.id || date >= opts.untilDate) continue;
      const weekday = new Date(`${date}T12:00:00-03:00`).getUTCDay();
      const sch = resolveDaySchedule(e.scheduleByDay, e.workDays, e.scheduleStart, e.scheduleEnd, weekday, e.employeeNumber);
      if (!sch) continue;
      const iv = scheduledInterval(e.scheduleByDay, DAY_ORDER[weekday]);
      const schedule = { ...sch, intervalStart: iv?.intervalStart ?? null, intervalEnd: iv?.intervalEnd ?? null };
      const ps: FillPunch[] = list.map((p) => ({ type: p.type, minutes: p.minutes })).sort((a, b) => a.minutes - b.minutes);
      const issues = classifyDay(ps, schedule, { lunchMinutes: lunch });
      if (!issues.length || issues.includes('SEM_MARCACAO')) continue;
      const base = { key: k, employee: e, date, schedule: `${sch.start}–${sch.end}`, punches: list.sort((a, b) => a.minutes - b.minutes).map((p) => ({ type: p.type, time: toClock(p.minutes), manual: p.manual })) };
      const onlyInOut = ps.length === 2 && ps[0].type === 'ENTRADA' && ps[1].type === 'SAIDA';
      if (onlyInOut && sch.mode === 'FULL') {
        out.push({ ...base, kind: 'EXTERNO_SEM_ALMOCO', fills: [], lunchAlternative: proposeFill(ps, schedule, { lunchMinutes: lunch }), workedMinutes: ps[1].minutes - ps[0].minutes, note: 'Só entrada e saída — provável evento externo sem almoço. Confirme as horas ou lance o almoço.' });
        continue;
      }
      const fills = proposeFill(ps, schedule, { lunchMinutes: lunch });
      if (!fills.length) continue;
      out.push({ ...base, kind: 'COMPLETAR', fills, lunchAlternative: [], workedMinutes: worked([...ps, ...fills]), note: fills.map((f) => f.reason).join(' · ') });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.employee.name.localeCompare(b.employee.name));
}
