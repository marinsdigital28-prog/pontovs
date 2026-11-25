/**
 * Parte com banco da verificação 17:20: carrega o dia, grava pendências/ocorrências/ajustes e auditoria.
 * Nunca altera batida original: só INSERE batidas ajustadas (*) e cancela (soft) as que ela mesma criou.
 */
import prisma from './prisma';
import { appendAuditEvent } from './security-controls';
import { isPeriodClosed, periodFromDate } from './period-closure';
import { duplicatePunchReason, label as typeLabel } from './day-guards';
import { AUTO_CLOSE_REASON, dateKeyOf, evaluateDay, hmOf, summarize, toMin, type DayDecision, type Phase, type Suggestion, type SuggestionPunch, type SuggestionRelabel } from './auto-close';
import { isOriginalPunch, loadInterpretations, applyInterpretations, setInterpretation } from './punch-interpretation';
import { loadLessons, loadLessonsByUsers, recordLesson } from './habit-lessons';
import { HABIT_WINDOW_DAYS, type HistoryDay } from './punch-classifier';
import { loadWeekStatus, reconcileFlexibleWeeks, type SwapAction } from './day-swap-server';
import { brazilDateKey } from './brazil-time';
import { DISREGARDED, type DupFinding } from './punch-duplicates';

export type AutoCloseMode = 'DRY_RUN' | 'REAL';
export const MODE_KEY = 'autoClose.mode';

export async function getAutoCloseMode(): Promise<AutoCloseMode> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: MODE_KEY } });
    return row?.value === 'REAL' ? 'REAL' : 'DRY_RUN';
  } catch { return 'DRY_RUN'; }
}

export async function setAutoCloseMode(mode: AutoCloseMode, actorId: string) {
  await prisma.appSetting.upsert({ where: { key: MODE_KEY }, create: { key: MODE_KEY, value: mode, updatedById: actorId }, update: { value: mode, updatedById: actorId } });
  await appendAuditEvent({ action: 'AUTO_CLOSE_MODE_CHANGED', actorId, resource: 'AppSetting', resourceId: MODE_KEY, metadata: { mode } });
}

