/**
 * Proteções "erro zero" do Dia do colaborador.
 * Puras (sem banco) para poderem ser testadas e usadas no servidor e no painel.
 */
export type GuardPunch = { id?: string; type: string; timestamp: Date | string };

const ORDER = ['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA'];
const ms = (v: Date | string) => new Date(v).getTime();

/** Batida duplicada: mesmo tipo a menos de 2 min, ou segunda SAÍDA no dia. */
export function duplicatePunchReason(existing: GuardPunch[], next: GuardPunch): string | null {
  const t = ms(next.timestamp);
  const others = existing.filter((p) => p.id !== next.id);
  const near = others.find((p) => Math.abs(ms(p.timestamp) - t) < 2 * 60_000);
  if (near) return `Já existe uma batida (${near.type}) a menos de 2 minutos deste horário.`;
  if (next.type === 'SAIDA' && others.some((p) => p.type === 'SAIDA')) return 'Já existe uma Saída neste dia. Cancele a outra antes ou mude o tipo.';
  if (next.type === 'ENTRADA' && others.some((p) => p.type === 'ENTRADA')) return 'Já existe uma Entrada neste dia.';
  return null;
}

/** Avisa quando a sequência Entrada → Intervalo → Retorno → Saída fica fora de ordem ou com buraco. */
export function sequenceWarnings(punches: GuardPunch[]): string[] {
  const sorted = [...punches].sort((a, b) => ms(a.timestamp) - ms(b.timestamp));
  const out: string[] = [];
  let last = -1;
  for (const p of sorted) {
    const idx = ORDER.indexOf(p.type);
    if (idx >= 0 && idx < last) out.push(`${label(p.type)} depois de ${label(ORDER[last])} — sequência fora de ordem.`);
    last = Math.max(last, idx);
  }
  const types = sorted.map((p) => p.type);
  if (types.includes('INTERVALO') && !types.includes('RETORNO') && !types.includes('SAIDA')) out.push('Falta Saída (ou Retorno) depois do Intervalo.');
  if (types.includes('RETORNO') && !types.includes('INTERVALO')) out.push('Retorno sem Intervalo.');
  if (sorted.length && !types.includes('ENTRADA')) out.push('Dia sem Entrada.');
  return out;
}

export function label(type: string) {
  return ({ ENTRADA: 'Entrada', INTERVALO: 'Intervalo', RETORNO: 'Retorno', SAIDA: 'Saída' } as Record<string, string>)[type] || type;
}

/** Ao trocar só o tipo (ou o mesmo minuto), mantém os segundos originais. */
export function preserveSeconds(original: Date, next: Date): Date {
  const a = Math.floor(original.getTime() / 60_000);
  const b = Math.floor(next.getTime() / 60_000);
  return a === b ? original : next;
}

/** Intervalo de almoço em horário redondo (múltiplo de 30 min, arredonda para o mais próximo). */
export function roundLunchTime(hhmm: string): string {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return hhmm;
  const total = Math.round((Number(m[1]) * 60 + Number(m[2])) / 30) * 30;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
