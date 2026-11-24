/**
 * Leitura do sistema (PunchInterpretation): qual tipo uma batida ORIGINAL representa.
 * Portaria 671: a batida original (tipo, horário, foto) nunca é alterada. Correções de tipo ficam aqui,
 * com autor, origem e motivo, e as telas/folha usam o "tipo efetivo".
 */
import prisma from './prisma';

export type InterpretationSource = 'GESTOR' | 'SUGESTAO_ACEITA' | 'AUTO' | 'MIGRACAO';
export type Interp = { type: string; source: string; confidence: number | null; reason: string | null; actorId: string | null; updatedAt: Date };

/** Batida original do totem/app (não é lançamento manual * nem ajuste automático). */
export function isOriginalPunch(p: { origin?: string | null; clientId?: string | null }) {
  const cid = String(p.clientId || '');
  if (/^(manual|auto)-/.test(cid)) return false;
  return p.origin === 'WEB' || p.origin === 'OFFLINE' || p.origin === 'ONLINE';
}

export async function loadInterpretations(punchIds: string[]): Promise<Map<string, Interp>> {
  const map = new Map<string, Interp>();
  if (!punchIds.length) return map;
  try {
    for (let i = 0; i < punchIds.length; i += 5000) {
      const rows = await prisma.punchInterpretation.findMany({ where: { punchId: { in: punchIds.slice(i, i + 5000) } }, select: { punchId: true, type: true, source: true, confidence: true, reason: true, actorId: true, updatedAt: true } });
      for (const r of rows) map.set(r.punchId, r);
    }
  } catch (error) {
    // Tabela ainda não criada (deploy antes da migração): segue com os tipos originais.
    console.error('[punch-interpretation] leitura indisponível:', (error as Error).message);
  }
  return map;
}

/** Aplica o tipo efetivo (leitura do sistema) mantendo o original em `originalType`. */
export function applyInterpretations<T extends { id: string; type: string }>(punches: T[], map: Map<string, Interp>) {
  return punches.map((p) => {
    const it = map.get(p.id);
    return it && it.type !== p.type
      ? { ...p, type: it.type, originalType: p.type, interpretation: { type: it.type, source: it.source, confidence: it.confidence, reason: it.reason } }
      : { ...p, originalType: p.type, interpretation: it ? { type: it.type, source: it.source, confidence: it.confidence, reason: it.reason } : null };
  });
}

export async function withEffectiveTypes<T extends { id: string; type: string }>(punches: T[]) {
  return applyInterpretations(punches, await loadInterpretations(punches.map((p) => p.id)));
}

/**
 * Grava/atualiza a leitura de uma batida original. Não toca na tabela Punch.
 * Se o tipo pedido for o próprio tipo original, remove a leitura (volta ao original).
 */
export async function setInterpretation(input: { punchId: string; type: string; source: InterpretationSource; actorId: string; reason: string; confidence?: number | null }) {
  const punch = await prisma.punch.findUnique({ where: { id: input.punchId }, select: { id: true, type: true } });
  if (!punch) throw new Error('Batida não encontrada.');
  const current = await prisma.punchInterpretation.findUnique({ where: { punchId: punch.id } });
  const oldType = current?.type || punch.type;
  if (oldType === input.type) return { changed: false, oldType, newType: input.type };
  await prisma.$transaction(async (tx) => {
    if (input.type === punch.type) {
      if (current) await tx.punchInterpretation.delete({ where: { punchId: punch.id } });
    } else if (current) {
      await tx.punchInterpretation.update({ where: { punchId: punch.id }, data: { type: input.type, source: input.source, confidence: input.confidence ?? null, reason: input.reason, actorId: input.actorId } });
    } else {
      await tx.punchInterpretation.create({ data: { punchId: punch.id, type: input.type, source: input.source, confidence: input.confidence ?? null, reason: input.reason, actorId: input.actorId } });
    }
    await tx.punchAudit.create({ data: { id: crypto.randomUUID(), punchId: punch.id, changedById: input.actorId, field: 'interpretation', oldValue: oldType, newValue: input.type, reason: `${input.reason} [${input.source}] (batida original preservada)` } });
  });
  return { changed: true, oldType, newType: input.type };
}
