/** Troca de dia (jornada flexível): carrega a semana e reconcilia pendências "Fora da escala"/"Sem nenhuma batida". */
import prisma from './prisma';
import { brazilDateKey } from './brazil-time';
import { classifierProfile } from './employee-rules';
import { pairWeekSwaps, swapStatusFor, weekOf, type WeekDayStatus } from './day-swap';
import { dateKeyOf, scheduleFor, type ACEmployee } from './auto-close';
import { getOperationalAbono, shouldSuppressAbono } from './operational-abonos';

const HOURLY = new Set(['HORAS', 'PERIODO_HORAS', 'TRABALHO_EXTERNO_HORAS', 'CONSULTA_MEDICA', 'SAIDA_MEDICA']);
const certKey = (v: Date | string) => new Date(v).toISOString().slice(0, 10);

/** Situação dos 7 dias (seg–dom) da semana de `date`, só para quem tem jornada flexível. */
export async function loadWeekStatus(employees: ACEmployee[], date: string): Promise<Map<string, WeekDayStatus[]>> {
  const out = new Map<string, WeekDayStatus[]>();
  const flex = employees.filter((e) => classifierProfile(e.profileJson).flexible);
  if (!flex.length) return out;
  const { start, end, days } = weekOf(date);
  const ids = flex.map((e) => e.id);
  const [punches, certs] = await Promise.all([
    prisma.punch.findMany({ where: { userId: { in: ids }, status: 'VALID', timestamp: { gte: new Date(`${start}T00:00:00-03:00`), lte: new Date(`${end}T23:59:59.999-03:00`) } }, select: { userId: true, timestamp: true } }),
    prisma.medicalCertificate.findMany({ where: { userId: { in: ids }, status: { in: ['ATIVO', 'APROVADO'] }, startDate: { lte: new Date(`${end}T12:00:00.000Z`) }, endDate: { gte: new Date(`${start}T12:00:00.000Z`) } }, select: { userId: true, type: true, startDate: true, endDate: true, startTime: true, endTime: true } }),
  ]);
  for (const e of flex) {
    out.set(e.id, days.map((d) => {
      const ops = shouldSuppressAbono(e.employeeNumber, d) ? null : getOperationalAbono(e.employeeNumber, d);
      const covered = ops?.kind === 'FULL_DAY' || certs.some((c) => c.userId === e.id && c.type !== 'DIA_EXTRA' && !HOURLY.has(c.type) && !(c.startTime && c.endTime) && certKey(c.startDate) <= d && certKey(c.endDate) >= d);
      // "Dia extra" lançado pelo gestor também compensa um dia da grade (vira troca de dia; o registro original fica).
      return { date: d, scheduled: scheduleFor(e, d).scheduled, worked: punches.some((p) => p.userId === e.id && dateKeyOf(p.timestamp) === d), covered };
    }));
  }
  return out;
}

/** Nota de troca/aguardando para o painel (Dia do colaborador). */
export async function swapInfoFor(employee: ACEmployee, date: string, today = brazilDateKey()) {
  if (!classifierProfile(employee.profileJson).flexible) return null;
  const week = (await loadWeekStatus([employee], date)).get(employee.id);
  return week ? swapStatusFor(date, pairWeekSwaps(week, today)) : null;
}

export const SWAP_KINDS = ['FORA_ESCALA', 'SEM_BATIDAS'];
const WAITING_PREFIX = 'Aguardando compensação';

export type SwapAction = { userId: string; date: string; action: 'RESOLVE_TROCA' | 'AGUARDANDO' | 'REOPEN' | 'UPSERT'; kind: string; text: string; pendenciaId?: string };

/**
 * Reconcilia a semana anterior e a atual (até `date`) de quem tem jornada flexível:
 *  - troca → fecha "Fora da escala"/"Sem nenhuma batida" com a nota da troca;
 *  - falta com a semana em aberto → fecha como "Aguardando compensação" (reabre se a semana acabar sem compensar);
 *  - semana acabou sem compensar → "Sem nenhuma batida" volta/aparece.
 * Nunca toca em batidas nem na grade.
 */
