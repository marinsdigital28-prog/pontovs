import { describe, it, expect } from 'vitest';
import { buildChecklist, verificationState, canClose } from '../lib/certificate-checklist';

const emp = { id: 'u1', name: 'Taiane', employeeNumber: '0412', workDays: 'SEG,TER,QUA,QUI,SEX', scheduleStart: '07:30', scheduleEnd: '17:30', scheduleByDay: null };
const m = (c: string) => Number(c.slice(0, 2)) * 60 + Number(c.slice(3));
const day = (date: string, rows: [string, string, boolean?][]) => rows.map(([type, t, manual]) => ({ userId: 'u1', date, type, minutes: m(t), manual }));
const cert = (o: any) => ({ id: 'c1', userId: 'u1', type: 'HORAS', status: 'ATIVO', ...o });
const run = (punches: any[], certificates: any[] = [], requests: any[] = []) => buildChecklist({ employees: [emp], punches, certificates, requests, month: '2026-10', untilDate: '2026-10-29' }).filter((o) => o.date === (punches[0]?.date ?? certificates[0]?.startDate ?? requests[0]?.startDate));

describe('checklist de atestados', () => {
  it('atraso coberto por atestado de horas', () => {
    const o = run(day('2026-10-02', [['ENTRADA', '08:45'], ['INTERVALO', '12:00'], ['RETORNO', '13:00'], ['SAIDA', '17:30']]), [cert({ startDate: '2026-10-02', endDate: '2026-10-02', startTime: '07:30', endTime: '08:45' })]);
    expect(o).toHaveLength(1); expect(o[0].kind).toBe('ATRASO'); expect(o[0].status).toBe('COBERTO'); expect(o[0].abonoMinutes).toBe(75);
  });
  it('manhã sem entrada sem documento', () => {
    const o = run(day('2026-10-08', [['ENTRADA', '12:02'], ['SAIDA', '17:30']]));
    expect(o[0].kind).toBe('MANHA_SEM_ENTRADA'); expect(o[0].status).toBe('SEM_DOCUMENTO'); expect(o[0].window).toBe('07:30–12:02');
  });
  it('documento com horário que não bate = parcial', () => {
    const o = run(day('2026-10-13', [['ENTRADA', '10:05'], ['SAIDA', '17:30']]), [cert({ startDate: '2026-10-13', endDate: '2026-10-13', startTime: '08:00', endTime: '09:00' })]);
    expect(o[0].status).toBe('PARCIAL');
  });
  it('falta coberta por atestado de dia inteiro e falta sem documento', () => {
    const all = buildChecklist({ employees: [emp], punches: [], certificates: [cert({ type: 'DIA_INTEGRAL', startDate: '2026-10-15', endDate: '2026-10-16' })], requests: [], month: '2026-10', untilDate: '2026-10-20' });
    expect(all.find((o) => o.date === '2026-10-15')?.status).toBe('COBERTO');
    expect(all.find((o) => o.date === '2026-10-19')?.status).toBe('SEM_DOCUMENTO');
    expect(all.find((o) => o.date === '2026-10-18')).toBeUndefined(); // domingo
  });
  it('ajuste * dentro do período do atestado conflita; ajuste fora não', () => {
    const o = run(day('2026-10-20', [['ENTRADA', '07:30'], ['INTERVALO', '12:00'], ['RETORNO', '13:01', true], ['SAIDA', '17:30', true]]), [cert({ startDate: '2026-10-20', endDate: '2026-10-20', startTime: '12:00', endTime: '14:00' })]);
    expect(o.find((x) => x.label.includes('retorno'))?.status).toBe('AJUSTE_CONFLITA');
    expect(o.find((x) => x.label.includes('saída 17:30'))?.status).toBe('AJUSTE_OK');
  });
  it('ajuste * não esconde a manhã sem entrada (usa só batidas originais)', () => {
    const o = run(day('2026-10-21', [['ENTRADA', '07:30', true], ['RETORNO', '12:00'], ['SAIDA', '17:30']]));
    expect(o.some((x) => x.kind === 'MANHA_SEM_ENTRADA')).toBe(true);
  });
  it('abono com a pessoa trabalhando = fora da jornada', () => {
    const o = run(day('2026-10-01', [['ENTRADA', '07:30'], ['INTERVALO', '12:00'], ['RETORNO', '13:00'], ['SAIDA', '17:30']]), [cert({ startDate: '2026-10-01', endDate: '2026-10-01', startTime: '16:00', endTime: '17:00' })]);
    expect(o.map((x) => x.status)).toEqual(['FORA_JORNADA']);
  });
  it('solicitação do app sem documento; recusada é ignorada', () => {
    const r = [{ id: 'r1', employeeId: 'u1', type: 'AUSENCIA', status: 'PENDENTE', startDate: '2026-10-14', endDate: '2026-10-14', reason: 'Vistoria' }, { id: 'r2', employeeId: 'u1', type: 'AUSENCIA', status: 'REJEITADO', startDate: '2026-10-14', endDate: '2026-10-14' }];
    const o = run(day('2026-10-14', [['ENTRADA', '07:30'], ['INTERVALO', '12:00'], ['RETORNO', '13:00'], ['SAIDA', '17:30']]), [], r);
    expect(o.map((x) => [x.kind, x.status])).toEqual([['SOLICITACAO', 'SEM_DOCUMENTO']]);
  });
  it('estado de verificação segue o último evento e libera o fechamento só com tudo verificado', () => {
    const occ = run(day('2026-10-08', [['ENTRADA', '12:02'], ['SAIDA', '17:30']]));
    const k = occ[0].key;
    let st = verificationState([{ action: 'CHECKLIST_VERIFIED', key: k, createdAt: '2026-10-29T10:00:00Z' }, { action: 'CHECKLIST_UNVERIFIED', key: k, createdAt: '2026-10-29T10:05:00Z' }]);
    expect(canClose(occ, st)).toBe(false);
    st = verificationState([{ action: 'CHECKLIST_VERIFIED', key: k, createdAt: '2026-10-29T10:10:00Z', actorName: 'Maicon' }]);
    expect(canClose(occ, st)).toBe(true); expect(st[k].by).toBe('Maicon');
  });
});
