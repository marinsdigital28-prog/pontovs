import { describe, expect, it } from 'vitest';
import { evaluateDay, fillMissing, normalizePunches, endsAfterCutoff, AUTO_CLOSE_REASON } from '../lib/auto-close';
import { computeWarnings } from '../lib/punch-warnings';

const emp = { id: 'u1', name: 'Fulano Teste', employeeNumber: '9999', workDays: 'SEG,TER,QUA,QUI,SEX', scheduleStart: '08:00', scheduleEnd: '17:00', scheduleByDay: null };
const D = '2026-10-30'; // sexta
let n = 0;
const p = (type: string, hm: string, extra: Partial<{ hasPhoto: boolean; origin: string; clientId: string; date: string }> = {}) =>
  ({ id: `p${++n}`, type, timestamp: new Date(`${extra.date || D}T${hm}:00-03:00`), status: 'VALID', origin: extra.origin || 'ONLINE', hasPhoto: extra.hasPhoto ?? true, clientId: extra.clientId || null });

describe('verificação 17:20', () => {
  it('motivo padrão', () => expect(AUTO_CLOSE_REASON).toBe('Ajuste automático 17:20'));

  it('3 batidas sem saída → AUTO com saída da escala (caso Gilvan)', () => {
    const d = evaluateDay({ employee: emp, date: D, punches: [p('ENTRADA', '07:58'), p('INTERVALO', '12:01'), p('RETORNO', '13:02')] });
    expect(d.outcome).toBe('AUTO');
    expect(d.proposal).toEqual({ type: 'SAIDA', time: '17:00' });
    expect(d.forgotten).toBe(true);
  });

  it('3 batidas sem entrada → AUTO Entrada 08:00 (caso Suelen)', () => {
    const d = evaluateDay({ employee: emp, date: D, punches: [p('INTERVALO', '12:00'), p('RETORNO', '13:00'), p('SAIDA', '17:03')] });
    expect(d.outcome).toBe('AUTO');
    expect(d.proposal).toEqual({ type: 'ENTRADA', time: '08:00' });
  });

  it('volta do almoço faltando → horário redondo', () => {
    const d = evaluateDay({ employee: emp, date: D, punches: [p('ENTRADA', '08:00'), p('INTERVALO', '12:07'), p('SAIDA', '17:00')] });
    expect(d.outcome).toBe('AUTO');
    expect(d.proposal?.type).toBe('RETORNO');
    expect(Number(d.proposal!.time.slice(3)) % 30).toBe(0);
  });

  it('só 2 batidas → pendência, nunca ajusta sozinho (caso Gabriela)', () => {
    const d = evaluateDay({ employee: emp, date: D, punches: [p('ENTRADA', '08:00'), p('INTERVALO', '12:00')] });
    expect(d.outcome).toBe('PENDENCIA');
    expect(d.proposal).toBeUndefined();
    expect(d.forgotten).toBe(true);
  });

  it('batida sem foto → pendência', () => {
    const d = evaluateDay({ employee: emp, date: D, punches: [p('ENTRADA', '08:00', { hasPhoto: false }), p('INTERVALO', '12:00'), p('RETORNO', '13:00')] });
    expect(d.outcome).toBe('PENDENCIA');
  });

  it('dia completo → OK; sem batida e sem escala (sábado) → SKIP', () => {
    expect(evaluateDay({ employee: emp, date: D, punches: [p('ENTRADA', '08:00'), p('INTERVALO', '12:00'), p('RETORNO', '13:00'), p('SAIDA', '17:00')] }).outcome).toBe('OK');
    expect(evaluateDay({ employee: emp, date: '2026-10-31', punches: [] }).outcome).toBe('SKIP');
  });

  it('dia sem nenhuma batida → pendência mas NÃO é ocorrência de esquecimento', () => {
    const d = evaluateDay({ employee: emp, date: D, punches: [] });
    expect(d.outcome).toBe('PENDENCIA');
    expect(d.forgotten).toBe(false);
  });

  it('atestado dia inteiro → SKIP', () => {
    const d = evaluateDay({ employee: emp, date: D, punches: [], certificates: [{ id: 'c', type: 'ATESTADO', startDate: `${D}T12:00:00Z`, endDate: `${D}T12:00:00Z`, status: 'ATIVO' }] });
    expect(d.outcome).toBe('SKIP');
  });

  it('pedido do app aprovado e não lançado → pendência', () => {
    const d = evaluateDay({ employee: emp, date: D, punches: [p('ENTRADA', '08:00'), p('INTERVALO', '12:00'), p('RETORNO', '13:00')], requests: [{ id: 'r', type: 'ESQUECI_PONTO', status: 'APROVADO', startDate: `${D}T12:00:00Z`, endDate: `${D}T12:00:00Z`, launchedAt: null }] });
    expect(d.outcome).toBe('PENDENCIA');
  });

  it('escala até 18:00 à tarde → adia para a manhã', () => {
    const late = { ...emp, scheduleEnd: '18:00' };
    expect(endsAfterCutoff({ start: '09:00', end: '18:00' } as any)).toBe(true);
    expect(evaluateDay({ employee: late, date: D, phase: 'TARDE', punches: [p('ENTRADA', '08:00'), p('INTERVALO', '12:00'), p('RETORNO', '13:00')] }).outcome).toBe('DEFER');
  });

  it('ajuste desfeito antes não é refeito automaticamente', () => {
    const d = evaluateDay({ employee: emp, date: D, undoneTypes: ['SAIDA'], punches: [p('ENTRADA', '08:00'), p('INTERVALO', '12:00'), p('RETORNO', '13:00')] });
    expect(d.outcome).toBe('PENDENCIA');
  });

  it('Saída* no mesmo minuto de um Intervalo original é tratada como correção do tipo', () => {
    const list = normalizePunches([p('ENTRADA', '08:00'), p('INTERVALO', '12:00'), p('RETORNO', '13:00'), p('INTERVALO', '17:01'), p('SAIDA', '17:01', { origin: 'ADJUSTED', hasPhoto: false, clientId: 'manual-x' })] as any);
    expect(list.map((x: any) => x.type)).toEqual(['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA']);
  });

  it('fillMissing respeita ordem e almoço redondo', () => {
    expect(fillMissing([{ type: 'ENTRADA', min: 480 }, { type: 'RETORNO', min: 13 * 60 + 4 }, { type: 'SAIDA', min: 1020 }], { start: '08:00', end: '17:00' } as any, ['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA'])).toEqual([{ type: 'INTERVALO', time: '12:00' }]);
    expect(fillMissing([{ type: 'ENTRADA', min: 480 }, { type: 'INTERVALO', min: 720 }, { type: 'RETORNO', min: 1030 }], { start: '08:00', end: '17:00' } as any, ['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA'])).toBeNull();
  });
});

