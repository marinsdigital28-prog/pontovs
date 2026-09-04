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

/** A4 paisagem — layout inspirado no modelo profissional, padrão Espaço Progredir */
const PAGE_W = 841.89;
const PAGE_H = 595.28;
const MX = 16;
const MY = 12;

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
  if (value === null) return '00:00';
  const abs = Math.abs(Math.round(value));
  return `${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}
function formatSignedMinutes(value: number | null) {
  if (value === null) return '00:00';
  const sign = value < 0 ? '-' : value > 0 ? '+' : '';
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
  const periodLabel = `01/${String(monthNumber).padStart(2, '0')}/${year} até ${String(lastDay).padStart(2, '0')}/${String(monthNumber).padStart(2, '0')}/${year}`;
  const emitted = new Date().toLocaleString('pt-BR', { timeZone: APP_TZ });

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const dark = rgb(0.08, 0.1, 0.12);
  const muted = rgb(0.38, 0.4, 0.42);
  const line = rgb(0.72, 0.74, 0.76);
  const grid = rgb(0.82, 0.84, 0.85);
  const headerBg = rgb(0.94, 0.95, 0.96);
  const green = rgb(0.05, 0.4, 0.28);
  const altRow = rgb(0.97, 0.98, 0.98);
  const right = PAGE_W - MX;

  page.drawText('Espaço Progredir', { x: MX, y: PAGE_H - MY - 2, size: 10, font: bold, color: green });
  page.drawText('|  Relatório de Ponto do Colaborador', { x: MX + 88, y: PAGE_H - MY - 2, size: 9, font: regular, color: dark });
  page.drawText(`Data de Emissão: ${emitted}`, { x: right - 195, y: PAGE_H - MY - 2, size: 6.5, font: regular, color: muted });
  page.drawText(`Período: ${periodLabel}`, { x: right - 195, y: PAGE_H - MY - 11, size: 6.5, font: regular, color: muted });
  page.drawLine({ start: { x: MX, y: PAGE_H - MY - 16 }, end: { x: right, y: PAGE_H - MY - 16 }, thickness: 0.8, color: dark });

  const infoY = PAGE_H - MY - 28;
  const jornada =
    employee.scheduleStart && employee.scheduleEnd
      ? `${employee.scheduleStart.slice(0, 5)} às ${employee.scheduleEnd.slice(0, 5)}`
      : '—';
  const baseHoras =
    employee.scheduleStart && employee.scheduleEnd
      ? (() => {
          const a = minutesFromClock(employee.scheduleStart);
          const b = minutesFromClock(employee.scheduleEnd);
          if (a === null || b === null) return '—';
          const span = Math.max(0, b - a);
          const lunch = span > 6 * 60 ? 60 : 0;
          return formatMinutes(span - lunch);
        })()
      : '—';

  const col1 = MX;
  const col2 = MX + 280;
  const col3 = MX + 520;
  page.drawText('Empregado', { x: col1, y: infoY, size: 6.5, font: bold, color: muted });
  page.drawText(`Nome: ${employee.name}`, { x: col1, y: infoY - 10, size: 7.5, font: bold, color: dark, maxWidth: 270 });
  page.drawText(`Matrícula: ${employee.employeeNumber || '—'}`, { x: col1, y: infoY - 20, size: 7, font: regular, color: dark });
  page.drawText(`Departamento: ${employee.department || 'ADMINISTRATIVO'}`, { x: col1, y: infoY - 30, size: 7, font: regular, color: dark });

  page.drawText('Cargo / Documentos', { x: col2, y: infoY, size: 6.5, font: bold, color: muted });
  page.drawText(`Cargo: ${employee.jobTitle || '—'}`, { x: col2, y: infoY - 10, size: 7, font: regular, color: dark, maxWidth: 230 });
  page.drawText(`CPF: ${employee.cpf || '—'}`, { x: col2, y: infoY - 20, size: 7, font: regular, color: dark });
  page.drawText(`Base de Horas: ${baseHoras}`, { x: col2, y: infoY - 30, size: 7, font: regular, color: dark });
  page.drawText(`Jornada: ${jornada}`, { x: col2, y: infoY - 40, size: 7, font: regular, color: dark });

  page.drawText('Empresa', { x: col3, y: infoY, size: 6.5, font: bold, color: muted });
  page.drawText('Espaço Progredir', { x: col3, y: infoY - 10, size: 7.5, font: bold, color: dark });
  page.drawText('Estrada da Grama, 21 — Miguel Couto', { x: col3, y: infoY - 20, size: 6.5, font: regular, color: muted, maxWidth: 200 });
  page.drawText('Nova Iguaçu — RJ', { x: col3, y: infoY - 30, size: 6.5, font: regular, color: muted });
  page.drawText('CNPJ: 05.553.848/0001-61', { x: col3, y: infoY - 40, size: 6.5, font: regular, color: muted });

  page.drawLine({ start: { x: MX, y: infoY - 48 }, end: { x: right, y: infoY - 48 }, thickness: 0.5, color: line });

  const workDays = employee.workDays ? parseWorkDays(employee.workDays) : new Set(['SEG', 'TER', 'QUA', 'QUI', 'SEX']);
  const scheduleStart = minutesFromClock(employee.scheduleStart);
  const scheduleEnd = minutesFromClock(employee.scheduleEnd);
  const scheduleSpan = scheduleStart !== null && scheduleEnd !== null ? Math.max(0, scheduleEnd - scheduleStart) : null;
  const lunch = scheduleSpan !== null && scheduleSpan > 6 * 60 ? 60 : 0;
  const expectedBase = scheduleSpan === null ? null : Math.max(0, scheduleSpan - lunch);

  const cols = [MX, 78, 168, 360, 410, 458, 506, 554, 612, 662, right];
  const headers = ['Data Marcação', 'Horários', 'Marcações', 'H.Trab', 'H.Prev', 'H.Just', 'Saldo', 'Banco de Horas', 'Descontos', 'Justificativa'];
  const tableTop = infoY - 54;
  const footerReserve = 88;
  const headerH = 11;
  const available = tableTop - footerReserve - headerH;
  const rowH = Math.min(13.5, available / lastDay);
  const fs = rowH >= 12.5 ? 6.5 : rowH >= 11 ? 6 : 5.5;

  page.drawRectangle({ x: MX, y: tableTop - headerH, width: right - MX, height: headerH, color: headerBg });
  headers.forEach((h, i) => {
    page.drawText(h, {
      x: cols[i] + 2, y: tableTop - 8, size: 5.5, font: bold, color: dark,
      maxWidth: cols[i + 1] - cols[i] - 3,
    });
  });
  page.drawLine({ start: { x: MX, y: tableTop }, end: { x: right, y: tableTop }, thickness: 0.7, color: dark });
  page.drawLine({ start: { x: MX, y: tableTop - headerH }, end: { x: right, y: tableTop - headerH }, thickness: 0.5, color: line });

  let totalWorked = 0;
  let totalExpected = 0;
  let totalBalance = 0;
  let totalJustified = 0;
  let absences = 0;
  let lateCount = 0;
  let bankMinutes = 0;

  for (let index = 0; index < lastDay; index += 1) {
    const date = new Date(year, monthNumber - 1, index + 1, 12, 0, 0);
    const dateKey = `${year}-${String(monthNumber).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`;
    const dateBr = `${String(index + 1).padStart(2, '0')}/${String(monthNumber).padStart(2, '0')}/${year}`;
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
    if (balance !== null) {
      totalBalance += balance;
      bankMinutes += balance;
    }
    const discount = expected === null || creditedWorked === null ? null : Math.max(0, expected - creditedWorked);

    const y = tableTop - headerH - rowH * (index + 1) + 3;
    if (index % 2 === 1) {
      page.drawRectangle({ x: MX, y: y - 2.2, width: right - MX, height: rowH, color: altRow });
    }

    const horarios = !scheduled
      ? 'Feriado / Folga'
      : employee.scheduleStart && employee.scheduleEnd
        ? `${employee.scheduleStart.slice(0, 5)} a ${employee.scheduleEnd.slice(0, 5)}${lunch > 0 ? ' (1:00)' : ''}`
        : '';
    const marks = dayPunches.length
      ? dayPunches.map((p) => `${formatTime(p.timestamp)} (${shortType(p.type)})`).join('  ')
      : '';
    let justificativa = '';
    if (cert) justificativa = 'Atestado';
    else if (approvedRequest?.type === 'AUSENCIA') justificativa = 'Ausência aprovada';
    else if (approvedRequest?.type === 'TROCA_DIA') justificativa = 'Troca de dia';
    else if (absent) justificativa = 'Falta';
    else if (late) justificativa = 'Atraso';

    const values = [
      `${dateBr} ${weekdayLabels[weekday]}`,
      horarios,
      marks || (absent ? '—' : !scheduled ? '' : '—'),
      formatMinutes(creditedWorked),
      formatMinutes(expected),
      formatMinutes(justified > 0 ? justified : 0),
      formatSignedMinutes(balance),
      formatSignedMinutes(bankMinutes),
      formatMinutes(discount),
      justificativa,
    ];
    values.forEach((value, i) => {
      const maxLen = i === 2 ? 44 : i === 1 ? 28 : i === 9 ? 22 : 12;
      page.drawText(String(value).slice(0, maxLen), {
        x: cols[i] + 2, y, size: i === 2 ? Math.max(5, fs - 0.5) : fs, font: regular, color: dark,
        maxWidth: cols[i + 1] - cols[i] - 3,
      });
    });
    page.drawLine({ start: { x: MX, y: y - 2.2 }, end: { x: right, y: y - 2.2 }, thickness: 0.25, color: grid });
  }

  const tableBottom = tableTop - headerH - lastDay * rowH;
  page.drawLine({ start: { x: MX, y: tableTop }, end: { x: MX, y: tableBottom }, thickness: 0.6, color: dark });
  page.drawLine({ start: { x: right, y: tableTop }, end: { x: right, y: tableBottom }, thickness: 0.6, color: dark });
  for (let ci = 1; ci < cols.length - 1; ci += 1) {
    page.drawLine({ start: { x: cols[ci], y: tableTop }, end: { x: cols[ci], y: tableBottom }, thickness: 0.25, color: grid });
  }
  page.drawLine({ start: { x: MX, y: tableBottom }, end: { x: right, y: tableBottom }, thickness: 0.7, color: dark });

  const totY = tableBottom - 12;
  page.drawRectangle({ x: MX, y: totY - 2, width: right - MX, height: 12, color: headerBg });
  page.drawText('Totais:', { x: MX + 2, y: totY + 1, size: 6.5, font: bold, color: dark });
  page.drawText(formatMinutes(totalWorked), { x: cols[3] + 2, y: totY + 1, size: 6.5, font: bold, color: dark });
  page.drawText(formatMinutes(totalExpected), { x: cols[4] + 2, y: totY + 1, size: 6.5, font: bold, color: dark });
  page.drawText(formatMinutes(totalJustified), { x: cols[5] + 2, y: totY + 1, size: 6.5, font: bold, color: dark });
  page.drawText(formatSignedMinutes(totalBalance), { x: cols[6] + 2, y: totY + 1, size: 6.5, font: bold, color: dark });
  page.drawText(formatSignedMinutes(bankMinutes), { x: cols[7] + 2, y: totY + 1, size: 6.5, font: bold, color: dark });

  const sumY = totY - 22;
  page.drawText(`Total H. Positiva: ${formatMinutes(Math.max(0, totalBalance))}`, { x: MX, y: sumY, size: 6.5, font: regular, color: dark });
  page.drawText(`Total H. Negativa: ${formatMinutes(Math.max(0, -totalBalance))}`, { x: MX, y: sumY - 10, size: 6.5, font: regular, color: dark });
  page.drawText(`Saldo de Horas: ${formatSignedMinutes(totalBalance)}`, { x: MX, y: sumY - 20, size: 7, font: bold, color: dark });

  page.drawText(`Banco de Horas: ${formatSignedMinutes(bankMinutes)}`, { x: MX + 200, y: sumY, size: 6.5, font: regular, color: dark });
  page.drawText(`Faltas: ${absences}:00`, { x: MX + 200, y: sumY - 10, size: 6.5, font: regular, color: dark });
  page.drawText(`Atrasos: ${lateCount}:00`, { x: MX + 200, y: sumY - 20, size: 6.5, font: regular, color: dark });

  page.drawText('Concordo com as marcações acima registradas', { x: right - 230, y: sumY, size: 6.5, font: regular, color: muted });
  page.drawLine({ start: { x: right - 180, y: sumY - 22 }, end: { x: right - 10, y: sumY - 22 }, thickness: 0.6, color: muted });
  page.drawText('Assinatura do Colaborador', { x: right - 160, y: sumY - 32, size: 6, font: regular, color: muted });
  page.drawText(employee.name, { x: right - 180, y: sumY - 42, size: 5.5, font: regular, color: muted, maxWidth: 170 });

  page.drawRectangle({ x: MX, y: 8, width: 248, height: 28, color: rgb(0.94, 0.98, 0.95), borderColor: green, borderWidth: 0.7 });
  page.drawText('ASSINADO DIGITALMENTE - ESPACO PROGREDIR', { x: MX + 6, y: 24, size: 6.5, font: bold, color: green });
  page.drawText('Certificado A1 · ICP-Brasil · CNPJ 05.553.848/0001-61', { x: MX + 6, y: 13, size: 5.5, font: regular, color: muted });

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
    signatureLength: 20000, widgetRect: [MX, 6, MX + 250, 38],
  });
  const pdfWithPlaceholder = Buffer.from(await pdfDoc.save());
  const signedPdf = await signpdf.sign(pdfWithPlaceholder, new P12Signer(certificate, { passphrase: password }));
  return Buffer.from(signedPdf);
}

/** Um PDF multipágina: 1 página A4 horizontal por colaborador (padrão Progredir). */
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
    signatureLength: 20000, widgetRect: [MX, 6, MX + 250, 38],
  });
  const pdfWithPlaceholder = Buffer.from(await merged.save());
  const signedPdf = await signpdf.sign(pdfWithPlaceholder, new P12Signer(certificate, { passphrase: password }));
  return Buffer.from(signedPdf);
}
