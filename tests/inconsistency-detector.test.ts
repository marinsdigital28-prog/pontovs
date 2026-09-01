import { describe, expect, it } from 'vitest';
import { detectInconsistencies } from '../lib/inconsistency-detector';

const employee = {
  id: 'employee-1',
  name: 'Ana Souza',
  employeeNumber: '001',
  jobTitle: 'Auxiliar',
  workDays: 'SEG,TER,QUA,QUI,SEX',
  scheduleStart: '08:00',
  scheduleEnd: '17:00',
  scheduleByDay: null,
};

function punch(id: string, type: string, timestamp: string) {
  return { id, userId: employee.id, type, timestamp: new Date(timestamp), status: 'VALID' };
}

describe('detectInconsistencies', () => {
  it('detects absence on a scheduled weekday', () => {
    const result = detectInconsistencies({ employees: [employee], punches: [], exceptions: [], from: '2026-08-31', to: '2026-08-31' });
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('ABSENCE');
    expect(result[0].missingTypes).toEqual(['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA']);
  });

  it('detects missing punches and late entry', () => {
    const result = detectInconsistencies({
      employees: [employee],
      punches: [punch('p1', 'ENTRADA', '2026-08-31T08:10:00-03:00'), punch('p2', 'SAIDA', '2026-08-31T17:00:00-03:00')],
      exceptions: [],
      from: '2026-08-31',
      to: '2026-08-31',
    });
    expect(result).toHaveLength(1);
    expect(result[0].type).toContain('MISSING_PUNCHES');
    expect(result[0].type).toContain('LATE_ENTRY');
    expect(result[0].missingTypes).toEqual(['INTERVALO', 'RETORNO']);
    expect(result[0].suggestedTimes).toMatchObject({ INTERVALO: '12:00', RETORNO: '13:00' });
  });

  it('ignores rejected punches and dates covered by an approved exception', () => {
    const result = detectInconsistencies({
      employees: [employee],
      punches: [punch('rejected', 'ENTRADA', '2026-08-31T08:00:00-03:00')],
      exceptions: [{ userId: employee.id, startDate: new Date('2026-08-31T12:00:00-03:00'), endDate: new Date('2026-08-31T12:00:00-03:00'), status: 'APROVADO', type: 'AUSENCIA' }],
      from: '2026-08-31',
      to: '2026-08-31',
    });
    expect(result).toEqual([]);
  });

  it('detects a duplicated punch type', () => {
    const result = detectInconsistencies({
      employees: [employee],
      punches: [punch('p1', 'ENTRADA', '2026-08-31T08:00:00-03:00'), punch('p2', 'ENTRADA', '2026-08-31T08:02:00-03:00'), punch('p3', 'INTERVALO', '2026-08-31T12:00:00-03:00'), punch('p4', 'RETORNO', '2026-08-31T13:00:00-03:00'), punch('p5', 'SAIDA', '2026-08-31T17:00:00-03:00')],
      exceptions: [],
      from: '2026-08-31',
      to: '2026-08-31',
    });
    expect(result).toHaveLength(1);
    expect(result[0].duplicateTypes).toEqual(['ENTRADA']);
  });
});
