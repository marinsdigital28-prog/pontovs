/** Regras puras para mover eventos no calendário de ausências (sem acesso a banco). */

export type MovableSource = 'SOLICITAÇÃO' | 'ATESTADO' | 'FERIADO';
export const RESCHEDULABLE_REQUEST_TYPES = ['AUSENCIA', 'PASSEIO', 'EVENTO_EXTERNO'];

export function dateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function fromKey(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function daysBetween(a: Date, b: Date) {
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86_400_000);
}
/** Novo período mantendo a duração (em dias) do evento original. */
export function shiftRange(start: Date, end: Date, newStart: Date) {
  const len = Math.max(0, daysBetween(start, end));
  const s = new Date(newStart.getFullYear(), newStart.getMonth(), newStart.getDate());
  return { start: s, end: new Date(s.getFullYear(), s.getMonth(), s.getDate() + len) };
}
/** Competências (AAAA-MM) tocadas por um período. */
export function periodsTouched(start: Date, end: Date) {
  const out: string[] = [];
  const c = new Date(start.getFullYear(), start.getMonth(), 1);
  while (c <= end) { out.push(`${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}`); c.setMonth(c.getMonth() + 1); }
  return out;
}

export type MoveCheckInput = { source: MovableSource; type?: string; status: string; start: Date; end: Date };

/** Motivo pelo qual o evento NÃO pode ser movido (ou null se pode). */
export function moveBlockReason(item: MoveCheckInput, closedPeriods: string[] = []) {
  if (item.source === 'FERIADO') return 'Feriados são fixos e não podem ser movidos.';
  if (item.source === 'ATESTADO') return 'Atestados/consultas seguem as datas do documento e não podem ser arrastados. Cancele e lance novamente se a data estiver errada.';
  if (item.type && !RESCHEDULABLE_REQUEST_TYPES.includes(item.type)) return 'Este tipo de solicitação não pode ser reagendado.';
  if (['CANCELADO', 'REJEITADO'].includes(item.status)) return 'Registros cancelados ou rejeitados não podem ser movidos.';
  const closed = periodsTouched(item.start, item.end).find((p) => closedPeriods.includes(p));
  if (closed) return `A competência ${closed.split('-').reverse().join('/')} está fechada/assinada.`;
  return null;
}

/** Motivo pelo qual o destino é inválido (ou null). */
export function dropBlockReason(item: MoveCheckInput, newStart: Date, closedPeriods: string[] = []) {
  const base = moveBlockReason(item, closedPeriods);
  if (base) return base;
  const next = shiftRange(item.start, item.end, newStart);
  if (daysBetween(item.start, next.start) === 0) return 'O evento já está nesta data.';
  const closed = periodsTouched(next.start, next.end).find((p) => closedPeriods.includes(p));
  if (closed) return `Não é possível mover para ${closed.split('-').reverse().join('/')}: competência fechada/assinada.`;
  return null;
}
