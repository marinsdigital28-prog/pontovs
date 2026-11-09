/**
 * Parte com banco da verificação 17:20: carrega o dia, grava pendências/ocorrências/ajustes e auditoria.
 * Nunca altera batida original: só INSERE batidas ajustadas (*) e cancela (soft) as que ela mesma criou.
 */
import prisma from './prisma';
import { appendAuditEvent } from './security-controls';
import { isPeriodClosed, periodFromDate } from './period-closure';
import { duplicatePunchReason, label as typeLabel } from './day-guards';
import { AUTO_CLOSE_REASON, endsAfterCutoff, evaluateDay, scheduleFor, summarize, type DayDecision, type Phase, type Suggestion, type SuggestionPunch } from './auto-close';

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
    select: { id: true, name: true, employeeNumber: true, workDays: true, scheduleStart: true, scheduleEnd: true, scheduleByDay: true, unitId: true },
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
  return { employees, punches: punches.map((p) => ({ ...p, hasPhoto: photos.has(p.id) })), certificates, requests, undone };
}

export async function evaluateDate(date: string, phase: Phase, userIds?: string[]) {
  const data = await loadDay(date, userIds);
  const decisions: DayDecision[] = [];
  for (const e of data.employees) {
    const { schedule } = scheduleFor(e, date);
    if (phase === 'MANHA' && !endsAfterCutoff(schedule)) continue;
    decisions.push(evaluateDay({
      employee: e, date, phase,
      punches: data.punches.filter((p) => p.userId === e.id),
      certificates: data.certificates.filter((c) => c.userId === e.id),
      requests: data.requests.filter((r) => r.employeeId === e.id),
      undoneTypes: data.undone.filter((u) => u.userId === e.id).map((u) => u.type),
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

async function upsertPendencia(d: DayDecision, kind: string, title: string, detail: string, suggestion: Suggestion | null, dryRun: boolean, runId: string) {
  const key = { userId_date_kind: { userId: d.employeeId, date: d.date, kind } };
  const existing = await prisma.pendencia.findUnique({ where: key });
  if (existing && existing.status !== 'OPEN') return { id: existing.id, created: false };
  const data = { title, detail, suggestionJson: suggestion ? JSON.stringify(suggestion) : null, dryRun, runId };
  if (existing) { await prisma.pendencia.update({ where: { id: existing.id }, data }); return { id: existing.id, created: false }; }
  const row = await prisma.pendencia.create({ data: { userId: d.employeeId, date: d.date, kind, ...data } });
  return { id: row.id, created: true };
}

/** Insere uma batida ajustada (*). Revalida duplicidade/competência no momento da gravação. */
export async function insertAdjustedPunch({ userId, unitId, date, punch, actorId, reason, runId, track = true }: { userId: string; unitId: string | null; date: string; punch: SuggestionPunch; actorId: string; reason: string; runId?: string | null; track?: boolean }) {
  const timestamp = new Date(`${date}T${punch.time}:00-03:00`);
  if (Number.isNaN(timestamp.getTime())) throw new Error('Horário inválido.');
  if (await isPeriodClosed(periodFromDate(timestamp))) throw new Error('Competência fechada: reabra o período antes de ajustar.');
  const { from, to } = dayBounds(date);
  const sameDay = await prisma.punch.findMany({ where: { userId, status: 'VALID', timestamp: { gte: from, lte: to } }, select: { id: true, type: true, timestamp: true } });
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
  const applied: any[] = []; const errors: any[] = [];
  for (const d of decisions) {
    try {
      if (d.outcome === 'AUTO' && d.proposal) {
        const emp = employees.find((e) => e.id === d.employeeId)!;
        if (mode === 'REAL' && system) {
          try {
            const r = await insertAdjustedPunch({ userId: d.employeeId, unitId: emp.unitId, date, punch: d.proposal, actorId: system, reason: `${AUTO_CLOSE_REASON} (sistema)`, runId: run.id });
            await upsertOcorrencia(d.employeeId, date, 'AUTO_AJUSTE', `Esqueceu ${typeLabel(d.proposal.type)} · ajustado ${d.proposal.time}* (${d.punchesText})`, { adjustmentId: r.adjustment!.id });
            applied.push({ employeeId: d.employeeId, name: d.employeeName, type: d.proposal.type, time: d.proposal.time, adjustmentId: r.adjustment!.id });
            continue;
          } catch (error) {
            const p = await upsertPendencia(d, 'AJUSTE_SUGERIDO', `Ajuste não gravado: ${typeLabel(d.proposal.type)} ${d.proposal.time}*`, `${d.punchesText}. Motivo: ${(error as Error).message}`, { kind: 'INSERT_PUNCHES', punches: [d.proposal], text: `Sugestão: ${typeLabel(d.proposal.type)} ${d.proposal.time}*.` }, false, run.id);
            await upsertOcorrencia(d.employeeId, date, 'PENDENCIA', `Esqueceu ${typeLabel(d.proposal.type)} (${d.punchesText})`, { pendenciaId: p.id });
            continue;
          }
        }
        const p = await upsertPendencia(d, 'AJUSTE_SUGERIDO', `Ajuste sugerido: ${typeLabel(d.proposal.type)} ${d.proposal.time}*`, `${d.punchesText}. Falta ${typeLabel(d.proposal.type)}; tudo conferido (fotos, tipos, escala, abonos, pedidos). Modo teste: nada foi gravado.`, { kind: 'INSERT_PUNCHES', punches: [d.proposal], text: `Sugestão: ${typeLabel(d.proposal.type)} ${d.proposal.time}* (horário da escala${['INTERVALO', 'RETORNO'].includes(d.proposal.type) ? ', almoço redondo' : ''}).` }, true, run.id);
        await upsertOcorrencia(d.employeeId, date, 'PENDENCIA', `Esqueceu ${typeLabel(d.proposal.type)} (${d.punchesText})`, { pendenciaId: p.id });
      } else if (d.outcome === 'PENDENCIA' && d.pendencia) {
        const p = await upsertPendencia(d, d.pendencia.kind, d.pendencia.title, d.pendencia.detail, d.pendencia.suggestion, mode === 'DRY_RUN', run.id);
        if (d.forgotten) await upsertOcorrencia(d.employeeId, date, 'PENDENCIA', `${d.pendencia.title} (${d.punchesText})`, { pendenciaId: p.id });
      }
    } catch (error) {
      errors.push({ employeeId: d.employeeId, error: (error as Error).message });
    }
  }
  await prisma.autoCloseRun.update({ where: { id: run.id }, data: { summaryJson: JSON.stringify({ summary, applied, errors, report }) } });
  await appendAuditEvent({ action: 'AUTO_CLOSE_RUN', actorId: system, resource: 'AutoCloseRun', resourceId: run.id, metadata: { date, phase, mode, trigger, summary, applied: applied.length, errors: errors.length } });
  return { runId: run.id, date, phase, mode, persisted: true, summary, report, applied, errors };
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
      const done: string[] = [];
      for (const punch of s.punches) {
        await insertAdjustedPunch({ userId: p.userId, unitId: emp?.unitId || null, date: p.date, punch, actorId, reason: `${AUTO_CLOSE_REASON} (sugestão aceita pelo gestor)` });
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
