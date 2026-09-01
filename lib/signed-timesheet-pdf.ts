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

/** A4 paisagem (modelo Espaço Progredir) — 1 página por colaborador */
const PAGE_W = 841.89;
const PAGE_H = 595.28;
const MX = 18;
const MY = 14;

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
  const dark = rgb(0.1, 0.12, 0.14);
  const muted = rgb(0.35, 0.38, 0.4);
  const line = rgb(0.65, 0.68, 0.7);
  const headerBg = rgb(0.92, 0.93, 0.94);
  const green = rgb(0.05, 0.4, 0.28);
  const right = PAGE_W - MX;

  page.drawText('EP  ESPAÇO PROGREDIR', { x: MX, y: PAGE_H - MY - 2, size: 9, font: bold, color: dark });
  page.drawText('Estrada da Grama, 21 — Miguel Couto, Nova Iguaçu — RJ  ·  CNPJ 05.553.848/0001-61', {
    x: MX, y: PAGE_H - MY - 12, size: 6, font: regular, color: muted,
  });
  page.drawText('RELATÓRIO DE PONTO DO COLABORADOR', {
    x: PAGE_W / 2 - 95, y: PAGE_H - MY - 2, size: 9, font: bold, color: dark,
  });
  page.drawText(`Período: ${periodLabel}`, { x: right - 160, y: PAGE_H - MY - 2, size: 7, font: regular, color: muted });
  page.drawText(`Emissão: ${emitted}`, { x: right - 160, y: PAGE_H - MY - 12, size: 6, font: regular, color: muted });
  page.drawLine({ start: { x: MX, y: PAGE_H - MY - 18 }, end: { x: right, y: PAGE_H - MY - 18 }, thickness: 0.7, color: line });

  const infoY = PAGE_H - MY - 30;
  const jornada =
    employee.scheduleStart && employee.scheduleEnd
      ? `${employee.scheduleStart.slice(0, 5)} às ${employee.scheduleEnd.slice(0, 5)}`
      : '—';

  page.drawText(`Nome: ${employee.name}`, { x: MX, y: infoY, size: 8, font: bold, color: dark, maxWidth: 260 });
  page.drawText(`Matrícula: ${employee.employeeNumber || '—'}`, { x: MX + 270, y: infoY, size: 7.5, font: regular, color: dark });
  page.drawText(`CPF: ${employee.cpf || '—'}`, { x: MX + 380, y: infoY, size: 7.5, font: regular, color: dark });
  page.drawText(`Cargo: ${employee.jobTitle || '—'}`, { x: MX + 500, y: infoY, size: 7.5, font: regular, color: dark, maxWidth: 140 });
  page.drawText(`Departamento: ${employee.department || 'ADMINISTRATIVO'}`, { x: MX, y: infoY - 11, size: 7, font: regular, color: dark });
  page.drawText(`Unidade: ${employee.unit || 'Espaço Progredir'}`, { x: MX + 200, y: infoY - 11, size: 7, font: regular, color: dark });
  page.drawText(`Jornada: ${jornada}`, { x: MX + 380, y: infoY - 11, size: 7, font: regular, color: dark });
  page.drawLine({ start: { x: MX, y: infoY - 17 }, end: { x: right, y: infoY - 17 }, thickness: 0.5, color: line });

  const workDays = employee.workDays ? parseWorkDays(employee.workDays) : new Set(['SEG', 'TER', 'QUA', 'QUI', 'SEX']);
  const scheduleStart = minutesFromClock(employee.scheduleStart);
  const scheduleEnd = minutesFromClock(employee.scheduleEnd);
  const scheduleSpan = scheduleStart !== null && scheduleEnd !== null ? Math.max(0, scheduleEnd - scheduleStart) : null;
  const lunch = scheduleSpan !== null && scheduleSpan > 6 * 60 ? 60 : 0;
  const expectedBase = scheduleSpan === null ? null : Math.max(0, scheduleSpan - lunch);

  const cols = [MX, 70, 175, 400, 440, 480, 520, 560, 600, 645, 690, right];
  const headers = ['Data', 'Horários (escala)', 'Marcações', 'H.Trab', 'H.Just', 'H.Prev', 'H.Falt', 'H.Exc', 'Saldo', 'Desc.', 'Justificativa'];
  const tableTop = infoY - 22;
  const footerReserve = 72;
  const headerH = 12;
  const available = tableTop - footerReserve - headerH;
  const rowH = Math.min(14.2, available / lastDay);
  const fs = rowH >= 13 ? 6.5 : rowH >= 11.5 ? 6 : 5.5;

  page.drawRectangle({ x: MX, y: tableTop - headerH, width: right - MX, height: headerH, color: headerBg });
  headers.forEach((h, i) => {
    page.drawText(h, {
      x: cols[i] + 2, y: tableTop - 9, size: 5.5, font: bold, color: dark,
      maxWidth: cols[i + 1] - cols[i] - 3,
    });
  });
  page.drawLine({ start: { x: MX, y: tableTop - headerH }, end: { x: right, y: tableTop - headerH }, thickness: 0.5, color: line });

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

    const coveredByCertificate = Boolean(cert);
    const absent = configuredWorkday && !dayPunches.length && justified === 0 && approvedRequest?.type !== 'AUSENCIA';
    if (absent) absences += 1;

    const firstPunch = dayPunches[0];
    const firstMins = firstPunch ? minutesFromClock(formatTime(firstPunch.timestamp)) : null;
    const late =
      configuredWorkday && firstMins !== null && scheduleStart !== null && firstMins > scheduleStart + 5 && justified === 0;
    if (late) lateCount += 1;

    const balance = creditedWorked === null || expected === null ? null : creditedWorked - expected;
    if (balance !== null) totalBalance += balance;
    const missing = expected === null || creditedWorked === null ? null : Math.max(0, expected - creditedWorked);
    const surplus = expected === null || creditedWorked === null ? null : Math.max(0, creditedWorked - expected);

    const y = tableTop - headerH - rowH * (index + 1) + 3;
    if (index % 2 === 1) {
      page.drawRectangle({ x: MX, y: y - 2.2, width: right - MX, height: rowH, color: rgb(0.97, 0.97, 0.98) });
    }

    const horarios = !scheduled
      ? 'Folga'
      : employee.scheduleStart && employee.scheduleEnd
        ? `${employee.scheduleStart.slice(0, 5)} às ${employee.scheduleEnd.slice(0, 5)}${lunch > 0 ? ' · 1h almoço' : ' · meio exp.'}`
        : '';
    const marks = dayPunches.length
      ? dayPunches.map((p) => `${formatTime(p.timestamp)} (${shortType(p.type)})`).join('  ')
      : '—';
    const just = coveredByCertificate
      ? 'ATESTADO'
      : approvedRequest
        ? approvedRequest.type === 'AUSENCIA' ? 'AUSÊNCIA' : 'TROCA'
        : absent ? 'FALTA' : late ? 'ATRASO' : '';

    const values = [
      `${dateBr} ${weekdayLabels[weekday]}`,
      horarios,
      marks,
      formatMinutes(worked),
      formatMinutes(justified > 0 ? justified : null),
      formatMinutes(expected),
      formatMinutes(missing),
      formatMinutes(surplus),
      balance === null ? '00:00' : formatSignedMinutes(balance),
      '00:00',
      just,
    ];
    values.forEach((value, i) => {
      const maxLen = i === 2 ? 42 : i === 1 ? 28 : i === 10 ? 24 : 12;
      page.drawText(String(value).slice(0, maxLen), {
        x: cols[i] + 2, y, size: i === 2 ? Math.max(5, fs - 0.5) : fs, font: regular, color: dark,
        maxWidth: cols[i + 1] - cols[i] - 3,
      });
    });
    page.drawLine({ start: { x: MX, y: y - 2.2 }, end: { x: right, y: y - 2.2 }, thickness: 0.2, color: line });
  }

  const totY = footerReserve - 6;
  page.drawLine({ start: { x: MX, y: totY + 36 }, end: { x: right, y: totY + 36 }, thickness: 0.8, color: dark });
  page.drawText(`Total H. Positivas: ${formatMinutes(Math.max(0, totalBalance))}`, { x: MX, y: totY + 24, size: 7, font: regular, color: dark });
  page.drawText(`Total H. Negativas: ${formatMinutes(Math.max(0, -totalBalance))}`, { x: MX, y: totY + 13, size: 7, font: regular, color: dark });
  page.drawText(`Saldo de Horas: ${formatSignedMinutes(totalBalance)}`, { x: MX, y: totY + 2, size: 7.5, font: bold, color: dark });
  page.drawText(`Total trabalhado: ${formatMinutes(totalWorked)}`, { x: 220, y: totY + 24, size: 7, font: regular, color: dark });
  page.drawText(`Total previsto: ${formatMinutes(totalExpected)}`, { x: 220, y: totY + 13, size: 7, font: regular, color: dark });
  page.drawText(`Horas justificadas: ${formatMinutes(totalJustified)}`, { x: 220, y: totY + 2, size: 7, font: regular, color: dark });
  page.drawText(`Faltas: ${absences}`, { x: 420, y: totY + 24, size: 7, font: regular, color: dark });
  page.drawText(`Atrasos: ${lateCount}`, { x: 420, y: totY + 13, size: 7, font: regular, color: dark });

  page.drawRectangle({ x: MX, y: 10, width: 230, height: 28, color: rgb(0.94, 0.98, 0.95), borderColor: green, borderWidth: 0.5 });
  page.drawText('✓ Assinado digitalmente — ESPAÇO PROGREDIR', { x: MX + 4, y: 28, size: 6.5, font: bold, color: green });
  page.drawText('Certificado A1 · ICP-Brasil · CNPJ 05.553.848/0001-61', { x: MX + 4, y: 17, size: 5.5, font: regular, color: muted });
  page.drawLine({ start: { x: right - 200, y: 28 }, end: { x: right, y: 28 }, thickness: 0.6, color: muted });
  page.drawText('Assinatura do Colaborador', { x: right - 200, y: 18, size: 6.5, font: regular, color: muted });
  page.drawText(employee.name, { x: right - 200, y: 8, size: 6, font: regular, color: muted, maxWidth: 190 });

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
    signatureLength: 20000, widgetRect: [MX, 10, MX + 230, 38],
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
    signatureLength: 20000, widgetRect: [MX, 10, MX + 230, 38],
  });
  const pdfWithPlaceholder = Buffer.from(await merged.save());
  const signedPdf = await signpdf.sign(pdfWithPlaceholder, new P12Signer(certificate, { passphrase: password }));
  return Buffer.from(signedPdf);
}