describe('aviso de esquecimento no ponto', () => {
  it('avisa a saída esquecida de ontem com horário previsto', () => {
    const w = computeWarnings({ employee: emp as any, punches: [p('ENTRADA', '08:00'), p('INTERVALO', '12:00'), p('RETORNO', '13:00')] as any, certificates: [], requests: [], today: '2026-11-02', now: new Date('2026-11-02T08:00:00-03:00') });
    expect(w.length).toBe(1);
    expect(w[0].issueDate).toBe(D);
    expect(w[0].message).toMatch(/saída/i);
    expect(w[0].message).toMatch(/17:00/);
  });

  it('dia completo não avisa', () => {
    const w = computeWarnings({ employee: emp as any, punches: [p('ENTRADA', '08:00'), p('INTERVALO', '12:00'), p('RETORNO', '13:00'), p('SAIDA', '17:00')] as any, certificates: [], requests: [], today: '2026-11-02', now: new Date('2026-11-02T08:00:00-03:00') });
    expect(w).toEqual([]);
  });

  it('mesmo com a saída já ajustada (*), o colaborador é avisado (prova de ciência)', () => {
    const w = computeWarnings({ employee: emp as any, punches: [p('ENTRADA', '08:00'), p('INTERVALO', '12:00'), p('RETORNO', '13:00'), p('SAIDA', '17:00', { origin: 'ADJUSTED', hasPhoto: false, clientId: 'auto-x' })] as any, certificates: [], requests: [], today: '2026-11-02', now: new Date('2026-11-02T08:00:00-03:00') });
    expect(w.length).toBe(1);
  });

  it('dia sem nenhuma batida (falta) não vira aviso de esquecimento', () => {
    const w = computeWarnings({ employee: emp as any, punches: [] as any, certificates: [], requests: [], today: '2026-11-02', now: new Date('2026-11-02T08:00:00-03:00') });
    expect(w).toEqual([]);
  });
});
