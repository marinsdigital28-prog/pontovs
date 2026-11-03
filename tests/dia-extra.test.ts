import { describe, expect, test } from 'vitest';
import { buildTimesheetRows } from '../lib/timesheet-rows';

const employee = { name: 'Teste', employeeNumber: '9999', cpf: null, jobTitle: null, workDays: 'TER', scheduleStart: '12:00', scheduleEnd: '16:00' } as any;
const punches = [
  { type: 'ENTRADA', timestamp: new Date('2026-10-09T07:32:14-03:00') },
  { type: 'SAIDA', timestamp: new Date('2026-10-09T13:45:50-03:00') },
];
const extra = { type: 'DIA_EXTRA', startDate: new Date('2026-10-09T12:00:00Z'), endDate: new Date('2026-10-09T12:00:00Z'), status: 'ATIVO' };

describe('dia extra fora da escala', () => {
  test('sem exceção: dia de folga', () => {
    const row = buildTimesheetRows({ employee, punches, certificates: [], month: '2026-10', today: '2026-10-31' } as any).rows[8];
    expect(row.schedule).toBe('Folga');
  });
  test('com exceção: batidas reais contam, sem abono, não mostra Folga', () => {
    const { rows } = buildTimesheetRows({ employee, punches, certificates: [extra], month: '2026-10', today: '2026-10-31' } as any);
    const row = rows[8];
    expect(row.schedule).toBe('Dia extra');
    expect(row.situation).toMatch(/^Hora extra · fora da escala \+06:14$/);
    expect(row.justified).toBe(0);
    expect(row.worked).toBeGreaterThan(300);
    expect(row.balance).toBe(row.worked);
    expect(row.worked).toBe(374);
    const t = buildTimesheetRows({ employee, punches, certificates: [extra], month: '2026-10', today: '2026-10-31' } as any).totals;
    const base = buildTimesheetRows({ employee, punches, certificates: [], month: '2026-10', today: '2026-10-31' } as any).totals;
    expect(t.worked).toBe(374); // horas extras somam no total trabalhado
    expect(t.balance).toBe(base.balance); // e no saldo do mês (+374 sobre as faltas do fixture)
    expect(t.balance).toBe(374 - 960);
  });
  test('cancelada: volta a ser folga', () => {
    const row = buildTimesheetRows({ employee, punches, certificates: [{ ...extra, status: 'CANCELADO' }], month: '2026-10', today: '2026-10-31' } as any).rows[8];
    expect(row.schedule).toBe('Folga');
  });
});