export async function reconcileFlexibleWeeks({ date, mode, runId, dryRunOnly = false, today = brazilDateKey(), evaluate }: {
  date: string; mode: 'DRY_RUN' | 'REAL'; runId: string | null; dryRunOnly?: boolean; today?: string;
  evaluate: (d: string, userIds: string[]) => Promise<{ decisions: { employeeId: string; outcome: string; reason: string; note?: string; pendencia?: { kind: string; title: string; detail: string; suggestion: unknown } | null }[] }>;
}): Promise<SwapAction[]> {
  const emps = await prisma.user.findMany({ where: { role: 'EMPLOYEE', active: true }, select: { id: true, profileJson: true } });
  const ids = emps.filter((e) => classifierProfile(e.profileJson).flexible).map((e) => e.id);
  if (!ids.length) return [];
  const startPrev = weekOf(weekOf(date).start).start;
  const prevMonday = new Date(`${startPrev}T12:00:00Z`); prevMonday.setUTCDate(prevMonday.getUTCDate() - 7);
  const dates: string[] = [];
  for (let d = new Date(prevMonday); d.toISOString().slice(0, 10) <= date && d.toISOString().slice(0, 10) <= today; d.setUTCDate(d.getUTCDate() + 1)) dates.push(d.toISOString().slice(0, 10));
  const actions: SwapAction[] = [];
  for (const d of dates) {
    const { decisions } = await evaluate(d, ids);
    for (const x of decisions) {
      const open = await prisma.pendencia.findMany({ where: { userId: x.employeeId, date: d, kind: { in: SWAP_KINDS } }, select: { id: true, kind: true, status: true, resolution: true } });
      const isTroca = Boolean(x.note && x.note.startsWith('Troca de dia') && (x.outcome === 'OK' || x.outcome === 'SKIP'));
      if (isTroca) {
        for (const p of open.filter((p) => p.status === 'OPEN')) {
          actions.push({ userId: x.employeeId, date: d, action: 'RESOLVE_TROCA', kind: p.kind, text: x.note!, pendenciaId: p.id });
          if (!dryRunOnly) await prisma.pendencia.update({ where: { id: p.id }, data: { status: 'RESOLVED', resolution: x.note!, resolvedAt: new Date() } });
        }
        continue;
      }
      if (x.outcome === 'DEFER' && x.reason.startsWith(WAITING_PREFIX)) {
        for (const p of open.filter((p) => p.status === 'OPEN' && p.kind === 'SEM_BATIDAS')) {
          actions.push({ userId: x.employeeId, date: d, action: 'AGUARDANDO', kind: p.kind, text: x.reason, pendenciaId: p.id });
          if (!dryRunOnly) await prisma.pendencia.update({ where: { id: p.id }, data: { status: 'RESOLVED', resolution: x.reason, resolvedAt: new Date() } });
        }
        continue;
      }
      if (x.outcome === 'PENDENCIA' && x.pendencia && SWAP_KINDS.includes(x.pendencia.kind)) {
        const ex = open.find((p) => p.kind === x.pendencia!.kind);
        if (ex && ex.status !== 'OPEN' && String(ex.resolution || '').startsWith(WAITING_PREFIX)) {
          actions.push({ userId: x.employeeId, date: d, action: 'REOPEN', kind: ex.kind, text: `${x.pendencia.title} (semana acabou sem compensação)`, pendenciaId: ex.id });
          if (!dryRunOnly) await prisma.pendencia.update({ where: { id: ex.id }, data: { status: 'OPEN', resolution: null, resolvedAt: null, title: x.pendencia.title, detail: `${x.pendencia.detail} Semana acabou sem compensação.`, dryRun: mode === 'DRY_RUN', runId } });
        } else if (!ex) {
          actions.push({ userId: x.employeeId, date: d, action: 'UPSERT', kind: x.pendencia.kind, text: x.pendencia.title });
          if (!dryRunOnly) await prisma.pendencia.create({ data: { userId: x.employeeId, date: d, kind: x.pendencia.kind, title: x.pendencia.title, detail: x.pendencia.detail, suggestionJson: x.pendencia.suggestion ? JSON.stringify(x.pendencia.suggestion) : null, dryRun: mode === 'DRY_RUN', runId } });
        }
      }
    }
  }
  return actions;
}
