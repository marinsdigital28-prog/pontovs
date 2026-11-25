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
  it('previsto vai para o dia em que veio: trabalhado, previsto e saldo do mês iguais; falta de 8h some', () => {
    expect(after.totals.worked).toBe(before.totals.worked);
    expect(after.totals.expected).toBe(before.totals.expected);
    expect(after.totals.balance).toBe(before.totals.balance);
    expect(after.totals.missing).toBe(before.totals.missing - 8 * 60 + 3);
    expect(row(after, '2026-11-24')).toMatchObject({ expected: 0, missing: 0, balance: 0 });
    expect(row(after, '2026-11-23')).toMatchObject({ expected: 480, credited: 477, missing: 3, balance: -3 });
  });
  it('"Dia extra" lançado pelo gestor também vira troca quando falta dia da grade na semana', () => {
    const p2 = [...day('2026-11-16'), ...day('2026-11-17'), ...day('2026-11-20')];
    const certs = [{ type: 'DIA_EXTRA', startDate: new Date('2026-11-16T00:00:00Z'), endDate: new Date('2026-11-16T00:00:00Z'), status: 'APROVADO' }];
    const b = buildTimesheetRows({ employee: emp, punches: p2, certificates: certs, month: '2026-11', today: '2026-11-30' });
    const a2 = buildTimesheetRows({ employee: { ...emp, profileJson: JSON.stringify({ jornadaFlexivel: true }) }, punches: p2, certificates: certs, month: '2026-11', today: '2026-11-30' });
    expect(a2.rows.find((r) => r.date === '2026-11-16')).toMatchObject({ situation: 'Troca de dia', swap: { role: 'EXTRA', other: '2026-11-19' }, expected: 480, balance: -3 });
    expect(a2.rows.find((r) => r.date === '2026-11-19')).toMatchObject({ situation: 'Troca de dia', expected: 0, balance: 0 });
    expect([a2.totals.worked, a2.totals.expected, a2.totals.balance]).toEqual([b.totals.worked, b.totals.expected, b.totals.balance]);
  });
  it('quem não tem jornada flexível: folha igual', () => {
    expect(before.rows.some((r) => r.swap)).toBe(false);
  });
});
