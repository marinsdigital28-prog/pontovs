import { describe, expect, it } from 'vitest';
import { proposeDay } from '../lib/atestado-rapido';
import { buildTimesheetRows } from '../lib/timesheet-rows';
import { certificateMinutesForDay } from '../lib/certificate-calculation';

const at = (hms: string) => new Date(`2026-11-24T${hms}-03:00`);
const emp = { name: 'CRISTIANO FERREIRA DA SILVA', employeeNumber: '0026', workDays: 'SEG,TER,QUA,QUI,SEX', scheduleStart: '08:00', scheduleEnd: '17:00', scheduleByDay: null };
const original = [
  { id: 'e', type: 'ENTRADA', timestamp: at('08:14:37'), origin: 'WEB' },
  { id: 'i', type: 'INTERVALO', timestamp: at('14:12:59'), origin: 'WEB' },
  { id: 's', type: 'SAIDA', timestamp: at('17:06:18'), origin: 'WEB' },
];
const day = (r: ReturnType<typeof buildTimesheetRows>) => r.rows.find((x) => x.date === '2026-11-24')!;
const cert = { type: 'PERICIA_JUDICIAL', startDate: new Date('2026-11-24T12:00:00Z'), endDate: new Date('2026-11-24T12:00:00Z'), startTime: '11:00', endTime: '14:12', hoursPerDayMinutes: 192, status: 'ATIVO', origin: 'TELA_RAPIDA' };

describe('atestado rápido: proposta', () => {
  it('caso Cristiano 24/11: mantém entrada, lança saída 11:00*, 14:12 vira retorno, atestado 11:00–14:12', () => {
    const p = proposeDay({ punches: [{ id: 'e', type: 'ENTRADA', time: '08:14' }, { id: 'i', type: 'INTERVALO', time: '14:12' }, { id: 's', type: 'SAIDA', time: '17:06' }], scheduleStart: '08:00', scheduleEnd: '17:00', partial: true, docStart: '12:00', docEnd: '12:30', requestStart: '11:00', requestEnd: '14:00' });
    expect(p.steps.map((s) => s.kind)).toEqual(['KEEP', 'ADD', 'RELABEL', 'KEEP', 'CERT']);
    expect(p.steps[1]).toMatchObject({ kind: 'ADD', type: 'INTERVALO', time: '11:00' });
    expect(p.steps[2]).toMatchObject({ kind: 'RELABEL', punchId: 'i', to: 'RETORNO' });
    expect([p.abonoStart, p.abonoEnd]).toEqual(['11:00', '14:12']);
  });
  it('sem pedido do app, propõe sair 1h antes do documento; batida de saída existente é reaproveitada', () => {
    const p = proposeDay({ punches: [{ id: 'e', type: 'ENTRADA', time: '08:00' }, { id: 'x', type: 'INTERVALO', time: '10:40' }, { id: 'r', type: 'RETORNO', time: '15:00' }, { id: 's', type: 'SAIDA', time: '17:00' }], scheduleStart: '08:00', scheduleEnd: '17:00', partial: true, docStart: '11:00', docEnd: '14:00' });
    expect(p.steps.filter((s) => s.kind !== 'KEEP').map((s) => s.kind)).toEqual(['CERT']);
    expect([p.abonoStart, p.abonoEnd]).toEqual(['10:40', '15:00']);
  });
});

describe('motor: atestado parcial abona só o que ficou sem batida', () => {
  it('não esconde batidas nem conta duas vezes (Cristiano: trabalhado 5:38, abono 2:12, saldo −0:10 com segundos)', () => {
    const after = [original[0], { id: 'm', type: 'INTERVALO', timestamp: at('11:00:00'), origin: 'ADJUSTED' }, { ...original[1], type: 'RETORNO' }, original[2]];
    const r = day(buildTimesheetRows({ employee: emp, punches: after, certificates: [cert], month: '2026-11', today: '2026-11-25' }));
    expect(r.intervalo).toEqual({ time: '11:00', manual: true });
    expect(r.retorno?.time).toBe('14:12');
    expect(r.worked).toBe(338);
    expect(r.justified).toBe(132);
    expect(r.expected).toBe(480);
    expect(r.balance).toBe(-10);
  });
  it('pedido do app vinculado não abona em dobro quando há atestado com horário', () => {
    const req = { type: 'AUSENCIA', startDate: new Date('2026-11-24T12:00:00Z'), endDate: new Date('2026-11-24T12:00:00Z'), status: 'APROVADO', reason: 'Audiência', classification: 'PARCIAL_TARDE', details: 'Tipo: Parcial tarde · Horário: 11:00–14:00', returnExpected: true, launchedAt: new Date() };
    const after = [original[0], { id: 'm', type: 'INTERVALO', timestamp: at('11:00:00'), origin: 'ADJUSTED' }, { ...original[1], type: 'RETORNO' }, original[2]];
    const r = day(buildTimesheetRows({ employee: emp, punches: after, certificates: [cert], requests: [req], month: '2026-11', today: '2026-11-25' }));
    expect(r.justified).toBe(132);
    expect(r.balance).toBe(-10);
  });
  it('atestado legado (sem origem da tela) continua com a regra antiga — nenhuma folha existente muda', () => {
    const after = [original[0], { id: 'm', type: 'INTERVALO', timestamp: at('11:00:00'), origin: 'ADJUSTED' }, { ...original[1], type: 'RETORNO' }, original[2]];
    const legacy = { ...cert, origin: null };
    const r = day(buildTimesheetRows({ employee: emp, punches: after, certificates: [legacy], month: '2026-11', today: '2026-11-25' }));
    expect(r.intervalo).toBeNull(); // regra antiga esconde batidas dentro da janela
    expect(r.worked).toBe(532);
    expect(r.justified).toBe(132);
  });
  it('trecho trabalhado dentro da janela do atestado não é abonado', () => {
    // janela 10:00–15:00; trabalhou até 11:00 e voltou 14:00 → abona 11–14 menos almoço = 2h
    expect(certificateMinutesForDay({ type: 'HORAS', coverageType: 'HOURS', startDate: '2026-11-24', endDate: '2026-11-24', eventDate: '2026-11-24', startTime: '10:00', endTime: '15:00', status: 'ATIVO' }, '2026-11-24', 480, 1020, true, 480, [[480, 660], [840, 1020]])).toBe(120);
    // sem trechos trabalhados: igual a antes (5h − almoço)
    expect(certificateMinutesForDay({ type: 'HORAS', coverageType: 'HOURS', startDate: '2026-11-24', endDate: '2026-11-24', eventDate: '2026-11-24', startTime: '10:00', endTime: '15:00', status: 'ATIVO' }, '2026-11-24', 480, 1020, true, 480)).toBe(240);
  });
});
