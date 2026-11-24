import { describe, expect, it } from 'vitest';
import { brazilWeekday, hasScheduleByDay, legacyScheduleConflicts, scheduleForDateKey, scheduleSummary } from '../lib/day-schedule';
import { evaluateDay } from '../lib/auto-close';

const HALF = (s: string, e: string) => ({ start: s, end: e, mode: 'HALF' });
// Edilson (1705): legado 12:00–16:00, escala por dia SEG–SEX 07:30–11:30
const edilson = { id: 'e', name: 'Edilson', employeeNumber: '1705', workDays: 'SEG,TER,QUA,QUI,SEX', scheduleStart: '12:00', scheduleEnd: '16:00', scheduleByDay: JSON.stringify({ SEG: HALF('07:30', '11:30'), TER: HALF('07:30', '11:30'), QUA: HALF('07:30', '11:30'), QUI: HALF('07:30', '11:30'), SEX: HALF('07:30', '11:30') }) };
// Jorge (0028): workDays legado SEG,QUA,SEX mas escala por dia tem TER/QUI
const jorge = { id: 'j', name: 'Jorge', employeeNumber: '0028', workDays: 'SEG,QUA,SEX', scheduleStart: '08:00', scheduleEnd: '17:00', scheduleByDay: JSON.stringify({ SEG: { start: '08:00', end: '17:00', mode: 'FULL' }, TER: { start: '08:00', end: '17:00', mode: 'FULL' }, QUA: HALF('12:00', '16:00'), QUI: { start: '08:00', end: '17:00', mode: 'FULL' }, SEX: { start: '08:00', end: '17:00', mode: 'FULL' } }) };

describe('scheduleByDay é a fonte da verdade', () => {
  it('resumo da jornada usa a escala por dia, não o legado', () => {
    expect(scheduleSummary(edilson)).toBe('SEG–SEX 07:30–11:30');
    // Jorge: scheduleByDay tem TER/QUI, mas workDays (e 2 meses de batidas) dizem SEG/QUA/SEX → não inventa dias de trabalho
    expect(scheduleSummary(jorge)).toBe('SEG/SEX 08:00–17:00 · QUA 12:00–16:00');
    expect(scheduleSummary({ workDays: 'SEG,TER,QUA,QUI,SEX', scheduleStart: '08:00', scheduleEnd: '17:00' })).toBe('SEG–SEX 08:00–17:00');
  });
  it('escala do dia (Edilson segunda) = 07:30–11:30', () => {
    expect(scheduleForDateKey(edilson, '2026-11-23')).toEqual({ start: '07:30', end: '11:30', mode: 'HALF' });
  });
  it('lista contradições do legado sem mudar dados', () => {
    expect(legacyScheduleConflicts(edilson)[0]).toContain('escala 07:30–11:30 × legado 12:00–16:00');
    expect(legacyScheduleConflicts(jorge).some((c) => c.startsWith('dias:'))).toBe(true);
    expect(hasScheduleByDay(jorge)).toBe(true);
  });
  it('verificação 17:20: Edilson 07:31/11:32 é dia completo (escala 07:30–11:30, não 12:00–16:00); terça do Jorge não vira falta', () => {
    const p = (type: string, hm: string, date: string) => ({ id: `${type}${hm}`, type, timestamp: new Date(`${date}T${hm}:00-03:00`), status: 'VALID', origin: 'WEB', hasPhoto: true, clientId: 'x' });
    expect(evaluateDay({ employee: edilson, date: '2026-11-23', punches: [p('ENTRADA', '07:31', '2026-11-23'), p('SAIDA', '11:32', '2026-11-23')] }).outcome).toBe('OK');
    const tue = evaluateDay({ employee: jorge, date: '2026-11-24', punches: [p('ENTRADA', '08:00', '2026-11-24'), p('INTERVALO', '12:00', '2026-11-24'), p('RETORNO', '13:00', '2026-11-24'), p('SAIDA', '17:00', '2026-11-24')] });
    expect(tue.scheduled).toBe(false);
    expect(evaluateDay({ employee: jorge, date: '2026-11-24', punches: [] }).outcome).toBe('SKIP');
  });
  it('dia da semana em Brasília (Worker roda em UTC): 23:30 de domingo em SP ainda é domingo', () => {
    expect(brazilWeekday(new Date('2026-11-23T02:30:00Z'))).toBe(0);
    expect(brazilWeekday(new Date('2026-11-23T03:30:00Z'))).toBe(1);
  });
});
