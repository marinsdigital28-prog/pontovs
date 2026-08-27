import { describe, expect, it } from 'vitest';
import { OFFICIAL_SCHEDULES, isOfficialSchedule, normalizeToOfficialSchedule } from '../lib/official-schedules';
import { inferSchedulesFromPunches } from '../lib/schedule-inference';

describe('catálogo oficial de escalas', () => {
  it('aceita somente os quatro horários definidos pela administração', () => {
    expect(OFFICIAL_SCHEDULES.map(({ scheduleStart, scheduleEnd }) => `${scheduleStart}-${scheduleEnd}`)).toEqual([
      '07:00-16:00', '07:30-16:30', '08:00-17:00', '12:00-16:00',
    ]);
    expect(OFFICIAL_SCHEDULES[3].lunchMinutes).toBe(0);
  });

  it('normaliza padrões quebrados para o horário oficial mais próximo', () => {
    expect(normalizeToOfficialSchedule('07:58', '17:01')).toMatchObject({ scheduleStart: '08:00', scheduleEnd: '17:00', lunchMinutes: 60 });
    expect(normalizeToOfficialSchedule('07:28', '16:32')).toMatchObject({ scheduleStart: '07:30', scheduleEnd: '16:30', lunchMinutes: 60 });
    expect(normalizeToOfficialSchedule('11:57', '16:04')).toMatchObject({ scheduleStart: '12:00', scheduleEnd: '16:00', lunchMinutes: 0 });
  });

  it('faz a inferência retornar horários oficiais, nunca horários quebrados', () => {
    const result = inferSchedulesFromPunches([
      { userId: 'employee-1', type: 'ENTRADA', timestamp: new Date('2026-08-24T11:58:00Z') },
      { userId: 'employee-1', type: 'SAIDA', timestamp: new Date('2026-08-24T20:02:00Z') },
    ]);
    const schedule = result.get('employee-1');
    expect(schedule).toMatchObject({ scheduleStart: '08:00', scheduleEnd: '17:00' });
    expect(isOfficialSchedule(schedule?.scheduleStart ?? null, schedule?.scheduleEnd ?? null)).toBe(true);
  });
});
