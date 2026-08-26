import { describe, expect, it } from 'vitest';
import { isScheduledDay, parseWorkDays } from '../lib/timesheet-schedule';

describe('interpretação da escala na folha de ponto', () => {
  it('aceita texto legado com vírgulas e acentos', () => {
    const days = parseWorkDays('Seg, Terça, Quarta');
    expect(isScheduledDay(days, 'SEG')).toBe(true);
    expect(isScheduledDay(days, 'TER')).toBe(true);
    expect(isScheduledDay(days, 'QUA')).toBe(true);
    expect(isScheduledDay(days, 'QUI')).toBe(false);
  });

  it('aceita a escala armazenada como JSON', () => {
    const days = parseWorkDays('["SEG","QUA","SEX"]');
    expect(isScheduledDay(days, 'SEG')).toBe(true);
    expect(isScheduledDay(days, 'TER')).toBe(false);
    expect(isScheduledDay(days, 'SEX')).toBe(true);
  });

  it('usa segunda a sexta somente quando não há escala cadastrada', () => {
    const days = parseWorkDays(null);
    expect(isScheduledDay(days, 'SEG')).toBe(true);
    expect(isScheduledDay(days, 'SEX')).toBe(true);
    expect(isScheduledDay(days, 'SAB')).toBe(false);
  });
});
