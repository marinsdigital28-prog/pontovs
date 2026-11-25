import { describe, expect, it } from 'vitest';
import { evaluateDay, fillMissing, normalizePunches, endsAfterCutoff, AUTO_CLOSE_REASON } from '../lib/auto-close';
import { computeWarnings } from '../lib/punch-warnings';

const emp = { id: 'u1', name: 'Fulano Teste', employeeNumber: '9999', workDays: 'SEG,TER,QUA,QUI,SEX', scheduleStart: '08:00', scheduleEnd: '17:00', scheduleByDay: null };
const D = '2026-10-30'; // sexta
// Padrão real regular (15 dias úteis antes de D): 08:00 · 12:00 · 13:00 · 17:00 com pequenas variações.
const H = ['2026-10-09', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-08']
  .map((date, i) => ({ date, punches: [{ type: 'ENTRADA', min: 478 + (i % 5) }, { type: 'INTERVALO', min: 719 + (i % 4) }, { type: 'RETORNO', min: 779 + (i % 4) }, { type: 'SAIDA', min: 1020 + (i % 3) }] }));
let n = 0;
const p = (type: string, hm: string, extra: Partial<{ hasPhoto: boolean; origin: string; clientId: string; date: string }> = {}) =>
  ({ id: `p${++n}`, type, timestamp: new Date(`${extra.date || D}T${hm}:00-03:00`), status: 'VALID', origin: extra.origin || 'ONLINE', hasPhoto: extra.hasPhoto ?? true, clientId: extra.clientId || null });

describe('verificação 17:20', () => {
  it('motivo padrão', () => expect(AUTO_CLOSE_REASON).toBe('Ajuste automático 17:20'));

  it('3 batidas sem saída → AUTO com saída da escala (caso Gilvan)', () => {
    const d = evaluateDay({ employee: emp, date: D, punches: [p('ENTRADA', '07:58'), p('INTERVALO', '12:01'), p('RETORNO', '13:02')], history: H });
    expect(d.outcome).toBe('AUTO');
    expect(d.proposal).toEqual({ type: 'SAIDA', time: '17:00' });
    expect(d.forgotten).toBe(true);
  });

  it('3 batidas sem entrada → AUTO Entrada 08:00 (caso Suelen)', () => {
    const d = evaluateDay({ employee: emp, date: D, punches: [p('INTERVALO', '12:00'), p('RETORNO', '13:00'), p('SAIDA', '17:03')], history: H });
    expect(d.outcome).toBe('AUTO');
    expect(d.proposal).toEqual({ type: 'ENTRADA', time: '08:00' });
  });

  it('volta do almoço faltando → horário redondo do hábito; 1 batida de almoço sozinha é ambígua (< 75%) → sugestão, não AUTO', () => {
    const history = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-26', '2026-10-27'].map((date) => ({ date, punches: [{ type: 'ENTRADA', min: 478 }, { type: 'INTERVALO', min: 722 }, { type: 'RETORNO', min: 781 }, { type: 'SAIDA', min: 1021 }] }));
    const d = evaluateDay({ employee: emp, date: D, punches: [p('ENTRADA', '08:00'), p('INTERVALO', '12:07'), p('SAIDA', '17:00')], history });
    expect(d.outcome).toBe('PENDENCIA');
    // saiu 12:07: 13:00 daria só 53 min de almoço → 13:10 (garante 60 min, nunca +60 cego para 13:07+1h=14:07)
    expect(d.pendencia?.suggestion).toMatchObject({ kind: 'INSERT_PUNCHES', punches: [{ type: 'RETORNO', time: '13:10' }] });
    expect(d.confidence!).toBeLessThan(0.75);
    // Sem histórico (sem padrão real): NÃO inventa horário — vira dúvida com "falta Retorno".
    const s = evaluateDay({ employee: emp, date: D, punches: [p('ENTRADA', '08:00'), p('INTERVALO', '12:07'), p('SAIDA', '17:00')] });
    expect(s.outcome).toBe('PENDENCIA');
    expect(s.pendencia?.kind).toBe('DUVIDA');
    expect(s.pendencia?.suggestion?.kind).toBe('TEXT');
    expect(s.pendencia?.title).toMatch(/falta Retorno \(sem horário sugerido\)/);
    expect(s.pendencia?.title).not.toMatch(/1[34]:\d\d\*/);
    const ok = evaluateDay({ employee: emp, date: D, punches: [p('ENTRADA', '08:00'), p('INTERVALO', '11:58'), p('SAIDA', '17:00')], history });
    expect(ok.pendencia?.suggestion).toMatchObject({ punches: [{ type: 'RETORNO', time: '13:00' }] });
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

  it('às 17:20 quem ainda não bateu a saída é adiado para as 08:00 (pode estar em hora extra)', () => {
    const d = evaluateDay({ employee: emp, date: D, phase: 'TARDE', punches: [p('ENTRADA', '08:00'), p('INTERVALO', '12:00'), p('RETORNO', '13:00')] });
    expect(d.outcome).toBe('DEFER');
    expect(d.forgotten).toBe(false);
    const manha = evaluateDay({ employee: emp, date: D, phase: 'MANHA', punches: [p('ENTRADA', '08:00'), p('INTERVALO', '12:00'), p('RETORNO', '13:00')], history: H });
    expect(manha.outcome).toBe('AUTO');
    expect(manha.proposal).toEqual({ type: 'SAIDA', time: '17:00' });
  });

  it('às 17:20 quem já saiu e esqueceu a entrada é fechado na hora', () => {
    const d = evaluateDay({ employee: emp, date: D, phase: 'TARDE', punches: [p('INTERVALO', '12:00'), p('RETORNO', '13:00'), p('SAIDA', '17:01')], history: H });
    expect(d.outcome).toBe('AUTO');
    expect(d.proposal).toEqual({ type: 'ENTRADA', time: '08:00' });
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
    expect(fillMissing([{ type: 'ENTRADA', min: 480 }, { type: 'RETORNO', min: 13 * 60 + 4 }, { type: 'SAIDA', min: 1020 }], { start: '08:00', end: '17:00' } as any, ['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA'], H, D)).toEqual([{ type: 'INTERVALO', time: '12:00' }]);
    // sem padrão real → não inventa
    expect(fillMissing([{ type: 'ENTRADA', min: 480 }, { type: 'RETORNO', min: 13 * 60 + 4 }, { type: 'SAIDA', min: 1020 }], { start: '08:00', end: '17:00' } as any, ['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA'])).toBeNull();
    expect(fillMissing([{ type: 'ENTRADA', min: 480 }, { type: 'INTERVALO', min: 720 }, { type: 'RETORNO', min: 1030 }], { start: '08:00', end: '17:00' } as any, ['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA'], H, D)).toBeNull();
  });
});

describe('aviso de esquecimento no ponto', () => {
  it('avisa a saída esquecida de ontem (sem padrão carregado: sem horário inventado)', () => {
    const w = computeWarnings({ employee: emp as any, punches: [p('ENTRADA', '08:00'), p('INTERVALO', '12:00'), p('RETORNO', '13:00')] as any, certificates: [], requests: [], today: '2026-11-02', now: new Date('2026-11-02T08:00:00-03:00') });
    expect(w.length).toBe(1);
    expect(w[0].issueDate).toBe(D);
    expect(w[0].message).toMatch(/saída/i);
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

describe('leitura inteligente na verificação (casos reais de novembro)', () => {
  const eli = { id: 'u2', name: 'Elisabete', employeeNumber: '7777', workDays: 'SEG,TER,QUA,QUI,SEX', scheduleStart: '07:00', scheduleEnd: '16:00', scheduleByDay: null };
  const hist = ['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-10', '2026-11-11', '2026-11-12'].map((date) => ({ date, punches: [{ type: 'ENTRADA', min: 418 }, { type: 'INTERVALO', min: 720 }, { type: 'RETORNO', min: 782 }, { type: 'SAIDA', min: 963 }] }));
  const q = (type: string, hm: string) => ({ id: `${type}-${hm}`, type, timestamp: new Date(`2026-11-23T${hm}:00-03:00`), status: 'VALID', origin: 'WEB', hasPhoto: true, clientId: 'uuid' });
  it('Elisabete 23/11: 11:59 "Entrada" é Intervalo, 13:06 "Intervalo" é Retorno, falta Entrada 07:00* — nunca Retorno 14:00', () => {
    const d = evaluateDay({ employee: eli, date: '2026-11-23', punches: [q('ENTRADA', '11:59'), q('INTERVALO', '13:06'), q('SAIDA', '16:05')], history: hist });
    expect(d.outcome).toBe('AUTO');
    expect(d.proposal).toEqual({ type: 'ENTRADA', time: '07:00' });
    expect(d.relabels).toEqual([{ punchId: 'ENTRADA-11:59', time: '11:59', from: 'ENTRADA', to: 'INTERVALO' }, { punchId: 'INTERVALO-13:06', time: '13:06', from: 'INTERVALO', to: 'RETORNO' }]);
    expect(JSON.stringify(d)).not.toMatch(/14:00/);
  });
  it('leitura do gestor (fixed) é respeitada e não é relida', () => {
    const punches = [{ ...q('INTERVALO', '11:59'), interpretation: { type: 'INTERVALO', source: 'GESTOR' } }, { ...q('RETORNO', '13:06'), interpretation: { type: 'RETORNO', source: 'GESTOR' } }, q('SAIDA', '16:05')];
    const d = evaluateDay({ employee: eli, date: '2026-11-23', punches, history: hist });
    expect(d.relabels).toEqual([]);
    expect(d.proposal).toEqual({ type: 'ENTRADA', time: '07:00' });
  });
  it('lançamento manual às 00:00 (12 AM) vira pendência "horário suspeito", nunca é usado na leitura', () => {
    const d = evaluateDay({ employee: eli, date: '2026-11-23', punches: [{ ...q('INTERVALO', '00:00'), origin: 'ADJUSTED', clientId: 'manual-x', hasPhoto: false }, q('ENTRADA', '07:24'), q('RETORNO', '13:03'), q('SAIDA', '16:29')], history: hist });
    expect(d.outcome).toBe('PENDENCIA');
    expect(d.pendencia?.kind).toBe('HORARIO_SUSPEITO');
  });
  it('dia completo pela leitura (gestor já lançou Intervalo 12:00*) → OK, fecha alerta antigo de Retorno 14:00', () => {
    const d = evaluateDay({ employee: eli, date: '2026-11-23', punches: [q('ENTRADA', '08:12'), { ...q('INTERVALO', '12:00'), origin: 'ADJUSTED', clientId: 'manual-y', hasPhoto: false }, q('RETORNO', '13:01'), q('SAIDA', '17:02')], history: hist });
    expect(d.outcome).toBe('OK');
    // se o totem gravou 13:01 como "Intervalo", a sugestão é só reler como Retorno (nada a inserir)
    const r = evaluateDay({ employee: eli, date: '2026-11-23', punches: [q('ENTRADA', '08:12'), { ...q('INTERVALO', '12:00'), origin: 'ADJUSTED', clientId: 'manual-y', hasPhoto: false }, q('INTERVALO', '13:01'), q('SAIDA', '17:02')], history: hist });
    expect(r.pendencia?.kind).toBe('TIPO_ERRADO');
    expect(r.pendencia?.suggestion).toMatchObject({ kind: 'INSERT_PUNCHES', punches: [], relabels: [{ time: '13:01', to: 'RETORNO' }] });
  });
});
