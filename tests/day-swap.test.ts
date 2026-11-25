import { describe, expect, it } from 'vitest';
import { pairWeekSwaps, swapStatusFor, weekOf, type WeekDayStatus } from '../lib/day-swap';
import { evaluateDay } from '../lib/auto-close';

// Cássio: grade TER/QUI/SEX 07:30–16:30, jornada flexível.
const cassio = { id: 'c', name: 'Vice', employeeNumber: '0506', workDays: 'TER,QUI,SEX', scheduleStart: '07:30', scheduleEnd: '16:30', scheduleByDay: null, profileJson: JSON.stringify({ jornadaFlexivel: true }) };
const other = { ...cassio, id: 'o', employeeNumber: '9998', profileJson: null };
const grid = new Set(['TER', 'QUI', 'SEX']);
const WD = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'];
const week = (monday: string, worked: string[], covered: string[] = []): WeekDayStatus[] => weekOf(monday).days.map((d) => ({ date: d, scheduled: grid.has(WD[new Date(`${d}T12:00:00Z`).getUTCDay()]), worked: worked.includes(d), covered: covered.includes(d) }));
const full = (date: string) => ['07:30 ENTRADA', '12:30 INTERVALO', '13:30 RETORNO', '16:30 SAIDA'].map((x, i) => { const [hm, type] = x.split(' '); return { id: `${date}${i}`, type, timestamp: new Date(`${date}T${hm}:00-03:00`), status: 'VALID', origin: 'ONLINE', hasPhoto: true, clientId: null }; });

describe('troca de dia (jornada flexível)', () => {
  it('semana seg–dom em Brasília', () => {
    expect(weekOf('2026-11-25')).toMatchObject({ start: '2026-11-23', end: '2026-11-29' });
    expect(weekOf('2026-11-23').start).toBe('2026-11-23');
    expect(weekOf('2026-11-29').start).toBe('2026-11-23');
  });
  it('veio seg 23/11 e faltou ter 24/11 → troca', () => {
    const w = week('2026-11-23', ['2026-11-23', '2026-11-26', '2026-11-27']);
    const r = pairWeekSwaps(w, '2026-11-30');
    expect(r.swaps).toEqual([{ extra: '2026-11-23', missed: '2026-11-24' }]);
    expect(swapStatusFor('2026-11-23', r)?.note).toBe('Troca de dia: veio seg 23/11 no lugar de ter 24/11');
    expect(swapStatusFor('2026-11-24', r)?.kind).toBe('TROCA');
  });
  it('dia da grade coberto por atestado não precisa de compensação; veio fora → extra informativo', () => {
    const r = pairWeekSwaps(week('2026-11-16', ['2026-11-16', '2026-11-19', '2026-11-20'], ['2026-11-17']), '2026-11-30');
    expect(r.swaps).toEqual([]);
    expect(r.unmatchedExtra).toEqual(['2026-11-16']);
  });
  it('semana em aberto: falta fica "aguardando compensação" até domingo', () => {
    const r = pairWeekSwaps(week('2026-11-23', []), '2026-11-25');
    expect(r.waiting).toEqual(['2026-11-24']);
    expect(swapStatusFor('2026-11-24', r)?.note).toMatch(/Aguardando compensação.*dom 29\/11/);
    const fim = pairWeekSwaps(week('2026-11-23', []), '2026-11-30');
    expect(fim.waiting).toEqual([]);
    expect(fim.unmatchedMissed).toEqual(['2026-11-24', '2026-11-26', '2026-11-27']);
  });

  it('17:20/08:00: dia extra que compensa não vira "Fora da escala"; falta compensada não vira "Sem nenhuma batida"', () => {
    const w = week('2026-11-23', ['2026-11-23', '2026-11-26', '2026-11-27']);
    const seg = evaluateDay({ employee: cassio, date: '2026-11-23', punches: full('2026-11-23') as any, week: w, today: '2026-11-30' });
    expect(seg.outcome).toBe('OK');
    expect(seg.reason).toBe('Dia completo · Troca de dia: veio seg 23/11 no lugar de ter 24/11');
    const ter = evaluateDay({ employee: cassio, date: '2026-11-24', punches: [], week: w, today: '2026-11-30' });
    expect(ter.outcome).toBe('SKIP');
    expect(ter.reason).toMatch(/^Troca de dia/);
  });
  it('falta sem compensar: aguardando durante a semana; pendência depois que a semana acaba', () => {
    const w = week('2026-11-23', ['2026-11-26', '2026-11-27']);
    expect(evaluateDay({ employee: cassio, date: '2026-11-24', punches: [], week: w, today: '2026-11-25' }).outcome).toBe('DEFER');
    expect(evaluateDay({ employee: cassio, date: '2026-11-24', punches: [], week: w, today: '2026-11-24' }).outcome).toBe('DEFER');
    expect(evaluateDay({ employee: cassio, date: '2026-11-24', punches: [], week: w, today: '2026-11-30' }).pendencia?.kind).toBe('SEM_BATIDAS');
  });
  it('veio fora da grade sem faltar: continua "Fora da escala" (dia extra informativo)', () => {
    const w = week('2026-11-23', ['2026-11-23', '2026-11-24', '2026-11-26', '2026-11-27']);
    expect(evaluateDay({ employee: cassio, date: '2026-11-23', punches: full('2026-11-23') as any, week: w, today: '2026-11-30' }).pendencia?.kind).toBe('FORA_ESCALA');
  });
  it('quem não tem jornada flexível: nada muda', () => {
    const w = week('2026-11-23', ['2026-11-23']);
    expect(evaluateDay({ employee: other, date: '2026-11-23', punches: full('2026-11-23') as any, week: w, today: '2026-11-30' }).pendencia?.kind).toBe('FORA_ESCALA');
    expect(evaluateDay({ employee: other, date: '2026-11-24', punches: [], week: w, today: '2026-11-25' }).pendencia?.kind).toBe('SEM_BATIDAS');
  });
});
