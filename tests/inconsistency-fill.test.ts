import { describe, expect, it } from 'vitest';
import { classifyDay, proposeFill, toMinutes } from '../lib/inconsistency-fill';

const S = { start: '08:00', end: '17:00', mode: 'FULL' as const };
const p = (type: string, t: string) => ({ type, minutes: toMinutes(t)! });
const lunchOf = (f: ReturnType<typeof proposeFill>) => { const a = f.find((x) => x.type === 'INTERVALO')!; const b = f.find((x) => x.type === 'RETORNO')!; return b.minutes - a.minutes; };

describe('preenchimento de inconsistências', () => {
  it('sem almoço: insere intervalo de exatamente 60 min centralizado e arredondado a 5', () => {
    const f = proposeFill([p('ENTRADA', '08:03'), p('SAIDA', '17:07')], S);
    expect(f.map((x) => `${x.type} ${x.time}`)).toEqual(['INTERVALO 12:05', 'RETORNO 13:05']);
    expect(lunchOf(f)).toBe(60);
    expect(classifyDay([p('ENTRADA', '08:03'), p('SAIDA', '17:07')], S)).toEqual(['SEM_INTERVALO']);
  });
  it('usa o intervalo da escala quando cabe dentro da jornada', () => {
    const f = proposeFill([p('ENTRADA', '08:00'), p('SAIDA', '17:00')], { ...S, intervalStart: '11:30' });
    expect(f.map((x) => x.time)).toEqual(['11:30', '12:30']);
  });
  it('ignora intervalo da escala fora da jornada e centraliza', () => {
    const f = proposeFill([p('ENTRADA', '13:00'), p('SAIDA', '19:00')], { ...S, intervalStart: '11:30' });
    expect(f.map((x) => x.time)).toEqual(['15:30', '16:30']);
    expect(lunchOf(f)).toBe(60);
  });
  it('limites: jornada curta demais não recebe intervalo', () => {
    expect(proposeFill([p('ENTRADA', '08:00'), p('SAIDA', '09:00')], S)).toEqual([]);
    expect(proposeFill([p('ENTRADA', '08:00'), p('SAIDA', '09:05')], S)).toEqual([]); // não cabe em múltiplos de 5
    const f = proposeFill([p('ENTRADA', '08:00'), p('SAIDA', '09:10')], S);
    expect(f.map((x) => x.time)).toEqual(['08:05', '09:05']); expect(lunchOf(f)).toBe(60);
  });
  it('duração configurável (45 min) é respeitada', () => {
    expect(lunchOf(proposeFill([p('ENTRADA', '08:00'), p('SAIDA', '17:00')], S, { lunchMinutes: 45 }))).toBe(45);
  });
  it('saída faltando: usa saída da escala e depois o intervalo', () => {
    const day = [p('ENTRADA', '08:00')];
    expect(classifyDay(day, S)).toEqual(['SAIDA_FALTANDO', 'SEM_INTERVALO', 'MARCACOES_IMPARES']);
    expect(proposeFill(day, S).map((x) => `${x.type} ${x.time}`)).toEqual(['INTERVALO 12:00', 'RETORNO 13:00', 'SAIDA 17:00']);
  });
  it('marcações ímpares com intervalo aberto: completa o retorno com 60 min', () => {
    const day = [p('ENTRADA', '08:00'), p('INTERVALO', '12:10'), p('SAIDA', '17:00')];
    expect(classifyDay(day, S)).toEqual(['INTERVALO_INCOMPLETO', 'MARCACOES_IMPARES']);
    expect(proposeFill(day, S).map((x) => `${x.type} ${x.time}`)).toEqual(['RETORNO 13:10']);
  });
  it('só retorno: completa o intervalo antes', () => {
    expect(proposeFill([p('ENTRADA', '08:00'), p('RETORNO', '13:30'), p('SAIDA', '17:00')], S).map((x) => x.time)).toEqual(['12:30']);
  });
  it('saída da escala antes da última batida não é inserida', () => {
    expect(proposeFill([p('ENTRADA', '08:00'), p('INTERVALO', '12:00'), p('RETORNO', '13:00'), p('SAIDA', '18:00'), p('ENTRADA', '18:30')], S).find((x) => x.type === 'SAIDA')).toBeUndefined();
  });
  it('dia sem marcação não é preenchido; intervalo curto e jornada longa são apontados', () => {
    expect(proposeFill([], S)).toEqual([]);
    expect(classifyDay([p('ENTRADA', '07:00'), p('INTERVALO', '12:00'), p('RETORNO', '12:30'), p('SAIDA', '19:00')], S)).toEqual(['INTERVALO_CURTO', 'JORNADA_EXCEDIDA']);
  });
  it('meio expediente não exige intervalo', () => {
    expect(classifyDay([p('ENTRADA', '12:00'), p('SAIDA', '16:00')], { start: '12:00', end: '16:00', mode: 'HALF' })).toEqual([]);
  });
});
describe('tolerância do intervalo', () => {
  it('59 min não gera alerta; 54 min gera', () => {
    expect(classifyDay([p('ENTRADA', '08:00'), p('INTERVALO', '12:01'), p('RETORNO', '13:00'), p('SAIDA', '17:00')], S)).toEqual([]);
    expect(classifyDay([p('ENTRADA', '08:00'), p('INTERVALO', '12:06'), p('RETORNO', '13:00'), p('SAIDA', '17:00')], S)).toEqual(['INTERVALO_CURTO']);
  });
});
