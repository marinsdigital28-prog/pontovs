import { describe, expect, it } from 'vitest';
import { buildTimesheetRows } from '../lib/timesheet-rows';

const emp = { name: 'Vice', employeeNumber: '0506', workDays: 'TER,QUI,SEX', scheduleStart: '07:30', scheduleEnd: '16:30', scheduleByDay: null };
const at = (d: string, hm: string, type: string) => ({ type, timestamp: new Date(`${d}T${hm}:00-03:00`), origin: 'ONLINE' });
const day = (d: string) => [at(d, '07:21', 'ENTRADA'), at(d, '12:15', 'INTERVALO'), at(d, '13:27', 'RETORNO'), at(d, '16:30', 'SAIDA')];
const punches = [...day('2026-11-23'), ...day('2026-11-26'), ...day('2026-11-27')];

describe('folha: troca de dia (jornada flexível)', () => {
  const before = buildTimesheetRows({ employee: emp, punches, month: '2026-11', today: '2026-11-30' });
  const after = buildTimesheetRows({ employee: { ...emp, profileJson: JSON.stringify({ jornadaFlexivel: true }) }, punches, month: '2026-11', today: '2026-11-30' });
  const row = (r: typeof after, d: string) => r.rows.find((x) => x.date === d)!;
  it('23/11 com selo "Troca de dia" e 24/11 trocado, sem falta', () => {
    expect(row(after, '2026-11-23')).toMatchObject({ situation: 'Troca de dia', tone: 'ok', swap: { role: 'EXTRA', text: 'veio no lugar de ter 24/11' } });
    expect(row(after, '2026-11-24')).toMatchObject({ situation: 'Troca de dia', tone: 'ok', swap: { role: 'MISSED', text: 'trocado por seg 23/11' } });
    expect(row(before, '2026-11-24').situation).toBe('Falta');
    expect(after.totals.absences).toBe(before.totals.absences - 1);
  });
  it('horas, previsto, falta(h) e saldo exatamente iguais', () => {
    const { absences: _a, ...tb } = before.totals; const { absences: _b, ...ta } = after.totals;
    expect(ta).toEqual(tb);
    for (const r of after.rows) {
      const b = row(before, r.date);
      expect([r.worked, r.credited, r.expected, r.missing, r.balance, r.justified]).toEqual([b.worked, b.credited, b.expected, b.missing, b.balance, b.justified]);
    }
  });
  it('quem não tem jornada flexível: folha igual', () => {
    expect(before.rows.some((r) => r.swap)).toBe(false);
  });
});
