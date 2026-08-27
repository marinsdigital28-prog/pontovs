import { describe, expect, it } from 'vitest';
import { resolveDaySchedule } from '../lib/day-schedule';

describe('jornada por dia da semana', () => {
  const eduardo = JSON.stringify({ SEG: { start: '08:00', end: '17:00', mode: 'FULL' }, TER: { start: '08:00', end: '17:00', mode: 'FULL' }, QUA: { start: '12:00', end: '16:00', mode: 'HALF' }, QUI: { start: '08:00', end: '17:00', mode: 'FULL' }, SEX: { start: '08:00', end: '17:00', mode: 'FULL' } });
  const gilvan = JSON.stringify({ TER: { start: '08:00', end: '17:00', mode: 'FULL' }, QUA: { start: '08:00', end: '17:00', mode: 'FULL' }, QUI: { start: '12:00', end: '16:00', mode: 'HALF' } });
  it('retorna Eduardo integral nos dias comuns e meio expediente na quarta', () => {
    expect(resolveDaySchedule(eduardo, 'SEG,TER,QUA,QUI,SEX', '08:00', '17:00', 3)).toMatchObject({ start: '12:00', end: '16:00', mode: 'HALF' });
    expect(resolveDaySchedule(eduardo, 'SEG,TER,QUA,QUI,SEX', '08:00', '17:00', 1)).toMatchObject({ start: '08:00', end: '17:00', mode: 'FULL' });
  });
  it('retorna Gilvan integral terça/quarta e meio expediente quinta', () => {
    expect(resolveDaySchedule(gilvan, 'TER,QUA,QUI', '08:00', '17:00', 4)).toMatchObject({ start: '12:00', end: '16:00', mode: 'HALF' });
    expect(resolveDaySchedule(gilvan, 'TER,QUA,QUI', '08:00', '17:00', 2)).toMatchObject({ start: '08:00', end: '17:00', mode: 'FULL' });
  });
});
