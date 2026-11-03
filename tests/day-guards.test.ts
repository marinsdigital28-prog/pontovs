import { describe, expect, it } from 'vitest';
import { duplicatePunchReason, preserveSeconds, roundLunchTime, sequenceWarnings } from '../lib/day-guards';

describe('day guards', () => {
  it('blocks duplicate punches within 2 minutes and a second exit', () => {
    const day = [{ id: 'a', type: 'SAIDA', timestamp: '2026-10-09T13:45:49-03:00' }];
    expect(duplicatePunchReason(day, { type: 'INTERVALO', timestamp: '2026-10-09T13:46:30-03:00' })).toMatch(/2 minutos/);
    expect(duplicatePunchReason(day, { type: 'SAIDA', timestamp: '2026-10-09T17:00:00-03:00' })).toMatch(/Saída/);
    expect(duplicatePunchReason(day, { type: 'RETORNO', timestamp: '2026-10-09T15:00:00-03:00' })).toBeNull();
  });
  it('warns on wrong sequence', () => {
    expect(sequenceWarnings([{ type: 'ENTRADA', timestamp: '2026-10-09T07:32:14-03:00' }, { type: 'INTERVALO', timestamp: '2026-10-09T13:45:50-03:00' }]).join(' ')).toMatch(/Falta Saída/);
    expect(sequenceWarnings([{ type: 'SAIDA', timestamp: '2026-10-09T08:00:00-03:00' }, { type: 'INTERVALO', timestamp: '2026-10-09T12:00:00-03:00' }]).join(' ')).toMatch(/fora de ordem/);
  });
  it('keeps seconds when minute is unchanged', () => {
    const orig = new Date('2026-10-09T13:45:50-03:00');
    expect(preserveSeconds(orig, new Date('2026-10-09T13:45:00-03:00')).getTime()).toBe(orig.getTime());
    expect(preserveSeconds(orig, new Date('2026-10-09T14:00:00-03:00')).getTime()).not.toBe(orig.getTime());
  });
  it('rounds lunch times', () => {
    expect(roundLunchTime('12:07')).toBe('12:00');
    expect(roundLunchTime('12:48')).toBe('13:00');
  });
});
