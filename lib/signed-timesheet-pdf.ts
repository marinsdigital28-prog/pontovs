import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
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
  department?: string | null;
  unit?: string | null;
};

export type TimesheetPunch = { type: string; timestamp: Date };
export type TimesheetCertificate = {
  startDate: Date; endDate: Date; startTime?: string | null; endTime?: string | null;
  hoursPerDayMinutes?: number | null; status: string;
};
export type TimesheetRequest = { type: string; startDate: Date; endDate: Date; status: string; reason: string };

/** A4 paisagem — visual limpo e profissional */
const PAGE_W = 841.89;
const PAGE_H = 595.28;
const MX = 22;
const MY = 16;

const weekdayCodes: Record<number, string> = { 0: 'DOM', 1: 'SEG', 2: 'TER', 3: 'QUA', 4: 'QUI', 5: 'SEX', 6: 'SÁB' };
const weekdayLabels = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const APP_TZ = 'America/Sao_Paulo';

function formatTime(value: Date) {
  return value.toLocaleTimeString('pt-BR', { timeZone: APP_TZ, hour: '2-digit', minute: '2-digit' });
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
  const abs = Math.abs(Math.round(value));
  return `${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}
function formatSignedMinutes(value: number | null) {
  if (value === null) return '—';
  const sign = value < 0 ? '−' : value > 0 ? '+' : '';
  return `${sign}${formatMinutes(Math.abs(value))}`;
}
function rowDayKey(value: Date) {
  return value.toLocaleDateString('en-CA', { timeZone: APP_TZ });
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

async function buildTimesheetDocument({
  employee, punches, certificates = [], requests = [], month,
}: {
  employee: TimesheetEmployee;
  punches: TimesheetPunch[];
  certificates?: TimesheetCertificate[];
  requests?: TimesheetRequest[];
  month: string;
}) {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  const emitted = new Date().toLocaleDateString('pt-BR', { timeZone: APP_TZ });

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const dark = rgb(0.12, 0.14, 0.16);
  const muted = rgb(0.45, 0.48, 0.5);
  const soft = rgb(0.88, 0.9, 0.91);
  const green = rgb(0.06, 0.35, 0.26);
  const altRow = rgb(0.965, 0.975, 0.97);
  const right = PAGE_W - MX;

  page.drawText('ESPAÇO PROGREDIR', { x: MX, y: PAGE_H - MY - 4, size: 11, font: bold, color: green });
  page.drawText('Relatório de ponto', { x: MX, y: PAGE_H - MY - 16, size: 8, font: regular, color: muted });
  page.drawText(`01/${String(monthNumber).padStart(2, '0')}/${year} – ${String(lastDay).padStart(2, '0')}/${String(monthNumber).padStart(2, '0')}/${year}`, { x: right - 175, y: PAGE_H - MY - 4, size: 8, font: bold, color: dark });
  page.drawText(`Emitido em ${emitted}`, { x: right - 175, y: PAGE_H - MY - 16, size: 7, font: regular, color: muted });
  page.drawRectangle({ x: MX, y: PAGE_H - MY - 22, width: right - MX, height: 1.2, color: green });

  const infoY = PAGE_H - MY - 36;
  const jornada =
    employee.scheduleStart && employee.scheduleEnd
      ? `${employee.scheduleStart.slice(0, 5)}–${employee.scheduleEnd.slice(0, 5)}`
      : '—';

  page.drawText(employee.name, { x: MX, y: infoY, size: 10, font: bold, color: dark, maxWidth: 280 });
  page.drawText(
    `Mat. ${employee.employeeNumber || '—'}  ·  CPF ${employee.cpf || '—'}  ·  ${employee.jobTitle || 'Colaborador'}`,
    { x: MX, y: infoY - 12, size: 7, font: regular, color: muted, maxWidth: 420 },
  );
  page.drawText(
    `${employee.department || 'Administrativo'}  ·  Jornada ${jornada}  ·  CNPJ 05.553.848/0001-61`,
    { x: MX, y: infoY - 23, size: 7, font: regular, color: muted },
  );

  const workDays = employee.workDays ? parseWorkDays(employee.workDays) : new Set(['SEG', 'TER', 'QUA', 'QUI', 'SEX']);
  const scheduleStart = minutesFromClock(employee.scheduleStart);
  const scheduleEnd = minutesFromClock(employee.scheduleEnd);
  const scheduleSpan = scheduleStart !== null && scheduleEnd !== null ? Math.max(0, scheduleEnd - scheduleStart) : null;
  const lunch = scheduleSpan !== null && scheduleSpan > 6 * 60 ? 60 : 0;
  const expectedBase = scheduleSpan === null ? null : Math.max(0, scheduleSpan - lunch);

  const cols = [MX, 72, 155, 400, 455, 510, 565, 620, right];
  const headers = ['Data', 'Escala', 'Marcações', 'Trab.', 'Prev.', 'Just.', 'Saldo', 'Situação'];
  const tableTop = infoY - 36;
  const footerReserve = 78;
  const headerH = 14;
  const available = tableTop - footerReserve - headerH;
  const rowH = Math.min(14, available / lastDay);
  const fs = rowH >= 13 ? 7 : rowH >= 11.5 ? 6.5 : 6;

  page.drawRectangle({ x: MX, y: tableTop - headerH, width: right - MX, height: headerH, color: green });
  headers.forEach((h, i) => {
    page.drawText(h, {
      x: cols[i] + 3, y: tableTop - 10, size: 6.5, font: bold, color: rgb(1, 1, 1),
      maxWidth: cols[i + 1] - cols[i] - 4,
    });
  });

  let totalWorked = 0;
  let totalExpected = 0;
  let totalBalance = 0;
  let totalJustified = 0;
  let absences = 0;
  let lateCount = 0;

  for (let index = 0; index < lastDay; index += 1) {
    const date = new Date(year, monthNumber - 1, index + 1, 12, 0, 0);
    const dateKey = `${year}-${String(monthNumber).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`;
    const dateBr = `${String(index + 1).padStart(2, '0')}/${String(monthNumber).padStart(2, '0')}`;
    const rawDayPunches = punches.filter((p) => rowDayKey(p.timestamp) === dateKey);
    const dayCerts = certificates.map((c) => ({
      userId: '', startDate: c.startDate, endDate: c.endDate, startTime: c.startTime, endTime: c.endTime, status: c.status,
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

    const cert = certificates.find((item) => {
      if (item.status !== 'APROVADO' && item.status !== 'ATIVO') return false;
      return rowDayKey(item.startDate) <= dateKey && rowDayKey(item.endDate) >= dateKey;
    });
    const certificateMinutes = cert
      ? cert.startTime && cert.endTime
        ? Math.max(0, (minutesFromClock(cert.endTime) || 0) - (minutesFromClock(cert.startTime) || 0))
        : expected || 0
      : 0;

    const approvedRequest = requests.find(
      (item) =>
        item.status === 'APROVADO' &&
        ((item.type === 'AUSENCIA' && rowDayKey(item.startDate) <= dateKey && rowDayKey(item.endDate) >= dateKey) ||
          (item.type === 'TROCA_DIA' && (rowDayKey(item.startDate) === dateKey || rowDayKey(item.endDate) === dateKey))),
    );

    const justified =
      certificateMinutes > 0 ? certificateMinutes : approvedRequest?.type === 'AUSENCIA' ? expected || 0 : 0;
    const creditedWorked = worked === null ? (justified > 0 ? justified : null) : worked + justified;

    if (creditedWorked !== null) totalWorked += creditedWorked;
    if (expected !== null) totalExpected += expected;
    if (justified > 0) totalJustified += justified;

    const absent = configuredWorkday && !dayPunches.length && justified === 0 && approvedRequest?.type !== 'AUSENCIA';
    if (absent) absences += 1;

    const firstPunch = dayPunches[0];
    const firstMins = firstPunch ? minutesFromClock(formatTime(firstPunch.timestamp)) : null;
    const late =
      configuredWorkday && firstMins !== null && scheduleStart !== null && firstMins > scheduleStart + 5 && justified === 0;
    if (late) lateCount += 1;

    const balance = creditedWorked === null || expected === null ? null : creditedWorked - expected;
    if (balance !== null) totalBalance += balance;

    const y = tableTop - headerH - rowH * (index + 1) + 3.5;
    if (index % 2 === 1) {
      page.drawRectangle({ x: MX, y: y - 3, width: right - MX, height: rowH, color: altRow });
    }

    const marks = dayPunches.length
      ? dayPunches.map((p) => `${formatTime(p.timestamp)}${shortType(p.type)}`).join(' ')
      : '';
    let justificativa = '';
    if (cert) justificativa = 'Atestado';
    else if (approvedRequest?.type === 'AUSENCIA') justificativa = 'Ausência';
    else if (approvedRequest?.type === 'TROCA_DIA') justificativa = 'Troca';
    else if (absent) justificativa = 'Falta';
    else if (late) justificativa = 'Atraso';

    const escala = !scheduled
      ? 'Folga'
      : employee.scheduleStart && employee.scheduleEnd
        ? `${employee.scheduleStart.slice(0, 5)}–${employee.scheduleEnd.slice(0, 5)}`
        : '—';
    const values = [
      `${dateBr} ${weekdayLabels[weekday]}`,
      escala,
      marks || (absent ? '—' : ''),
      formatMinutes(creditedWorked),
      formatMinutes(expected),
      justified > 0 ? formatMinutes(justified) : '—',
      formatSignedMinutes(balance),
      justificativa || (!scheduled ? 'Folga' : dayPunches.length ? 'OK' : ''),
    ];
    values.forEach((value, i) => {
      const maxLen = i === 2 ? 48 : i === 1 ? 14 : i === 7 ? 12 : 10;
      page.drawText(String(value).slice(0, maxLen), {
        x: cols[i] + 3, y, size: i === 2 ? Math.max(5.5, fs - 0.5) : fs, font: regular, color: dark,
        maxWidth: cols[i + 1] - cols[i] - 5,
      });
    });
  }

  const tableBottom = tableTop - headerH - lastDay * rowH;
  page.drawLine({ start: { x: MX, y: tableBottom }, end: { x: right, y: tableBottom }, thickness: 0.5, color: soft });
  page.drawLine({ start: { x: MX, y: tableTop }, end: { x: MX, y: tableBottom }, thickness: 0.4, color: soft });
  page.drawLine({ start: { x: right, y: tableTop }, end: { x: right, y: tableBottom }, thickness: 0.4, color: soft });

  const sumY = tableBottom - 16;
  page.drawText(`Trabalhado ${formatMinutes(totalWorked)}`, { x: MX, y: sumY, size: 7.5, font: regular, color: dark });
  page.drawText(`Previsto ${formatMinutes(totalExpected)}`, { x: MX + 120, y: sumY, size: 7.5, font: regular, color: dark });
  page.drawText(`Justificado ${formatMinutes(totalJustified)}`, { x: MX + 230, y: sumY, size: 7.5, font: regular, color: dark });
  page.drawText(`Saldo ${formatSignedMinutes(totalBalance)}`, { x: MX + 360, y: sumY, size: 8, font: bold, color: green });
  page.drawText(`Faltas ${absences}  ·  Atrasos ${lateCount}`, { x: MX + 470, y: sumY, size: 7.5, font: regular, color: muted });

  page.drawLine({ start: { x: right - 200, y: 36 }, end: { x: right - 20, y: 36 }, thickness: 0.5, color: soft });
  page.drawText('Assinatura do colaborador', { x: right - 175, y: 26, size: 6.5, font: regular, color: muted });
  page.drawText(employee.name, { x: right - 200, y: 16, size: 6, font: regular, color: muted, maxWidth: 175 });

  page.drawRectangle({ x: MX, y: 12, width: 220, height: 26, borderColor: green, borderWidth: 0.8 });
  page.drawText('Assinado digitalmente', { x: MX + 8, y: 26, size: 7, font: bold, color: green });
  page.drawText('Espaço Progredir · Certificado A1', { x: MX + 8, y: 16, size: 6, font: regular, color: muted });

  return { pdfDoc, page };
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
  const { pdfDoc, page } = await buildTimesheetDocument({ employee, punches, certificates, requests, month });
  pdflibAddPlaceholder({
    pdfDoc, pdfPage: page,
    reason: 'Assinatura institucional da Folha de Ponto',
    contactInfo: 'Espaço Progredir', name: 'Espaço Progredir', location: 'Nova Iguaçu - RJ',
    signatureLength: 20000, widgetRect: [MX, 10, MX + 220, 40],
  });
  const pdfWithPlaceholder = Buffer.from(await pdfDoc.save());
  const signedPdf = await signpdf.sign(pdfWithPlaceholder, new P12Signer(certificate, { passphrase: password }));
  return Buffer.from(signedPdf);
}

export async function createSignedTimesheetPdfBatch({
  items, month, certificate, password,
}: {
  items: Array<{
    employee: TimesheetEmployee;
    punches: TimesheetPunch[];
    certificates?: TimesheetCertificate[];
    requests?: TimesheetRequest[];
  }>;
  month: string;
  certificate: Buffer;
  password: string;
}) {
  if (!items.length) throw new Error('Nenhum colaborador para gerar folha');
  if (items.length === 1) {
    return createSignedTimesheetPdf({ ...items[0], month, certificate, password });
  }

  const merged = await PDFDocument.create();
  let lastPage: ReturnType<PDFDocument['addPage']> | null = null;

  for (const item of items) {
    const { pdfDoc: single } = await buildTimesheetDocument({ ...item, month });
    const bytes = await single.save();
    const src = await PDFDocument.load(bytes);
    const pages = await merged.copyPages(src, src.getPageIndices());
    for (const p of pages) {
      merged.addPage(p);
      lastPage = p;
    }
  }

  if (!lastPage) throw new Error('Falha ao montar PDF em lote');

  pdflibAddPlaceholder({
    pdfDoc: merged, pdfPage: lastPage,
    reason: 'Assinatura institucional da Folha de Ponto (lote)',
    contactInfo: 'Espaço Progredir', name: 'Espaço Progredir', location: 'Nova Iguaçu - RJ',
    signatureLength: 20000, widgetRect: [MX, 10, MX + 220, 40],
  });
  const pdfWithPlaceholder = Buffer.from(await merged.save());
  const signedPdf = await signpdf.sign(pdfWithPlaceholder, new P12Signer(certificate, { passphrase: password }));
  return Buffer.from(signedPdf);
}
