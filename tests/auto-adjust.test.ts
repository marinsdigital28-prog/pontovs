import { describe, it, expect } from 'vitest';
import { buildSuggestions } from '../lib/auto-adjust';

const emp = { id: 'u1', name: 'Ana', employeeNumber: '0803', workDays: 'SEG,TER,QUA,QUI,SEX', scheduleStart: '08:00', scheduleEnd: '17:00', scheduleByDay: null };
const m = (c: string) => Number(c.slice(0, 2)) * 60 + Number(c.slice(3));

describe('ajuste inteligente do fechamento', () => {
  it('só entrada+saída vira "evento externo sem almoço" com horas corretas e sem inclusão automática', () => {
    const s = buildSuggestions([emp], [{ userId: 'u1', date: '2026-10-27', type: 'ENTRADA', minutes: m('08:00') }, { userId: 'u1', date: '2026-10-27', type: 'SAIDA', minutes: m('16:00') }], { untilDate: '2026-10-28' });
    expect(s).toHaveLength(1);
    expect(s[0].kind).toBe('EXTERNO_SEM_ALMOCO');
    expect(s[0].fills).toEqual([]);
    expect(s[0].workedMinutes).toBe(480);
    expect(s[0].lunchAlternative.map((f) => f.type)).toEqual(['INTERVALO', 'RETORNO']);
  });
  it('retorno faltando é completado com almoço de exatamente 1h', () => {
    const d = '2026-10-26';
    const s = buildSuggestions([emp], [['ENTRADA', '08:00'], ['INTERVALO', '12:00'], ['SAIDA', '17:00']].map(([type, t]) => ({ userId: 'u1', date: d, type, minutes: m(t) })), { untilDate: '2026-10-28' });
    expect(s[0].kind).toBe('COMPLETAR');
    expect(s[0].fills).toEqual([expect.objectContaining({ type: 'RETORNO', time: '13:00' })]);
    expect(s[0].workedMinutes).toBe(480);
  });
  it('não sugere nada para hoje/futuro nem para dia completo', () => {
    const full = [['ENTRADA', '08:00'], ['INTERVALO', '12:00'], ['RETORNO', '13:00'], ['SAIDA', '17:00']].map(([type, t]) => ({ userId: 'u1', date: '2026-10-26', type, minutes: m(t) }));
    expect(buildSuggestions([emp], full, { untilDate: '2026-10-28' })).toHaveLength(0);
    expect(buildSuggestions([emp], [{ userId: 'u1', date: '2026-10-28', type: 'ENTRADA', minutes: 480 }], { untilDate: '2026-10-28' })).toHaveLength(0);
  });
});
