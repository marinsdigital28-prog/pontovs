import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import signpdf from '@signpdf/signpdf';
import { P12Signer } from '@signpdf/signer-p12';
import { isScheduledDay, parseWorkDays } from './timesheet-schedule';
import { filterPunchesOutsideCertificates } from './certificate-conflicts';

export type TimesheetEmployee = {
  name: string;
  employeeNumber: string | null;
  cpf: string | null;
  jobTitle: string | null;
  workDays: string | null;
  scheduleStart: string | null;
  scheduleEnd: string | null;
};

export type TimesheetPunch = { type: string; timestamp: Date };
export type TimesheetCertificate = {
  startDate: Date; endDate: Date; startTime?: string | null; endTime?: string | null;
  hoursPerDayMinutes?: number | null; status: string;
};
export type TimesheetRequest = { type: string; startDate: Date; endDate: Date; status: string; reason: string };

/** A4 HORIZONTAL (paisagem): largura > altura */
const A4_WIDTH = 841.89;  // 297mm
const A4_HEIGHT = 595.28; // 210mm
const MARGIN_X = 16;
const FOOTER_H = 48;
const HEADER_H = 42;

const weekdayCodes: Record<number, string> = { 0: 'DOM', 1: 'SEG', 2: 'TER', 3: 'QUA', 4: 'QUI', 5: 'SEX', 6: 'SÁB' };
const weekdayShort = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const monthNames = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const APP_TIME_ZONE = 'America/Sao_Paulo';

