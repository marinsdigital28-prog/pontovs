import { describe, expect, it } from 'vitest';
import { resolveSmartPunchSuggestion } from '../lib/smart-punch-type';

const at = (hm: string) => new Date(`2026-11-23T${hm}:00-03:00`);
const P = (type: string, hm: string) => ({ type, timestamp: at(hm) });
const ELI = { mode: 'FULL' as const, scheduleStart: '07:00', scheduleEnd: '16:00', habitLunch: { start: 12 * 60, minutes: 60 } };

describe('totem: 1ª batida perto do almoço sem Entrada', () => {
  it('11:59 sem batidas (escala 07:00) → Intervalo + aviso de Entrada faltando', () => {
    const s = resolveSmartPunchSuggestion({ ...ELI, punchesToday: [], now: at('11:59') });
    expect(s.suggestedType).toBe('INTERVALO');
    expect(s.warning).toMatch(/não marcou a Entrada/);
  });
  it('depois do Intervalo, a volta é Retorno (não Entrada) e a última é Saída', () => {
    expect(resolveSmartPunchSuggestion({ ...ELI, punchesToday: [P('INTERVALO', '11:59')], now: at('13:06') }).suggestedType).toBe('RETORNO');
    expect(resolveSmartPunchSuggestion({ ...ELI, punchesToday: [P('INTERVALO', '11:59'), P('RETORNO', '13:06')], now: at('16:05') }).suggestedType).toBe('SAIDA');
  });
  it('chegada normal ou atrasada de manhã continua Entrada, sem aviso', () => {
    for (const hm of ['06:55', '08:10', '10:30']) {
      const s = resolveSmartPunchSuggestion({ ...ELI, punchesToday: [], now: at(hm) });
      expect(s.suggestedType).toBe('ENTRADA');
      expect(s.warning ?? null).toBeNull();
    }
  });
  it('meio expediente que começa 12:00 → Entrada', () => {
    expect(resolveSmartPunchSuggestion({ mode: 'HALF', scheduleStart: '12:00', scheduleEnd: '16:00', punchesToday: [], now: at('11:58') }).suggestedType).toBe('ENTRADA');
  });
  it('usa o hábito: quem almoça 11:30 e bate 11:28 sem Entrada → Intervalo', () => {
    expect(resolveSmartPunchSuggestion({ mode: 'FULL', scheduleStart: '07:30', scheduleEnd: '16:30', habitLunch: { start: 690, minutes: 60 }, punchesToday: [], now: at('11:28') }).suggestedType).toBe('INTERVALO');
  });
  it('fim do expediente sem nenhuma batida → Saída com aviso', () => {
    const s = resolveSmartPunchSuggestion({ mode: 'FULL', scheduleStart: '08:00', scheduleEnd: '17:00', punchesToday: [], now: at('16:50') });
    expect(s.suggestedType).toBe('SAIDA');
    expect(s.warning).toMatch(/Entrada/);
  });
});
