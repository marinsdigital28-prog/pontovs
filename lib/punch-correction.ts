/**
 * Correções de ponto rastreáveis (Portaria MTP 671/2021):
 * a marcação original NUNCA é sobrescrita. Corrigir = cancelar a original (mantida como REJECTED)
 * + incluir uma nova marcação manual (origin ADJUSTED), ambas com trilha em PunchAudit.
 */
import { manualClientId } from './manual-punch';

export type ExistingPunch = { id: string; userId: string; type: string; timestamp: Date; status: string };
export type CorrectionPlan =
  | { ok: false; error: string; status: number }
  | { ok: true; changes: Array<{ field: string; oldValue: string; newValue: string }>; cancelId: string; create: { userId: string; type: string; timestamp: Date } };

export function planPunchCorrection(existing: ExistingPunch, nextType: string, nextTimestamp: Date): CorrectionPlan {
  if (existing.status === 'REJECTED') return { ok: false, error: 'Uma marcação cancelada não pode ser editada.', status: 409 };
  const changes: Array<{ field: string; oldValue: string; newValue: string }> = [];
  if (nextType !== existing.type) changes.push({ field: 'type', oldValue: existing.type, newValue: nextType });
  if (nextTimestamp.getTime() !== existing.timestamp.getTime()) changes.push({ field: 'timestamp', oldValue: existing.timestamp.toISOString(), newValue: nextTimestamp.toISOString() });
  if (!changes.length) return { ok: false, error: 'Nenhuma alteração foi informada.', status: 400 };
  return { ok: true, changes, cancelId: existing.id, create: { userId: existing.userId, type: nextType, timestamp: nextTimestamp } };
}

/** Partes de data/hora no fuso de Brasília, para montar o clientId estável. */
export function brazilDateTimeParts(timestamp: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(timestamp);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}` };
}

type Tx = any;

/** Inclui uma marcação manual (nova linha) com auditoria. Retorna null se já existir igual. */
export async function createManualInclusion(tx: Tx, input: { userId: string; unitId?: string | null; type: string; timestamp: Date; managerId: string; reason: string; source?: string; replacesPunchId?: string }) {
  const { date, time } = brazilDateTimeParts(input.timestamp);
  const clientId = manualClientId(input.userId, date, time, input.type);
  const duplicate = await tx.punch.findUnique({ where: { clientId }, select: { id: true } });
  if (duplicate) return null;
  const punch = await tx.punch.create({ data: { id: crypto.randomUUID(), userId: input.userId, unitId: input.unitId ?? null, type: input.type, timestamp: input.timestamp, clientTimestamp: input.timestamp, status: 'VALID', origin: 'ADJUSTED', locationValid: false, clientId }, select: { id: true, type: true, timestamp: true, status: true, origin: true } });
  const detail = [input.source ? `fonte=${input.source}` : '', input.replacesPunchId ? `substitui=${input.replacesPunchId}` : ''].filter(Boolean).join(' ');
  await tx.punchAudit.create({ data: { id: crypto.randomUUID(), punchId: punch.id, changedById: input.managerId, field: 'manual_create', oldValue: input.replacesPunchId ?? null, newValue: `${input.type} ${input.timestamp.toISOString()}${detail ? ` (${detail})` : ''}`, reason: input.reason } });
  return punch;
}

/** Aplica um plano de correção: cancela a original (preservada) e inclui a nova. */
export async function applyPunchCorrection(tx: Tx, plan: Extract<CorrectionPlan, { ok: true }>, input: { managerId: string; reason: string; unitId?: string | null }) {
  await tx.punch.update({ where: { id: plan.cancelId }, data: { status: 'REJECTED' } });
  await tx.punchAudit.create({ data: { id: crypto.randomUUID(), punchId: plan.cancelId, changedById: input.managerId, field: 'status', oldValue: 'VALID', newValue: 'REJECTED (substituída por correção)', reason: input.reason } });
  for (const change of plan.changes) await tx.punchAudit.create({ data: { id: crypto.randomUUID(), punchId: plan.cancelId, changedById: input.managerId, field: `correcao_${change.field}`, oldValue: change.oldValue, newValue: change.newValue, reason: input.reason } });
  const created = await createManualInclusion(tx, { ...plan.create, unitId: input.unitId, managerId: input.managerId, reason: input.reason, source: 'correcao', replacesPunchId: plan.cancelId });
  if (!created) throw new Error('DUPLICATE_PUNCH');
  return created;
}