/** Autor técnico das gravações do robô (PunchAudit exige um usuário): o primeiro gestor ativo. */
export async function systemActorId() {
  const admin = await prisma.user.findFirst({ where: { active: true, role: { in: ['ADMIN', 'MANAGER'] } }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  return admin?.id || null;
}

const dayBounds = (date: string) => ({ from: new Date(`${date}T00:00:00-03:00`), to: new Date(`${date}T23:59:59.999-03:00`), noon: new Date(`${date}T12:00:00.000Z`) });

export async function loadDay(date: string, userIds?: string[]) {
  const { from, to, noon } = dayBounds(date);
  const employees = await prisma.user.findMany({
    where: { role: 'EMPLOYEE', active: true, ...(userIds ? { id: { in: userIds } } : {}) },
    select: { id: true, name: true, employeeNumber: true, workDays: true, scheduleStart: true, scheduleEnd: true, scheduleByDay: true, profileJson: true, unitId: true },
    orderBy: { name: 'asc' },
  });
  const ids = employees.map((e) => e.id);
  const [punches, photoRows, certificates, requests, undone] = await Promise.all([
    prisma.punch.findMany({ where: { userId: { in: ids }, timestamp: { gte: from, lte: to } }, select: { id: true, userId: true, type: true, timestamp: true, status: true, origin: true, clientId: true } }),
    prisma.punch.findMany({ where: { userId: { in: ids }, timestamp: { gte: from, lte: to }, photoData: { not: null } }, select: { id: true } }),
    prisma.medicalCertificate.findMany({ where: { userId: { in: ids }, startDate: { lte: noon }, endDate: { gte: noon } }, select: { id: true, userId: true, type: true, startDate: true, endDate: true, startTime: true, endTime: true, status: true } }),
    prisma.employeeRequest.findMany({ where: { employeeId: { in: ids }, startDate: { lte: to }, endDate: { gte: from }, status: { in: ['PENDENTE', 'APROVADO'] } }, select: { id: true, employeeId: true, type: true, status: true, startDate: true, endDate: true, launchedAt: true, reason: true, details: true } }),
    prisma.autoAdjustment.findMany({ where: { date, userId: { in: ids }, status: 'UNDONE' }, select: { userId: true, type: true } }),
  ]);
  const photos = new Set(photoRows.map((p) => p.id));
  // Padrão real: últimos 90 dias de batidas ORIGINAIS (tipo efetivo = leitura do sistema quando houver).
  const histFrom = new Date(from.getTime() - (HABIT_WINDOW_DAYS + 1) * 86_400_000);
  const histRows = await prisma.punch.findMany({ where: { userId: { in: ids }, status: 'VALID', timestamp: { gte: histFrom, lt: from } }, select: { id: true, userId: true, type: true, timestamp: true, origin: true, clientId: true }, orderBy: { timestamp: 'asc' } });
  const interp = await loadInterpretations([...punches.map((p) => p.id), ...histRows.map((p) => p.id)]);
  const history = new Map<string, HistoryDay[]>();
  for (const p of applyInterpretations(histRows.filter((r) => isOriginalPunch(r)), interp)) {
    const date = dateKeyOf(p.timestamp);
    const list = history.get(p.userId) || [];
    let day = list[list.length - 1];
    if (!day || day.date !== date) { day = { date, punches: [] }; list.push(day); }
    day.punches.push({ type: p.type, min: toMin(hmOf(p.timestamp)) });
    history.set(p.userId, list);
  }
  const lessons = await loadLessonsByUsers(ids, date);
  return { employees, punches: applyInterpretations(punches, interp).map((p) => ({ ...p, hasPhoto: photos.has(p.id) })), certificates, requests, undone, history, lessons };
}

export async function evaluateDate(date: string, phase: Phase, userIds?: string[]) {
  const data = await loadDay(date, userIds);
  const weeks = await loadWeekStatus(data.employees, date);
  const today = brazilDateKey();
  const decisions: DayDecision[] = [];
  for (const e of data.employees) {
    decisions.push(evaluateDay({
      employee: e, date, phase,
      punches: data.punches.filter((p) => p.userId === e.id),
      certificates: data.certificates.filter((c) => c.userId === e.id),
      requests: data.requests.filter((r) => r.employeeId === e.id),
      undoneTypes: data.undone.filter((u) => u.userId === e.id).map((u) => u.type),
      history: data.history.get(e.id) || [],
      lessons: data.lessons.get(e.id) || [],
      week: weeks.get(e.id),
      today,
    }));
  }
  return { decisions, employees: data.employees };
}

async function upsertOcorrencia(userId: string, date: string, source: 'AUTO_AJUSTE' | 'PENDENCIA', detail: string, refs: { pendenciaId?: string; adjustmentId?: string }) {
  const existing = await prisma.ocorrencia.findUnique({ where: { userId_date_kind: { userId, date, kind: 'ESQUECEU_BATIDA' } } });
  if (existing) {
    if (refs.adjustmentId && !existing.adjustmentId) await prisma.ocorrencia.update({ where: { id: existing.id }, data: { adjustmentId: refs.adjustmentId, source } });
    return existing.id;
  }
  const row = await prisma.ocorrencia.create({ data: { userId, date, month: date.slice(0, 7), kind: 'ESQUECEU_BATIDA', source, detail, pendenciaId: refs.pendenciaId || null, adjustmentId: refs.adjustmentId || null } });
  return row.id;
}

async function upsertPendencia(d: DayDecision, kind: string, title: string, detail: string, suggestion: Suggestion | null, dryRun: boolean, runId: string | null) {
  const key = { userId_date_kind: { userId: d.employeeId, date: d.date, kind } };
  const existing = await prisma.pendencia.findUnique({ where: key });
  if (existing && existing.status !== 'OPEN') return { id: existing.id, created: false };
  const data = { title, detail, suggestionJson: suggestion ? JSON.stringify(suggestion) : null, dryRun, runId };
  if (existing) { await prisma.pendencia.update({ where: { id: existing.id }, data }); return { id: existing.id, created: false }; }
  const row = await prisma.pendencia.create({ data: { userId: d.employeeId, date: d.date, kind, ...data } });
  return { id: row.id, created: true };
}

/** Insere uma batida ajustada (*). Revalida duplicidade/competência no momento da gravação. */
export async function insertAdjustedPunch({ userId, unitId, date, punch, actorId, reason, runId, track = true, learnSource = null }: { userId: string; unitId: string | null; date: string; punch: SuggestionPunch; actorId: string; reason: string; runId?: string | null; track?: boolean; learnSource?: 'GESTOR' | 'SUGESTAO_ACEITA' | null }) {
  const timestamp = new Date(`${date}T${punch.time}:00-03:00`);
  if (Number.isNaN(timestamp.getTime())) throw new Error('Horário inválido.');
  if (await isPeriodClosed(periodFromDate(timestamp))) throw new Error('Competência fechada: reabra o período antes de ajustar.');
  const { from, to } = dayBounds(date);
  const sameDayRaw = await prisma.punch.findMany({ where: { userId, status: 'VALID', timestamp: { gte: from, lte: to } }, select: { id: true, type: true, timestamp: true } });
  const sameDay = applyInterpretations(sameDayRaw, await loadInterpretations(sameDayRaw.map((p) => p.id)));
  if (sameDay.some((p) => p.type === punch.type)) throw new Error(`Já existe ${typeLabel(punch.type)} válida neste dia.`);
  const dup = duplicatePunchReason(sameDay, { type: punch.type, timestamp });
  if (dup) throw new Error(dup);
  const clientId = `${track ? 'auto' : 'manual'}-${userId}-${date}T${punch.time}-${punch.type}-${Date.now()}`;
  const result = await prisma.$transaction(async (tx) => {
    const created = await tx.punch.create({ data: { id: crypto.randomUUID(), userId, unitId, type: punch.type, timestamp, clientTimestamp: timestamp, status: 'VALID', origin: 'ADJUSTED', locationValid: false, clientId }, select: { id: true, type: true, timestamp: true } });
    await tx.punchAudit.create({ data: { id: crypto.randomUUID(), punchId: created.id, changedById: actorId, field: 'manual_create', oldValue: null, newValue: `${punch.type} ${timestamp.toISOString()}`, reason } });
    const adj = track ? await tx.autoAdjustment.create({ data: { userId, date, punchId: created.id, type: punch.type, time: punch.time, runId: runId || null, reason } }) : null;
    return { punch: created, adjustment: adj };
  });
  await appendAuditEvent({ action: track ? 'AUTO_CLOSE_PUNCH_CREATED' : 'PUNCH_CREATED_MANUAL', actorId, resource: 'Punch', resourceId: result.punch.id, metadata: { userId, date, type: punch.type, time: punch.time, reason, adjustmentId: result.adjustment?.id || null } });
  if (learnSource) {
    await recordLesson({ userId, date, type: punch.type, minutes: toMin(punch.time), kind: 'FILL', source: learnSource, actorId, punchId: result.punch.id });
  }
  return result;
}

export async function runAutoClose({ date, phase, mode, persist, trigger, actorId }: { date: string; phase: Phase; mode: AutoCloseMode; persist: boolean; trigger: 'cron' | 'manual'; actorId?: string | null }) {
  const { decisions, employees } = await evaluateDate(date, phase);
  const summary = summarize(decisions);
  const report = decisions.filter((d) => d.outcome !== 'SKIP').map((d) => ({
    employeeId: d.employeeId, name: d.employeeName, outcome: d.outcome, reason: d.reason, punches: d.punchesText,
    proposal: d.proposal || null, pendencia: d.pendencia ? { kind: d.pendencia.kind, title: d.pendencia.title, suggestion: d.pendencia.suggestion?.text || null } : null,
    forgotten: d.forgotten, checks: d.checks,
  }));
  if (!persist) return { runId: null, date, phase, mode, persisted: false, summary, report, applied: [] as any[], errors: [] as any[] };

  const run = await prisma.autoCloseRun.create({ data: { date, phase, mode, trigger, actorId: actorId || null, summaryJson: JSON.stringify({ summary }) } });
  const system = actorId || (await systemActorId());
  const applied: any[] = []; const errors: any[] = []; const autoResolved: any[] = [];
  // Batidas duplicadas: o sistema decide sozinho (pedido do gestor) — só grava a leitura; a batida original fica intacta.
  const duplicates: any[] = [];
  for (const d of decisions) {
    if (!d.duplicates?.length || !system) continue;
    try { duplicates.push(...(await applyDuplicates(d.employeeId, date, d.duplicates, system)).map((x) => ({ employeeId: d.employeeId, name: d.employeeName, ...x }))); }
    catch (error) { errors.push({ employeeId: d.employeeId, duplicates: (error as Error).message }); }
  }
  for (const d of decisions) {
    try {
      if (d.outcome === 'AUTO' && d.proposal) {
        const emp = employees.find((e) => e.id === d.employeeId)!;
        const sug = d.pendencia?.suggestion || { kind: 'INSERT_PUNCHES' as const, punches: [d.proposal], relabels: d.relabels || [], text: `Sugestão: ${typeLabel(d.proposal.type)} ${d.proposal.time}*.` };
        const title = d.pendencia?.title || `Ajuste sugerido: ${typeLabel(d.proposal.type)} ${d.proposal.time}*`;
        if (mode === 'REAL' && system) {
          try {
            await applyRelabels(d.employeeId, date, d.relabels || [], system, 'AUTO', d.confidence ?? null, `${AUTO_CLOSE_REASON} (leitura do sistema ${Math.round((d.confidence ?? 0) * 100)}%)`);
            const r = await insertAdjustedPunch({ userId: d.employeeId, unitId: emp.unitId, date, punch: d.proposal, actorId: system, reason: `${AUTO_CLOSE_REASON} (sistema)`, runId: run.id });
            await upsertOcorrencia(d.employeeId, date, 'AUTO_AJUSTE', `Esqueceu ${typeLabel(d.proposal.type)} · ajustado ${d.proposal.time}* (${d.punchesText})`, { adjustmentId: r.adjustment!.id });
            applied.push({ employeeId: d.employeeId, name: d.employeeName, type: d.proposal.type, time: d.proposal.time, relabels: d.relabels || [], adjustmentId: r.adjustment!.id });
            continue;
          } catch (error) {
            const p = await upsertPendencia(d, 'AJUSTE_SUGERIDO', `Ajuste não gravado: ${title}`, `${d.punchesText}. Motivo: ${(error as Error).message}`, sug, false, run.id);
            await upsertOcorrencia(d.employeeId, date, 'PENDENCIA', `Esqueceu ${typeLabel(d.proposal.type)} (${d.punchesText})`, { pendenciaId: p.id });
            continue;
          }
        }
        const p = await upsertPendencia(d, 'AJUSTE_SUGERIDO', title, `${d.punchesText}. Falta ${typeLabel(d.proposal.type)}; tudo conferido (fotos, tipos, escala, hábito, abonos, pedidos). Modo teste: nada foi gravado.`, sug, true, run.id);
        await upsertOcorrencia(d.employeeId, date, 'PENDENCIA', `Esqueceu ${typeLabel(d.proposal.type)} (${d.punchesText})`, { pendenciaId: p.id });
      } else if (d.outcome === 'PENDENCIA' && d.pendencia) {
        const p = await upsertPendencia(d, d.pendencia.kind, d.pendencia.title, d.pendencia.detail, d.pendencia.suggestion, mode === 'DRY_RUN', run.id);
        if (d.forgotten) await upsertOcorrencia(d.employeeId, date, 'PENDENCIA', `${d.pendencia.title} (${d.punchesText})`, { pendenciaId: p.id });
      }
    } catch (error) {
      errors.push({ employeeId: d.employeeId, error: (error as Error).message });
    }
  }
  // Pendências abertas deste dia que se resolveram sozinhas (ex.: bateu a saída depois das 17:20, gestor ajustou):
  // fecha a pendência e retira a ocorrência, para não contar esquecimento de quem só ficou até mais tarde.
  const settled = decisions.filter((d) => d.outcome === 'OK' || d.outcome === 'SKIP').map((d) => d.employeeId);
  if (settled.length) {
    const stale = await prisma.pendencia.findMany({ where: { date, status: 'OPEN', userId: { in: settled } }, select: { id: true, userId: true, kind: true } });
    for (const p of stale) {
      const note = decisions.find((d) => d.employeeId === p.userId)?.note;
      await prisma.pendencia.update({ where: { id: p.id }, data: { status: 'RESOLVED', resolution: note || 'Resolvido sozinho: o dia ficou completo depois da verificação', resolvedAt: new Date() } });
      await prisma.ocorrencia.updateMany({ where: { userId: p.userId, date, status: 'ATIVA', source: 'PENDENCIA', pendenciaId: p.id }, data: { status: 'CANCELADA', canceledAt: new Date(), cancelReason: 'Dia ficou completo depois da verificação (não foi esquecimento)' } });
      autoResolved.push({ pendenciaId: p.id, employeeId: p.userId, kind: p.kind });
    }
  }
  // Mesma data: se a leitura nova gerou outro tipo de pendência, a antiga (de leitura de batidas) é substituída.
  for (const d of decisions) {
    const kind = d.outcome === 'AUTO' ? (mode === 'REAL' ? null : 'AJUSTE_SUGERIDO') : d.outcome === 'PENDENCIA' ? d.pendencia?.kind : null;
    if (!kind) continue;
    const others = await prisma.pendencia.findMany({ where: { userId: d.employeeId, date, status: 'OPEN', kind: { in: RECHECK_KINDS.filter((k) => k !== kind) } }, select: { id: true } });
    for (const o of others) await prisma.pendencia.update({ where: { id: o.id }, data: { status: 'RESOLVED', resolution: `Substituída pela leitura inteligente: ${d.pendencia?.title || d.reason}`, resolvedAt: new Date() } });
  }
  // Reconfere pendências abertas de dias anteriores com a leitura atual (fecha as que se resolveram e
  // substitui sugestões antigas, ex.: Retorno 14:00 da regra +60). Nunca grava batida em dias passados.
  // Jornada flexível: troca de dia na semana (seg–dom) fecha/reabre "Fora da escala"/"Sem nenhuma batida".
  let swaps: SwapAction[] = [];
  try { swaps = await reconcileFlexibleWeeks({ date, mode, runId: run.id, evaluate: (d, ids) => evaluateDate(d, 'COMPLETO', ids) }); } catch (error) { errors.push({ swaps: (error as Error).message }); }
  let rechecked: RecheckResult = { checked: 0, resolved: [], replaced: [], updated: 0, errors: [] };
  try { rechecked = await recheckOpenPendencias({ beforeDate: date, mode, runId: run.id }); } catch (error) { errors.push({ recheck: (error as Error).message }); }
  await prisma.autoCloseRun.update({ where: { id: run.id }, data: { summaryJson: JSON.stringify({ summary, applied, errors, report, autoResolved, rechecked, swaps, duplicates }) } });
  await appendAuditEvent({ action: 'AUTO_CLOSE_RUN', actorId: system, resource: 'AutoCloseRun', resourceId: run.id, metadata: { date, phase, mode, trigger, summary, applied: applied.length, errors: errors.length, autoResolved: autoResolved.length, recheckResolved: rechecked.resolved.length, recheckReplaced: rechecked.replaced.length } });
  return { runId: run.id, date, phase, mode, persisted: true, summary, report, applied, errors, autoResolved, rechecked, swaps, duplicates };
}

export async function undoAdjustment(adjustmentId: string, actorId: string, reason: string) {
  const adj = await prisma.autoAdjustment.findUnique({ where: { id: adjustmentId } });
  if (!adj) throw new Error('Ajuste não encontrado.');
  if (adj.status !== 'ACTIVE') throw new Error('Este ajuste já foi desfeito.');
  const punch = await prisma.punch.findUnique({ where: { id: adj.punchId }, select: { id: true, status: true, timestamp: true, type: true } });
  if (!punch) throw new Error('Batida do ajuste não encontrada.');
  if (await isPeriodClosed(periodFromDate(punch.timestamp))) throw new Error('Competência fechada.');
  await prisma.$transaction(async (tx) => {
    if (punch.status !== 'REJECTED') {
      await tx.punch.update({ where: { id: punch.id }, data: { status: 'REJECTED' } });
      await tx.punchAudit.create({ data: { id: crypto.randomUUID(), punchId: punch.id, changedById: actorId, field: 'status', oldValue: punch.status, newValue: 'REJECTED', reason: `Desfazer ajuste automático: ${reason}` } });
    }
    await tx.autoAdjustment.update({ where: { id: adj.id }, data: { status: 'UNDONE', undoneAt: new Date(), undoneById: actorId, undoReason: reason } });
  });
  await appendAuditEvent({ action: 'AUTO_CLOSE_UNDONE', actorId, resource: 'AutoAdjustment', resourceId: adj.id, metadata: { punchId: punch.id, type: punch.type, date: adj.date, userId: adj.userId, reason } });
}

export async function resolvePendencia(id: string, action: 'ACEITAR' | 'IGNORAR' | 'RESOLVIDA', actorId: string, note?: string) {
  const p = await prisma.pendencia.findUnique({ where: { id } });
  if (!p) throw new Error('Pendência não encontrada.');
  if (p.status !== 'OPEN') throw new Error('Esta pendência já foi tratada.');
  let resolution = note || action;
  if (action === 'ACEITAR') {
    const s: Suggestion | null = p.suggestionJson ? JSON.parse(p.suggestionJson) : null;
    if (!s || s.kind === 'TEXT') throw new Error('Esta pendência não tem sugestão automática. Use Ajustar.');
    if (s.kind === 'INSERT_PUNCHES') {
      const emp = await prisma.user.findUnique({ where: { id: p.userId }, select: { unitId: true } });
      const done: string[] = await applyRelabels(p.userId, p.date, s.relabels || [], actorId, 'SUGESTAO_ACEITA', s.confidence ?? null, `${AUTO_CLOSE_REASON} (sugestão aceita pelo gestor)`);
      for (const punch of s.punches) {
        await insertAdjustedPunch({ userId: p.userId, unitId: emp?.unitId || null, date: p.date, punch, actorId, reason: `${AUTO_CLOSE_REASON} (sugestão aceita pelo gestor)`, learnSource: 'SUGESTAO_ACEITA' });
        done.push(`${typeLabel(punch.type)} ${punch.time}*`);
      }
      resolution = `Aceito: ${done.join(', ')}`;
    } else if (s.kind === 'DIA_EXTRA') {
      const noon = new Date(`${p.date}T12:00:00.000Z`);
      const clash = await prisma.medicalCertificate.findFirst({ where: { userId: p.userId, status: { not: 'CANCELADO' }, startDate: { lte: noon }, endDate: { gte: noon } } });
      if (clash) throw new Error('Já existe um lançamento neste dia. Use Ajustar.');
      const cert = await prisma.medicalCertificate.create({ data: { userId: p.userId, createdById: actorId, type: 'DIA_EXTRA', startDate: noon, endDate: noon, daysCount: 1, observation: 'Dia extra (pendência da verificação 17:20)', status: 'ATIVO' } });
      await appendAuditEvent({ action: 'CERTIFICATE_CREATED', actorId, resource: 'MedicalCertificate', resourceId: cert.id, metadata: { type: 'DIA_EXTRA', userId: p.userId, date: p.date, via: 'pendencia' } });
      resolution = 'Aceito: lançado como Dia extra';
    } else if (s.kind === 'LAUNCH_REQUEST') {
      const r = await prisma.employeeRequest.findUnique({ where: { id: s.requestId } });
      if (!r || r.status !== 'APROVADO') throw new Error('O pedido precisa estar aprovado em Solicitações.');
      if (!r.launchedAt) await prisma.employeeRequest.update({ where: { id: r.id }, data: { launchedAt: new Date(), launchedById: actorId } });
      await appendAuditEvent({ action: 'SOLICITACAO_LANCADA_NA_FOLHA', actorId, resource: 'EmployeeRequest', resourceId: r.id, metadata: { via: 'pendencia' } });
      resolution = 'Aceito: pedido lançado na folha';
    }
  }
  const status = action === 'IGNORAR' ? 'IGNORED' : 'RESOLVED';
  await prisma.pendencia.update({ where: { id }, data: { status, resolution, resolvedAt: new Date(), resolvedById: actorId } });
  await appendAuditEvent({ action: `PENDENCIA_${status}`, actorId, resource: 'Pendencia', resourceId: id, metadata: { userId: p.userId, date: p.date, kind: p.kind, resolution } });
  return { status, resolution };
}

/** Aplica a leitura do sistema (tipo efetivo) nas batidas originais. Confere que o dia não mudou desde a sugestão. */
export async function applyRelabels(userId: string, date: string, relabels: SuggestionRelabel[], actorId: string, source: 'AUTO' | 'SUGESTAO_ACEITA' | 'GESTOR', confidence: number | null, reason: string) {
  if (!relabels.length) return [] as string[];
  const ids = relabels.map((r) => r.punchId);
  const rows = await prisma.punch.findMany({ where: { id: { in: ids }, userId, status: 'VALID' }, select: { id: true, type: true, timestamp: true, origin: true, clientId: true } });
  const eff = applyInterpretations(rows, await loadInterpretations(ids));
  for (const r of relabels) {
    const p = eff.find((x) => x.id === r.punchId);
    if (!p || dateKeyOf(p.timestamp) !== date) throw new Error(`A batida das ${r.time} não está mais válida neste dia. Reabra o Dia do colaborador.`);
    if (p.type !== r.from && p.type !== r.to) throw new Error(`A batida das ${r.time} mudou de tipo desde a sugestão. Reabra o Dia do colaborador.`);
  }
  if (await isPeriodClosed(periodFromDate(new Date(`${date}T12:00:00-03:00`)))) throw new Error('Competência fechada: reabra o período antes de ajustar.');
  const done: string[] = [];
  for (const r of relabels) {
    const res = await setInterpretation({ punchId: r.punchId, type: r.to, source, actorId, reason, confidence });
    if (res.changed) done.push(`${r.time} → ${typeLabel(r.to)}`);
  }
  if (done.length) await appendAuditEvent({ action: 'PUNCH_INTERPRETATION_SET', actorId, resource: 'Punch', resourceId: ids.join(','), metadata: { userId, date, source, confidence, relabels } });
  return done;
}

export const RECHECK_KINDS = ['AJUSTE_SUGERIDO', 'POUCAS_BATIDAS', 'TIPO_ERRADO', 'SEM_FOTO', 'DUVIDA', 'HORARIO_SUSPEITO'];

export type RecheckResult = { checked: number; resolved: { pendenciaId: string; userId: string; date: string; kind: string; title: string }[]; replaced: { pendenciaId: string; userId: string; date: string; oldTitle: string; newKind: string; newTitle: string; newId: string }[]; updated: number; errors: { date: string; error: string }[] };

/** Reconfere pendências OPEN (até 45 dias) de datas anteriores a `beforeDate` com a leitura atual. */
export async function recheckOpenPendencias({ beforeDate, mode, runId, dryRunOnly = false, onlyUserIds }: { beforeDate: string; mode: AutoCloseMode; runId: string | null; dryRunOnly?: boolean; onlyUserIds?: string[] }): Promise<RecheckResult> {
  const since = new Date(new Date(`${beforeDate}T12:00:00Z`).getTime() - 45 * 86_400_000).toISOString().slice(0, 10);
  // Só pendências de leitura de batidas; pedidos do app, abonos, faltas e fora da escala ficam com o gestor.
  const open = await prisma.pendencia.findMany({ where: { status: 'OPEN', kind: { in: RECHECK_KINDS }, date: { gte: since, lt: beforeDate }, ...(onlyUserIds ? { userId: { in: onlyUserIds } } : {}) }, select: { id: true, userId: true, date: true, kind: true, title: true, suggestionJson: true } });
  const out: RecheckResult = { checked: 0, resolved: [], replaced: [], updated: 0, errors: [] };
  const byDate = new Map<string, typeof open>();
  for (const p of open) byDate.set(p.date, [...(byDate.get(p.date) || []), p]);
  for (const [date, list] of [...byDate.entries()].sort()) {
    try {
      const { decisions } = await evaluateDate(date, 'COMPLETO', [...new Set(list.map((p) => p.userId))]);
      for (const p of list) {
        out.checked += 1;
        const d = decisions.find((x) => x.employeeId === p.userId);
        if (!d) continue; // colaborador inativo: deixa como está
        if (!dryRunOnly && d.duplicates?.length) { const sys = await systemActorId(); if (sys) await applyDuplicates(d.employeeId, date, d.duplicates, sys); }
        if (d.outcome === 'OK' || d.outcome === 'SKIP') {
          const resolution = `Resolvido sozinho na reconferência: ${d.reason}`;
          out.resolved.push({ pendenciaId: p.id, userId: p.userId, date, kind: p.kind, title: p.title });
          if (dryRunOnly) continue;
          await prisma.pendencia.update({ where: { id: p.id }, data: { status: 'RESOLVED', resolution, resolvedAt: new Date() } });
          await prisma.ocorrencia.updateMany({ where: { userId: p.userId, date, status: 'ATIVA', source: 'PENDENCIA', pendenciaId: p.id }, data: { status: 'CANCELADA', canceledAt: new Date(), cancelReason: 'Reconferência: o dia já estava completo (não há batida a lançar)' } });
          continue;
        }
        const next = d.outcome === 'AUTO' && d.pendencia ? { ...d.pendencia, kind: 'AJUSTE_SUGERIDO' } : d.pendencia;
        if (!next) continue;
        const detail = d.outcome === 'AUTO' ? `${d.punchesText}. Reconferência com a leitura inteligente (escala + hábito). Nada foi gravado.` : next.detail;
        const nextJson = next.suggestion ? JSON.stringify(next.suggestion) : null;
        if (next.kind === p.kind) {
          if (p.title === next.title && p.suggestionJson === nextJson) continue;
          out.updated += 1;
          if (p.title !== next.title) out.replaced.push({ pendenciaId: p.id, userId: p.userId, date, oldTitle: p.title, newKind: next.kind, newTitle: next.title, newId: p.id });
          if (dryRunOnly) continue;
          await prisma.pendencia.update({ where: { id: p.id }, data: { title: next.title, detail, suggestionJson: nextJson, dryRun: mode === 'DRY_RUN', runId } });
          continue;
        }
        if (dryRunOnly) { out.replaced.push({ pendenciaId: p.id, userId: p.userId, date, oldTitle: p.title, newKind: next.kind, newTitle: next.title, newId: '(nova)' }); continue; }
        const clash = await prisma.pendencia.findUnique({ where: { userId_date_kind: { userId: p.userId, date, kind: next.kind } }, select: { status: true } });
        if (clash && clash.status !== 'OPEN') {
          // já existe uma pendência desse tipo tratada pelo gestor: atualiza a aberta no lugar (não esconde nada)
          await prisma.pendencia.update({ where: { id: p.id }, data: { title: next.title, detail, suggestionJson: nextJson, dryRun: mode === 'DRY_RUN', runId } });
          out.replaced.push({ pendenciaId: p.id, userId: p.userId, date, oldTitle: p.title, newKind: p.kind, newTitle: next.title, newId: p.id });
          continue;
        }
        const created = await upsertPendencia(d, next.kind, next.title, detail, next.suggestion, mode === 'DRY_RUN', runId);
        await prisma.pendencia.update({ where: { id: p.id }, data: { status: 'RESOLVED', resolution: `Substituída pela leitura inteligente: ${next.title}`, resolvedAt: new Date() } });
        await prisma.ocorrencia.updateMany({ where: { userId: p.userId, date, status: 'ATIVA', source: 'PENDENCIA', pendenciaId: p.id }, data: { pendenciaId: created.id } });
        out.replaced.push({ pendenciaId: p.id, userId: p.userId, date, oldTitle: p.title, newKind: next.kind, newTitle: next.title, newId: created.id });
      }
    } catch (error) {
      out.errors.push({ date, error: (error as Error).message });
    }
  }
  return out;
}

/**
 * Grava a decisão sobre batidas duplicadas em PunchInterpretation: a descartada vira 'DESCONSIDERADA'
 * (sai do cálculo de horas; o painel e a folha mostram a marca) e a mantida, se preciso, ganha o tipo do horário.
 * Nunca altera nem apaga a batida original (Portaria 671). Correção do gestor sempre prevalece.
 */
export async function applyDuplicates(userId: string, date: string, findings: DupFinding[], actorId: string) {
  if (await isPeriodClosed(periodFromDate(new Date(`${date}T12:00:00-03:00`)))) return [];
  const done: { discardId: string; keepId: string; reason: string }[] = [];
  for (const f of findings) {
    const ids = [f.discardId, f.keepId];
    const rows = await prisma.punch.findMany({ where: { id: { in: ids }, userId, status: 'VALID' }, select: { id: true, type: true, timestamp: true, origin: true, clientId: true } });
    if (rows.length !== 2 || rows.some((r) => !isOriginalPunch(r) || dateKeyOf(r.timestamp) !== date)) continue;
    const interp = await loadInterpretations(ids);
    if (ids.some((id) => ['GESTOR', 'SUGESTAO_ACEITA'].includes(String(interp.get(id)?.source || '')))) continue;
    const a = await setInterpretation({ punchId: f.discardId, type: DISREGARDED, source: 'AUTO', actorId, reason: `${f.reason} — desconsiderada (duplicada)`, confidence: null });
    if (f.keepAs) await setInterpretation({ punchId: f.keepId, type: f.keepAs, source: 'AUTO', actorId, reason: f.reason, confidence: null });
    if (a.changed) done.push({ discardId: f.discardId, keepId: f.keepId, reason: f.reason });
  }
  if (done.length) await appendAuditEvent({ action: 'PUNCH_DUPLICATE_DISREGARDED', actorId, resource: 'Punch', resourceId: done.map((d) => d.discardId).join(','), metadata: { userId, date, findings: done } });
  return done;
}
