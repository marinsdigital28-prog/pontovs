import { describe, expect, it } from 'vitest';
import { INFERRED_SCHEDULES } from '../lib/inferred-schedules';

describe('padrões de jornada inferidos do CSV mensal', () => {
  it('contém um padrão válido para as 33 matrículas do lote', () => {
    expect(Object.keys(INFERRED_SCHEDULES)).toHaveLength(33);
    for (const schedule of Object.values(INFERRED_SCHEDULES)) {
      expect(schedule.workDays.split(',').every((day) => ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'].includes(day))).toBe(true);
      expect(schedule.scheduleStart).toMatch(/^\d{2}:\d{2}$/);
      expect(schedule.scheduleEnd).toMatch(/^\d{2}:\d{2}$/);
      expect(schedule.scheduleStart < schedule.scheduleEnd).toBe(true);
    }
  });

  it('separa meio expediente de jornada integral', () => {
    const halfDay = ['1705', '2409', '3107', '5050'];
    expect(halfDay.every((number) => INFERRED_SCHEDULES[number].regime === 'MEIO_EXPEDIENTE')).toBe(true);
    expect(Object.values(INFERRED_SCHEDULES).filter((schedule) => schedule.regime === 'MEIO_EXPEDIENTE')).toHaveLength(4);
  });
});
