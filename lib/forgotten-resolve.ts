import { autoDescription, autoDescriptionPrefix } from './inconsistency-detector';

export const CONFIRM_TYPE = 'CONFIRMAR_HORARIO';
export type ConfirmDetails = { punches: Array<{ type: string; time: string }>; issueKey?: string | null; message?: string | null; correction?: Array<{ type: string; time: string }> | null; correctionNote?: string | null };

export function parseConfirmDetails(details: string | null | undefined): ConfirmDetails | null {
  if (!details) return null;
  try { const v = JSON.parse(details); return v && Array.isArray(v.punches) ? v : null; } catch { return null; }
}

/** Marca a inconsistência automática (chave do detector) como resolvida, dentro da transação. */
export async function resolveAutoKey(tx: any, key: string, reason: string, managerId: string) {
  const existing = await tx.inconsistency.findFirst({ where: { OR: [{ description: { startsWith: autoDescriptionPrefix(key) } }, { description: { startsWith: `AUTO_KEY:${key}|` } }] }, select: { id: true } });
  const data = { status: 'RESOLVED', resolvedAt: new Date(), resolvedBy: managerId, description: autoDescription(key, reason) };
  if (existing) return tx.inconsistency.update({ where: { id: existing.id }, data });
  const [userId, , ...rest] = key.split('|');
  return tx.inconsistency.create({ data: { id: crypto.randomUUID(), userId, type: rest.join('|') || 'REVIEW', ...data } });
}
