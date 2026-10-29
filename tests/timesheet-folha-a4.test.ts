import { describe, expect, test } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import fixture from './fixtures/folha-arte-nova.json';
import { buildTimesheetDocument } from '../lib/signed-timesheet-pdf';
import { buildTimesheetRows, certificateDayMinutes, formatClock, formatSigned, workedMinutes } from '../lib/timesheet-rows';
import { certificateMinutesForDay } from '../lib/certificate-calculation';

/** Dados fictícios idênticos aos da arte aprovada (Ana Souza [fake], out/2026, hoje = 27/10). */
const at = (d: number, m: number) => new Date(Date.UTC(2026, 9, d, 3 + Math.floor(m / 60), m % 60));
const employee = {
  name: 'Ana Souza [fake]', employeeNumber: '1001', cpf: null, jobTitle: 'Educadora',
  workDays: 'SEG,TER,QUA,QUI,SEX', scheduleStart: '08:00', scheduleEnd: '17:00',
};
const punches = (fixture.rows as any[]).flatMap((r) => r.E == null ? [] : [
  { type: 'ENTRADA', timestamp: at(r.d, r.E) }, { type: 'INTERVALO', timestamp: at(r.d, r.I) },
  { type: 'RETORNO', timestamp: at(r.d, r.R) }, { type: 'SAIDA', timestamp: at(r.d, r.S), origin: r.d === 22 ? 'ADJUSTED' : 'WEB' },
]);
const certificates = [
  { type: 'HORAS', startDate: new Date('2026-10-14T12:00:00Z'), endDate: new Date('2026-10-14T12:00:00Z'), startTime: '08:00', endTime: '11:00', status: 'APROVADO' },
  { type: 'DIA_INTEGRAL', startDate: new Date('2026-10-21T12:00:00Z'), endDate: new Date('2026-10-21T12:00:00Z'), status: 'APROVADO' },
];
const input = { employee, punches, certificates, month: '2026-10', today: '2026-10-27', extraHolidays: { '2026-10-12': 'Aparecida' } };

describe('folha de ponto A4 (arte-nova aprovada)', () => {
  const { rows, totals } = buildTimesheetRows(input);

  test('cada linha bate com a arte validada', () => {
    for (const r of fixture.rows as any[]) {
      const row = rows[r.d - 1];
      expect(row.credited === null ? '—' : formatClock(row.credited), `dia ${r.d} trab`).toBe(r.shown.w);
      expect(row.expected === null ? '—' : formatClock(row.expected), `dia ${r.d} prev`).toBe(r.shown.p);
      expect(row.missing ? formatClock(row.missing) : '—', `dia ${r.d} falta`).toBe(r.shown.f);
      expect(row.balance === null ? '—' : formatSigned(row.balance), `dia ${r.d} saldo`).toBe(r.shown.sa);
    }
  });

  test('totais = somas; Trab − Prev = Saldo; futuros fora', () => {
    expect(formatClock(totals.worked)).toBe(fixture.totals.tw);
    expect(formatClock(totals.expected)).toBe(fixture.totals.tp);
    expect(formatClock(totals.missing)).toBe(fixture.totals.tf);
    expect(formatSigned(totals.balance)).toBe(fixture.totals.ts);
    expect(totals.workedDays).toBe(fixture.totals.dias);
    expect(totals.worked - totals.expected).toBe(totals.balance);
    const sum = (k: 'credited' | 'expected' | 'balance') => rows.reduce((t, r) => t + (r[k] ?? 0), 0);
    expect(sum('credited')).toBe(totals.worked);
    expect(sum('expected')).toBe(totals.expected);
    expect(sum('balance')).toBe(totals.balance);
    expect(rows.slice(27).every((r) => r.future && r.expected === null && r.credited === null)).toBe(true);
  });

  test('Situação: atestado de horas com faixa, atestado dia, feriado, * e folga', () => {
    expect(rows[13].situation).toBe('Atestado 08:00–11:00 · +03:00');
    expect(rows[20].situation).toBe('Atestado · dia · +08:00');
    expect(rows[11].situation).toBe('Feriado · Aparecida · +08:00');
    expect(rows[21].saida?.manual).toBe(true);
    expect(rows[2].situation).toBe('Folga');
  });

  test('atestado por horas usa as regras de lib/certificate-calculation', () => {
    const cert = { type: 'HORAS', startDate: new Date('2026-10-14T12:00:00Z'), endDate: new Date('2026-10-14T12:00:00Z'), startTime: '11:00', endTime: '14:00', status: 'APROVADO' };
    const viaLib = certificateMinutesForDay({ ...cert, startDate: '2026-10-14', endDate: '2026-10-14' }, '2026-10-14', 480, 1020, true, 480);
    expect(viaLib).toBe(120); // desconta almoço 12–13
    expect(certificateDayMinutes(cert, '2026-10-14', 480, 1020, true, 480)).toBe(viaLib);
  });

  test('worked = (I−E)+(S−R)', () => {
    expect(workedMinutes([
      { type: 'ENTRADA', timestamp: at(1, 483) }, { type: 'INTERVALO', timestamp: at(1, 721) },
      { type: 'RETORNO', timestamp: at(1, 779) }, { type: 'SAIDA', timestamp: at(1, 1017) },
    ])).toBe(476);
  });

  test('PDF: 1 página A4 paisagem, sem crash com "−", 31 dias', async () => {
    const { pdfDoc } = await buildTimesheetDocument({ ...input, options: { today: input.today, extraHolidays: input.extraHolidays, emittedAt: new Date('2026-10-28T18:55:12Z') } });
    const doc = await PDFDocument.load(await pdfDoc.save());
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(Math.round(width)).toBe(842);
    expect(Math.round(height)).toBe(595);
  });

  test('mês anterior inteiro: nenhum dia futuro, falta sem marcação = −08:00', () => {
    const { rows: r2, totals: t2 } = buildTimesheetRows({ employee, punches: [], month: '2026-09', today: '2026-10-27' });
    expect(r2.some((r) => r.future)).toBe(false);
    const workdays = r2.filter((r) => r.scheduled).length;
    expect(t2.expected).toBe(workdays * 480 - 0); // 07/09 feriado também tem previsto
    expect(t2.worked - t2.expected).toBe(t2.balance);
    expect(r2[0].situation).toBe('Falta');
    expect(r2[6].situation).toBe('Feriado · Independência do Brasil · +08:00');
  });
});
