import { describe, expect, it } from 'vitest';
import { analyzeAttendance, dayCodeForDate, localDateKey, localMinutes } from '../lib/attendance-analytics';

describe('análise de presença e pontualidade', () => {
  it('reconhece a escala em JSON e calcula entradas no horário e atrasos', () => {
    const employees = [
      { id: 'a', workDays: '["SEG","TER"]', scheduleStart: '08:00' },
      { id: 'b', workDays: 'SEX', scheduleStart: '08:00' },
    ];
    const punches = [
      { userId: 'a', type: 'ENTRADA', timestamp: new Date('2026-08-24T11:00:00.000Z') },
      { userId: 'a', type: 'ENTRADA', timestamp: new Date('2026-08-25T11:15:00.000Z') },
      { userId: 'b', type: 'ENTRADA', timestamp: new Date('2026-08-28T11:50:00.000Z') },
    ];
    const result = analyzeAttendance(employees, punches, '2026-08-24', '2026-08-28');
    expect(result.summary).toMatchObject({ scheduledDays: 3, presentDays: 3, absentDays: 0, punctualArrivals: 1, punctualityEvaluated: 3, lateArrivals: 2, attendanceRate: 100, punctualityRate: 33.3, averageDelayMinutes: 33 });
    expect(result.daily.find((day) => day.date === '2026-08-25')).toMatchObject({ day: 'TER', scheduled: 1, present: 1, punctual: 0, late: 1 });
  });

  it('separa falta de folga em dias da mesma janela', () => {
    const result = analyzeAttendance([{ id: 'a', workDays: 'SEG,TER', scheduleStart: '08:00' }], [{ userId: 'a', type: 'ENTRADA', timestamp: new Date('2026-08-24T11:00:00.000Z') }], '2026-08-24', '2026-08-26');
    expect(result.daily).toEqual([
      expect.objectContaining({ date: '2026-08-24', scheduled: 1, present: 1, absent: 0, off: 0 }),
      expect.objectContaining({ date: '2026-08-25', scheduled: 1, present: 0, absent: 1, off: 0 }),
      expect.objectContaining({ date: '2026-08-26', scheduled: 0, present: 0, absent: 0, off: 1 }),
    ]);
  });

  it('converte datas e horários para o fuso do sistema', () => {
    const date = new Date('2026-08-24T11:15:00.000Z');
    expect(localDateKey(date)).toBe('2026-08-24');
    expect(localMinutes(date)).toBe(495);
    expect(dayCodeForDate('2026-08-24')).toBe('SEG');
  });
});
