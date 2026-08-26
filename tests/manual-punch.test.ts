import { describe, expect, it } from 'vitest';
import { manualClientId, manualPunchTypes, parseManualTimestamp } from '../lib/manual-punch';

describe('lançamento manual de ponto', () => {
  it('aceita data e horário no fuso do Espaço Progredir', () => {
    const timestamp = parseManualTimestamp('2026-08-26', '08:15');
    expect(timestamp).not.toBeNull();
    expect(timestamp?.toISOString()).toBe('2026-08-26T11:15:00.000Z');
  });

  it('recusa formato inválido e tipos fora da jornada', () => {
    expect(parseManualTimestamp('26/08/2026', '08:15')).toBeNull();
    expect(parseManualTimestamp('2026-08-26', '8:15')).toBeNull();
    expect(manualPunchTypes).toEqual(['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA']);
  });

  it('gera a mesma chave para impedir duplicidade do mesmo lançamento', () => {
    expect(manualClientId('employee-1', '2026-08-26', '08:15', 'entrada')).toBe('manual-employee-1-2026-08-26T08:15-ENTRADA');
  });
});
