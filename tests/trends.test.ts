import { describe, expect, it } from 'vitest';
import { computeTrends, overtimeCost, workedMinutes } from '../lib/trends';
import { setHolidayOverrides } from '../lib/holidays';

const at = (d: string, t: string) => new Date(`${d}T${t}:00-03:00`);
const emp = { id: 'u1', name: 'Ana', employeeNumber: '1', workDays: 'SEG,TER,QUA,QUI,SEX', scheduleStart: '08:00', scheduleEnd: '17:00' };
const day = (d: string, times: [string, string, string, string]) => ['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA'].map((type, i) => ({ userId: 'u1', type, timestamp: at(d, times[i]) }));

describe('tendências (atraso, extras, custo)', () => {
  setHolidayOverrides(null);
  it('soma pares de entrada e saída', () => {
    expect(workedMinutes(day('2026-10-20', ['08:00', '12:00', '13:00', '17:00']))).toBe(480);
    expect(workedMinutes(day('2026-10-20', ['08:00', '12:00', '13:00', '17:00']).slice(0, 3))).toBeNull();
  });

  it('conta atraso acima da tolerância e extra acima de 10 min', () => {
    const punches = [
      ...day('2026-10-19', ['08:30', '12:00', '13:00', '17:00']), // atraso 30, sem extra
      ...day('2026-10-20', ['08:05', '12:00', '13:00', '17:08']), // tolerância
      ...day('2026-10-21', ['08:00', '12:00', '13:00', '18:30']), // +90 extra 50%
    ];
    const [r] = computeTrends({ employees: [emp], punches, from: '2026-10-01', to: '2026-10-31' });
    expect(r).toMatchObject({ lateDays: 1, lateMinutes: 30, overtime50Minutes: 90, overtime100Minutes: 0, workedDays: 3 });
  });

  it('feriado e domingo contam 100%, ignora marcação cancelada', () => {
    const punches = [
      ...day('2026-11-02', ['08:00', '12:00', '13:00', '15:00']), // Finados: 360 min a 100%
      { userId: 'u1', type: 'ENTRADA', timestamp: at('2026-10-20', '07:00'), status: 'REJECTED' },
    ];
    const [r] = computeTrends({ employees: [emp], punches, from: '2026-10-01', to: '2026-11-30' });
    expect(r.overtime100Minutes).toBe(360);
    expect(r.lateDays).toBe(0);
    expect(overtimeCost({ overtime50Minutes: 60, overtime100Minutes: 60 }, 20)).toBe(70);
    expect(overtimeCost({ overtime50Minutes: 60, overtime100Minutes: 0 }, 0)).toBe(0);
  });
});
