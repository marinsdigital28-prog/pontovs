import { describe, expect, it } from 'vitest';
import { findDuplicatePunches } from '../lib/punch-duplicates';
import { evaluateDay } from '../lib/auto-close';
import { workedMinutes } from '../lib/timesheet-rows';

const m = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
// Referências (escala/padrão): Robson 07:30 · almoço 10:30–11:30 · 16:30
const robson = { ENTRADA: m('07:30'), INTERVALO: m('10:30'), RETORNO: m('11:30'), SAIDA: m('16:30') };
const P = (list: string[], eligible = true) => list.map((x, i) => { const [t, type] = x.split(' '); return { id: `p${i}`, min: m(t), type, eligible }; });

describe('batidas duplicadas em intervalo curto (dados reais out–nov)', () => {
  it('Robson 25/11: Entrada 07:01 + Intervalo 07:22 → uma é desconsiderada', () => {
    const f = findDuplicatePunches(P(['07:01 ENTRADA', '07:22 INTERVALO']), robson);
    expect(f).toHaveLength(1);
    expect(f[0].slot).toBe('ENTRADA');
    // fica a mais próxima do horário de Entrada (07:30): 07:22, lida como Entrada; 07:01 desconsiderada
    expect(f[0].discardId).toBe('p0');
    expect(f[0].keepAs).toBe('ENTRADA');
  });
  it('com padrão de Entrada 07:00, fica a 07:01 e o Intervalo 07:22 é desconsiderado', () => {
    const f = findDuplicatePunches(P(['07:01 ENTRADA', '07:22 INTERVALO']), { ...robson, ENTRADA: m('07:00') });
    expect(f[0]).toMatchObject({ discardId: 'p1', keepId: 'p0', keepAs: null });
  });
  it('mesmo tipo duas vezes em ≤ 30 min → duplicada', () => {
    expect(findDuplicatePunches(P(['07:28 ENTRADA', '07:31 ENTRADA', '10:30 INTERVALO']), robson)[0]).toMatchObject({ discardId: 'p0', keepId: 'p1' });
  });
  it('intervalos curtos legítimos NÃO são eliminados (sequência completa)', () => {
    const jose = { ENTRADA: m('07:00'), INTERVALO: m('12:00'), RETORNO: m('13:00'), SAIDA: m('16:00') };
    expect(findDuplicatePunches(P(['06:50 ENTRADA', '13:06 INTERVALO', '13:09 RETORNO', '16:15 SAIDA']), jose)).toEqual([]); // almoço de 3 min
    expect(findDuplicatePunches(P(['07:08 ENTRADA', '13:13 INTERVALO', '13:26 RETORNO', '16:07 SAIDA']), jose)).toEqual([]);
    const mercia = { ENTRADA: m('11:30'), INTERVALO: m('12:00'), RETORNO: m('13:00'), SAIDA: m('17:00') };
    expect(findDuplicatePunches(P(['11:44 ENTRADA', '12:06 INTERVALO', '12:29 RETORNO', '17:05 SAIDA']), mercia)).toEqual([]);
  });
  it('Retorno → Saída em 29 min (meio período) não é duplicada', () => {
    const renata = { ENTRADA: m('08:00'), INTERVALO: m('12:00'), RETORNO: m('13:00'), SAIDA: m('13:30') };
    expect(findDuplicatePunches(P(['07:57 ENTRADA', '11:59 INTERVALO', '13:01 RETORNO', '13:30 SAIDA']), renata)).toEqual([]);
    expect(findDuplicatePunches(P(['07:57 ENTRADA', '13:01 RETORNO', '13:30 SAIDA']), renata)).toEqual([]);
  });
  it('lançamento do gestor (*) ou tipo corrigido pelo gestor nunca é mexido', () => {
    expect(findDuplicatePunches(P(['07:01 ENTRADA', '07:22 INTERVALO'], false), robson)).toEqual([]);
  });

  it('17:20: dia do Robson fica sem a duplicada e o almoço 10:30–11:30 entra normal', () => {
    const at = (hm: string, type: string, id: string) => ({ id, type, timestamp: new Date(`2026-11-25T${hm}:00-03:00`), status: 'VALID', origin: 'ONLINE', hasPhoto: true, clientId: null });
    const emp = { id: 'r', name: 'Robson', employeeNumber: '2201', workDays: 'SEG,TER,QUA,QUI,SEX', scheduleStart: '07:30', scheduleEnd: '16:30', scheduleByDay: JSON.stringify(Object.fromEntries(['SEG', 'TER', 'QUA', 'QUI', 'SEX'].map((d) => [d, { start: '07:30', end: '16:30', mode: 'FULL', lunchStart: '10:30', lunchEnd: '11:30' }]))), profileJson: null };
    const d = evaluateDay({ employee: emp as any, date: '2026-11-25', punches: [at('07:01', 'ENTRADA', 'a'), at('07:22', 'INTERVALO', 'b'), at('10:31', 'INTERVALO', 'c'), at('11:30', 'RETORNO', 'd'), at('16:31', 'SAIDA', 'e')] as any });
    expect(d.duplicates?.map((x) => x.discardId)).toEqual(['a']);
    expect(d.outcome).toBe('OK');
  });
  it('folha: desconsiderada não entra nas horas', () => {
    const t = (hm: string, type: string) => ({ type, timestamp: new Date(`2026-11-25T${hm}:00-03:00`) });
    const sem = workedMinutes([t('07:22', 'ENTRADA'), t('10:31', 'INTERVALO'), t('11:30', 'RETORNO'), t('16:31', 'SAIDA')]);
    expect(sem).toBe(189 + 301);
  });
});
