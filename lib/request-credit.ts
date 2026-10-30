/**
 * Crédito (minutos) de uma solicitação de AUSÊNCIA aprovada pelo app.
 *
 * Regra:
 *  - "Dia inteiro" (ou emergência sem retorno e sem horário) → jornada prevista integral.
 *  - Parcial (manhã/tarde, ou com "Horário: HH:MM–HH:MM", ou emergência com retorno)
 *    → credita só o período pedido e NUNCA mais do que o que faltou para fechar a jornada
 *      (prevista − trabalhada). Assim um exame de manhã não vira dia inteiro abonado.
 */
export type CreditRequest = {
  type: string;
  classification?: string | null;
  details?: string | null;
  returnExpected?: boolean | null;
};

function clock(value: string): number | null {
  const m = value.match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Janela "Horário: 09:00–10:30" gravada nos detalhes pelo app. */
export function requestWindow(details: string | null | undefined): { start: number; end: number } | null {
  const m = String(details || '').match(/Hor[aá]rio:\s*(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})/i);
  if (!m) return null;
  const start = clock(m[1]); const end = clock(m[2]);
  return start !== null && end !== null && end > start ? { start, end } : null;
}

export function isPartialRequest(r: CreditRequest): boolean {
  const c = String(r.classification || '').toUpperCase();
  if (c === 'PARCIAL_MANHA' || c === 'PARCIAL_TARDE') return true;
  if (/Tipo:\s*Parcial/i.test(r.details || '')) return true;
  if (requestWindow(r.details)) return true;
  if (c === 'EMERGENCIA' && r.returnExpected) return true;
  return false;
}

export function requestCreditMinutes(
  r: CreditRequest,
  expected: number | null,
  worked: number | null,
  dayStart: number | null = null,
  dayEnd: number | null = null,
): number {
  if (r.type !== 'AUSENCIA' || expected === null || expected <= 0) return 0;
  if (!isPartialRequest(r)) return expected;
  const gap = Math.max(0, expected - Math.max(0, worked || 0));
  const win = requestWindow(r.details);
  if (!win) return gap;
  let start = win.start; let end = win.end;
  if (dayStart !== null) start = Math.max(start, dayStart);
  if (dayEnd !== null) end = Math.min(end, dayEnd);
  const windowMinutes = Math.max(0, end - start);
  return Math.min(windowMinutes, gap, expected);
}