function formatTime(value: Date) {
  return value.toLocaleTimeString('pt-BR', { timeZone: APP_TIME_ZONE, hour: '2-digit', minute: '2-digit' });
}
function minutesFromClock(value: string | null | undefined) {
  const match = value?.match(/^(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}
function minutesBetween(start: Date, end: Date) {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}
function formatMinutes(value: number | null) {
  if (value === null) return '—';
  return `${String(Math.floor(Math.abs(value) / 60)).padStart(2, '0')}:${String(Math.abs(value) % 60).padStart(2, '0')}`;
}
function formatSignedMinutes(value: number | null) {
  if (value === null) return '—';
  return `${value < 0 ? '-' : ''}${formatMinutes(Math.abs(value))}`;
}
function rowDayKey(value: Date) {
  return value.toLocaleDateString('en-CA', { timeZone: APP_TIME_ZONE });
}
function shortType(type: string) {
  return ({ ENTRADA: 'E', INTERVALO: 'I', RETORNO: 'R', SAIDA: 'S' } as Record<string, string>)[type] || type.slice(0, 1);
}
function workedMinutes(punches: TimesheetPunch[]) {
  const ordered = [...punches].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const entry = ordered.find((p) => p.type === 'ENTRADA');
  const interval = ordered.find((p) => p.type === 'INTERVALO' && entry && p.timestamp > entry.timestamp);
  const retorno = ordered.find((p) => p.type === 'RETORNO' && interval && p.timestamp > interval.timestamp);
  const saida = ordered.find((p) => p.type === 'SAIDA' && retorno && p.timestamp > retorno.timestamp);
  const pairs: Array<[Date, Date]> = [];
  if (entry && interval) pairs.push([entry.timestamp, interval.timestamp]);
  if (retorno && saida) pairs.push([retorno.timestamp, saida.timestamp]);
  if (!pairs.length && ordered.length >= 2) pairs.push([ordered[0].timestamp, ordered[ordered.length - 1].timestamp]);
  return ordered.length ? pairs.reduce((t, [a, b]) => t + minutesBetween(a, b), 0) : null;
}

export async function createSignedTimesheetPdf({
  employee, punches, certificates = [], requests = [], month, certificate, password,
}: {
  employee: TimesheetEmployee;
  punches: TimesheetPunch[];
  certificates?: TimesheetCertificate[];
  requests?: TimesheetRequest[];
  month: string;
  certificate: Buffer;
  password: string;
}) {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();

  const pdfDoc = await PDFDocument.create();
  // OBRIGATÓRIO: A4 horizontal (paisagem) — largura 297mm, altura 210mm
  const page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = page.getWidth();
  const pageHeight = page.getHeight();
  const green = rgb(0.05, 0.35, 0.25);
  const dark = rgb(0.08, 0.12, 0.1);
  const muted = rgb(0.38, 0.42, 0.4);
  const contentRight = pageWidth - MARGIN_X;

  // Cabeçalho
  page.drawRectangle({ x: 0, y: pageHeight - HEADER_H, width: pageWidth, height: HEADER_H, color: green });
  page.drawText('ESPAÇO PROGREDIR — FOLHA DE PONTO · A4 HORIZONTAL', {
    x: MARGIN_X, y: pageHeight - 18, size: 11, font: bold, color: rgb(1, 1, 1),
  });
  page.drawText('Estrada da Grama, 21 — Miguel Couto · Nova Iguaçu — RJ · CNPJ 05.553.848/0001-61',
    { x: MARGIN_X, y: pageHeight - 30, size: 7, font: regular, color: rgb(0.9, 0.98, 0.94) });
  page.drawText(
    `Competência 01/${String(monthNumber).padStart(2, '0')}/${year} a ${String(lastDay).padStart(2, '0')}/${String(monthNumber).padStart(2, '0')}/${year} · ${monthNames[monthNumber - 1].toUpperCase()} · 1 página paisagem`,
    { x: MARGIN_X, y: pageHeight - 40, size: 7, font: regular, color: rgb(0.95, 0.9, 0.55) },
  );

  const nameY = pageHeight - HEADER_H - 11;
  page.drawText(employee.name, { x: MARGIN_X, y: nameY, size: 9, font: bold, color: dark, maxWidth: 400 });
  page.drawText(
    `Mat. ${employee.employeeNumber || '—'} · CPF ${employee.cpf || '—'} · ${employee.jobTitle || '—'}`,
    { x: MARGIN_X + 410, y: nameY, size: 7, font: regular, color: muted, maxWidth: 380 },
  );

  const workDays = employee.workDays ? parseWorkDays(employee.workDays) : new Set(['SEG', 'TER', 'QUA', 'QUI', 'SEX']);
  const scheduleStart = minutesFromClock(employee.scheduleStart);
  const scheduleEnd = minutesFromClock(employee.scheduleEnd);
  const scheduleSpan = scheduleStart !== null && scheduleEnd !== null ? Math.max(0, scheduleEnd - scheduleStart) : null;
  const lunch = scheduleSpan !== null && scheduleSpan > 6 * 60 ? 60 : 0;
  const expectedBase = scheduleSpan === null ? null : Math.max(0, scheduleSpan - lunch);

  const columns = [MARGIN_X, 56, 160, 355, 405, 452, 502, 565, contentRight];
  const headers = ['Data', 'Escala', 'Marcações', 'Trab.', 'Prev.', 'Saldo', 'Sit.', 'Obs.'];

  const tableTop = nameY - 12;
  const tableBottom = FOOTER_H + 16;
  const headerRowH = 10;
  const rowHeight = Math.min(12, (tableTop - tableBottom - headerRowH) / lastDay);
  const fontSize = rowHeight >= 11 ? 7 : rowHeight >= 10 ? 6.5 : 6;

  headers.forEach((h, i) => {
    page.drawText(h, { x: columns[i] + 2, y: tableTop - 7, size: 6.5, font: bold, color: green });
  });
  page.drawLine({
    start: { x: MARGIN_X, y: tableTop - headerRowH },
    end: { x: contentRight, y: tableTop - headerRowH },
    thickness: 0.8, color: green,
  });

  let totalWorked = 0;
  let totalExpected = 0;
  let absences = 0;

  for (let index = 0; index < lastDay; index += 1) {
    const date = new Date(year, monthNumber - 1, index + 1, 12, 0, 0);
    const dateKey = `${year}-${String(monthNumber).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`;
    const rawDayPunches = punches.filter((p) => rowDayKey(p.timestamp) === dateKey);
    const dayCerts = certificates.map((c) => ({
      userId: '', startDate: c.startDate, endDate: c.endDate,
      startTime: c.startTime, endTime: c.endTime, status: c.status,
    }));
    const dayPunches = filterPunchesOutsideCertificates(
      rawDayPunches.map((p, i) => ({ id: String(i), userId: '', type: p.type, timestamp: p.timestamp, status: 'VALID' })),
      dayCerts as any,
    ).map((p) => ({ type: p.type, timestamp: p.timestamp }));

    const weekday = date.getDay();
    const scheduled = isScheduledDay(workDays, weekdayCodes[weekday]);
    const expected = scheduled ? expectedBase : null;
    const configuredWorkday = scheduled && expected !== null;
    const worked = workedMinutes(dayPunches);
    const certificate = certificates.find((item) => {
      if (item.status !== 'APROVADO' && item.status !== 'ATIVO') return false;
      return rowDayKey(item.startDate) <= dateKey && rowDayKey(item.endDate) >= dateKey;
    });
    const certificateMinutes = certificate
      ? certificate.startTime && certificate.endTime
        ? Math.max(0, (minutesFromClock(certificate.endTime) || 0) - (minutesFromClock(certificate.startTime) || 0))
        : expected || 0
      : 0;
    const creditedWorked =
      worked === null ? (certificateMinutes > 0 ? certificateMinutes : null) : worked + certificateMinutes;
    if (creditedWorked !== null) totalWorked += creditedWorked;
    if (expected !== null) totalExpected += expected;

    const coveredByCertificate = Boolean(certificate);
    const approvedRequest = requests.find(
      (item) =>
        item.status === 'APROVADO' &&
        ((item.type === 'AUSENCIA' && rowDayKey(item.startDate) <= dateKey && rowDayKey(item.endDate) >= dateKey) ||
          (item.type === 'TROCA_DIA' && (rowDayKey(item.startDate) === dateKey || rowDayKey(item.endDate) === dateKey))),
    );
    const absent = configuredWorkday && !dayPunches.length && !coveredByCertificate && approvedRequest?.type !== 'AUSENCIA';
    if (absent) absences += 1;

    const y = tableTop - headerRowH - rowHeight * (index + 1) + 2.5;
    if (index % 2 === 1) {
      page.drawRectangle({
        x: MARGIN_X, y: y - 2, width: contentRight - MARGIN_X, height: rowHeight,
        color: rgb(0.96, 0.98, 0.97),
      });
    }

    const schedule = !scheduled
      ? 'Folga'
      : employee.scheduleStart && employee.scheduleEnd
        ? `${employee.scheduleStart.slice(0, 5)}-${employee.scheduleEnd.slice(0, 5)}`
        : '—';
    const marks = dayPunches.length
      ? dayPunches.map((p) => `${formatTime(p.timestamp)}${shortType(p.type)}`).join(' ')
      : '—';
    const balance = creditedWorked === null || expected === null ? null : creditedWorked - expected;
    const sit = coveredByCertificate
      ? 'ATEST.'
      : approvedRequest
        ? approvedRequest.type === 'AUSENCIA' ? 'AUS.' : 'TROCA'
        : absent ? 'FALTA' : !scheduled ? 'FOLGA' : '';
    const obs = coveredByCertificate && dayPunches.length
      ? 'abono+ponto'
      : approvedRequest ? String(approvedRequest.reason || '').slice(0, 16) : '';

    const values = [
      `${String(index + 1).padStart(2, '0')} ${weekdayShort[weekday]}`,
      schedule,
      marks,
      formatMinutes(creditedWorked),
      formatMinutes(expected),
      balance === null ? '—' : `${balance < 0 ? '-' : ''}${formatMinutes(Math.abs(balance))}`,
      sit,
      obs,
    ];

    values.forEach((value, valueIndex) => {
      page.drawText(String(value).slice(0, valueIndex === 2 ? 34 : 20), {
        x: columns[valueIndex] + 2,
        y,
        size: valueIndex === 2 ? Math.max(5.5, fontSize - 0.3) : fontSize,
        font: valueIndex === 6 && (absent || coveredByCertificate) ? bold : regular,
        color: valueIndex === 6 && absent
          ? rgb(0.65, 0.12, 0.12)
          : valueIndex === 6 && coveredByCertificate ? green : dark,
        maxWidth: columns[valueIndex + 1] - columns[valueIndex] - 4,
      });
    });
  }

  const totalsY = FOOTER_H + 6;
  page.drawLine({
    start: { x: MARGIN_X, y: totalsY + 12 }, end: { x: contentRight, y: totalsY + 12 },
    thickness: 1, color: green,
  });
  page.drawText(`Trab. ${formatMinutes(totalWorked)}`, { x: MARGIN_X, y: totalsY + 3, size: 8, font: bold, color: dark });
  page.drawText(`Prev. ${formatMinutes(totalExpected)}`, { x: 115, y: totalsY + 3, size: 8, font: bold, color: dark });
  page.drawText(`Saldo ${formatSignedMinutes(totalWorked - totalExpected)}`, { x: 220, y: totalsY + 3, size: 8, font: bold, color: dark });
  page.drawText(`Faltas ${absences}`, { x: 340, y: totalsY + 3, size: 8, font: bold, color: dark });
  page.drawText('A4 horizontal (paisagem) · 1 página', {
    x: 420, y: totalsY + 3, size: 7, font: regular, color: muted,
  });

  page.drawRectangle({
    x: MARGIN_X, y: 6, width: 290, height: 26,
    color: rgb(0.95, 1, 0.96), borderColor: rgb(0.24, 0.61, 0.39), borderWidth: 0.6,
  });
  page.drawText('✓ Assinado digitalmente — ESPAÇO PROGREDIR', {
    x: MARGIN_X + 5, y: 22, size: 7, font: bold, color: green,
  });
  page.drawText('Certificado A1 · ICP-Brasil · CNPJ 05.553.848/0001-61', {
    x: MARGIN_X + 5, y: 12, size: 6, font: regular, color: muted,
  });

  page.drawText('ASSINATURA DO COLABORADOR', { x: 500, y: 26, size: 7, font: bold, color: green });
  page.drawLine({ start: { x: 500, y: 16 }, end: { x: contentRight, y: 16 }, thickness: 0.7, color: muted });
  page.drawText(employee.name, { x: 500, y: 8, size: 6.5, font: regular, color: muted, maxWidth: 300 });

  // evita unused import se degrees não for usado
  void degrees;

  pdflibAddPlaceholder({
    pdfDoc, pdfPage: page,
    reason: 'Assinatura institucional da Folha de Ponto',
    contactInfo: 'Espaço Progredir', name: 'Espaço Progredir', location: 'Nova Iguaçu - RJ',
    signatureLength: 20000, widgetRect: [MARGIN_X, 6, MARGIN_X + 290, 32],
  });
  const pdfWithPlaceholder = Buffer.from(await pdfDoc.save());
  const signedPdf = await signpdf.sign(pdfWithPlaceholder, new P12Signer(certificate, { passphrase: password }));
  return Buffer.from(signedPdf);
}
