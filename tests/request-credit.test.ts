import { describe, expect, it } from 'vitest';
import { requestCreditMinutes, isPartialRequest } from '../lib/request-credit';
import { getOperationalAbono, isNationalHoliday } from '../lib/operational-abonos';

describe('crédito de solicitação aprovada (B8)', () => {
  it('dia inteiro credita a jornada', () => {
    expect(requestCreditMinutes({ type: 'AUSENCIA', classification: 'DIA_INTEIRO', details: 'Tipo: Dia inteiro' }, 480, null)).toBe(480);
  });
  it('parcial com horário credita só a janela', () => {
    // Mércia 02/10: 09:00–10:30, trabalhou 6h30
    expect(requestCreditMinutes({ type: 'AUSENCIA', classification: 'PARCIAL_MANHA', details: 'Tipo: Parcial manhã · Horário: 09:00–10:30' }, 480, 390, 480, 1020)).toBe(90);
  });
  it('parcial sem horário só completa o que faltou', () => {
    expect(requestCreditMinutes({ type: 'AUSENCIA', classification: 'PARCIAL_MANHA', details: 'Tipo: Parcial manhã' }, 480, 300)).toBe(180);
    expect(requestCreditMinutes({ type: 'AUSENCIA', classification: 'PARCIAL_TARDE' }, 480, 480)).toBe(0);
  });
  it('emergência sem retorno é dia inteiro; com horário é parcial', () => {
    expect(isPartialRequest({ type: 'AUSENCIA', classification: 'EMERGENCIA', returnExpected: false })).toBe(false);
    expect(isPartialRequest({ type: 'AUSENCIA', classification: 'EMERGENCIA', details: 'Horário: 08:00–13:00' })).toBe(true);
  });
});

describe('feriados nacionais 2026 (B4)', () => {
  it('12/10 é feriado e abona o dia', () => {
    expect(isNationalHoliday('2026-10-12')).toBe(true);
    expect(getOperationalAbono('1234', '2026-10-12')?.kind).toBe('FULL_DAY');
    expect(isNationalHoliday('2026-11-20')).toBe(true);
    expect(isNationalHoliday('2026-10-13')).toBe(false);
  });
});
