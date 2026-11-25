/**
 * Batidas duplicadas/erradas em intervalo curto (ex.: Robson 25/11: Entrada 07:01 + Intervalo 07:22).
 * O sistema decide sozinho qual vale: fica a batida mais próxima do horário real da pessoa (escala/padrão)
 * e a outra é DESCONSIDERADA. Portaria 671: a batida original nunca é apagada nem alterada — a decisão
 * fica em PunchInterpretation (tipo efetivo 'DESCONSIDERADA') e sai do cálculo de horas, com marca no painel e na folha.
 *
 * "Curto" foi definido nos dados reais de out–nov/2026:
 *  - pares de batidas ORIGINAIS a ≤ 30 min;
 *  - a 2ª não faz sentido como o próximo tipo: ou é o mesmo tipo da 1ª, ou as duas caem no mesmo
 *    horário de referência (ex.: as duas perto da Entrada) e a 2ª fica a > 60 min do horário do próprio tipo;
 *  - nunca mexe num dia com sequência completa Entrada → Intervalo → Retorno → Saída (intervalos curtos
 *    reais, como almoço de 3 min, ficam como estão), em lançamentos do gestor (*) nem em tipos corrigidos pelo gestor.
 */
import { ORDER, type PType } from './punch-classifier';

export const DISREGARDED = 'DESCONSIDERADA';
export const DUP_MAX_GAP_MIN = 30;
export const DUP_OWN_TYPE_TOLERANCE_MIN = 60;

export type DupPunch = { id: string; min: number; type: string; eligible: boolean };
export type DupFinding = {
  discardId: string; discardMin: number; discardType: string;
  keepId: string; keepMin: number; keepType: string;
  /** Tipo efetivo que a batida mantida passa a ter (quando diferente do que foi apertado). */
  keepAs: PType | null;
  slot: PType; gap: number; reason: string;
};

const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;
const LBL: Record<string, string> = { ENTRADA: 'Entrada', INTERVALO: 'Intervalo', RETORNO: 'Retorno', SAIDA: 'Saída' };
const lbl = (t: string) => LBL[t] || t;

export const isDisregarded = (p: { type: string }) => p.type === DISREGARDED;

function slotOf(min: number, a: Record<PType, number>): PType {
  let best: PType = 'ENTRADA';
  for (const t of ORDER) if (Math.abs(min - a[t]) < Math.abs(min - a[best])) best = t;
  return best;
}

export function findDuplicatePunches(punches: DupPunch[], anchors: Record<PType, number>): DupFinding[] {
  const sorted = [...punches].filter((p) => p.type !== DISREGARDED).sort((x, y) => x.min - y.min);
  if (sorted.map((p) => p.type).join(',') === ORDER.join(',')) return [];
  const out: DupFinding[] = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i], b = sorted[i + 1];
    const gap = b.min - a.min;
    if (!a.eligible || !b.eligible || gap > DUP_MAX_GAP_MIN) continue;
    const sa = slotOf(a.min, anchors), sb = slotOf(b.min, anchors);
    const ownB = (ORDER as readonly string[]).includes(b.type) ? Math.abs(b.min - anchors[b.type as PType]) : Infinity;
    const sameType = a.type === b.type;
    const sameSlot = sa === sb && ownB > DUP_OWN_TYPE_TOLERANCE_MIN;
    if (!sameType && !sameSlot) continue;
    const slot: PType = sameType && (ORDER as readonly string[]).includes(a.type) ? (a.type as PType) : sa;
    const ref = anchors[slot];
    const keep = Math.abs(b.min - ref) < Math.abs(a.min - ref) ? b : a;
    const drop = keep === a ? b : a;
    const keepAs = keep.type !== slot ? slot : null;
    out.push({
      discardId: drop.id, discardMin: drop.min, discardType: drop.type,
      keepId: keep.id, keepMin: keep.min, keepType: keep.type, keepAs, slot, gap,
      reason: `Batida duplicada: ${lbl(drop.type)} ${hm(drop.min)} a ${gap} min de ${lbl(keep.type)} ${hm(keep.min)}; vale a mais próxima do horário de ${lbl(slot)} (${hm(ref)})${keepAs ? `, lida como ${lbl(keepAs)}` : ''}`,
    });
    i++;
  }
  return out;
}
