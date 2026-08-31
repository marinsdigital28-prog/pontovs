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
};

export type TimesheetPunch = { type: string; timestamp: Date };
export type TimesheetCertificate = {
  startDate: Date; endDate: Date; startTime?: string | null; endTime?: string | null;
  hoursPerDayMinutes?: number | null; status: string;
};
export type TimesheetRequest = { type: string; startDate: Date; endDate: Date; status: string; reason: string };

/** A4 retrato (como Apponte.me) — 1 página */
const PAGE_W = 595.28; // 210mm
const PAGE_H = 841.89; // 297mm
const MX = 22;

const weekdayCodes: Record<number, string> = { 0: 'DOM', 1: 'SEG', 2: 'TER', 3: 'QUA', 4: 'QUI', 5: 'SEX', 6: 'SÁB' };
const weekdayShort = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const monthNames = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
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
  const periodLabel = `01/${String(monthNumber).padStart(2, '0')}/${year} até ${String(lastDay).padStart(2, '0')}/${String(monthNumber).padStart(2, '0')}/${year}`;
  const emitted = new Date().toLocaleString('pt-BR', { timeZone: APP_TZ });

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const dark = rgb(0.12, 0.14, 0.16);
  const muted = rgb(0.35, 0.38, 0.4);
  const line = rgb(0.7, 0.72, 0.74);
  const headerBg = rgb(0.93, 0.94, 0.95);
  const green = rgb(0.05, 0.4, 0.28);
  const right = PAGE_W - MX;

  // —— Cabeçalho estilo Apponte ——
  page.drawText('Espaço Progredir  |  Relatório de Ponto do Colaborador', {
    x: MX, y: PAGE_H - 28, size: 10, font: bold, color: dark,
  });
  page.drawText(`Data de Emissão: ${emitted}  ·  Período: ${periodLabel}`, {
    x: MX, y: PAGE_H - 40, size: 7, font: regular, color: muted,
  });
  page.drawLine({ start: { x: MX, y: PAGE_H - 46 }, end: { x: right, y: PAGE_H - 46 }, thickness: 0.6, color: line });

  // Bloco empregado / cargo / empresa
  const boxY = PAGE_H - 108;
  page.drawText('Empregado', { x: MX, y: PAGE_H - 58, size: 7, font: bold, color: muted });
  page.drawText(`Nome: ${employee.name}`, { x: MX, y: PAGE_H - 70, size: 8, font: bold, color: dark, maxWidth: 200 });
  page.drawText(`Matrícula: ${employee.employeeNumber || '—'}`, { x: MX, y: PAGE_H - 82, size: 7.5, font: regular, color: dark });
  page.drawText('Departamento: ADMINISTRATIVO', { x: MX, y: PAGE_H - 94, size: 7.5, font: regular, color: dark });

  page.drawText('Cargo:', { x: 230, y: PAGE_H - 58, size: 7, font: bold, color: muted });
  page.drawText(employee.jobTitle || '—', { x: 230, y: PAGE_H - 70, size: 8, font: bold, color: dark, maxWidth: 140 });
  page.drawText(`CPF: ${employee.cpf || '—'}`, { x: 230, y: PAGE_H - 82, size: 7.5, font: regular, color: dark });
  page.drawText('Data de Admissão: —', { x: 230, y: PAGE_H - 94, size: 7.5, font: regular, color: dark });

  page.drawText('Empresa', { x: 400, y: PAGE_H - 58, size: 7, font: bold, color: muted });
  page.drawText('Espaço Progredir', { x: 400, y: PAGE_H - 70, size: 8, font: bold, color: dark });
  page.drawText('Estrada da Grama, 21 — Miguel Couto', { x: 400, y: PAGE_H - 82, size: 6.5, font: regular, color: dark, maxWidth: 170 });
  page.drawText('Nova Iguaçu — RJ', { x: 400, y: PAGE_H - 92, size: 6.5, font: regular, color: dark });
  page.drawText('CNPJ: 05.553.848/0001-61', { x: 400, y: PAGE_H - 102, size: 6.5, font: regular, color: dark });

  page.drawLine({ start: { x: MX, y: boxY }, end: { x: right, y: boxY }, thickness: 0.6, color: line });

  const workDays = employee.workDays ? parseWorkDays(employee.workDays) : new Set(['SEG', 'TER', 'QUA', 'QUI', 'SEX']);
  const scheduleStart = minutesFromClock(employee.scheduleStart);
  const scheduleEnd = minutesFromClock(employee.scheduleEnd);
  const scheduleSpan = scheduleStart !== null && scheduleEnd !== null ? Math.max(0, scheduleEnd - scheduleStart) : null;
  const lunch = scheduleSpan !== null && scheduleSpan > 6 * 60 ? 60 : 0;
  const expectedBase = scheduleSpan === null ? null : Math.max(0, scheduleSpan - lunch);

  // Colunas no estilo Apponte
  // Data | Horários | Marcações | H.Trab | H.Prev | H.T.C | Saldo | Banco | Descontos | Justificativa
  const cols = [MX, 78, 148, 268, 308, 348, 388, 430, 478, 528, right];
  const headers = ['Data Marcação', 'Horários', 'Marcações', 'H.Trab', 'H.Prev', 'H.T.C.', 'Saldo', 'Banco de Horas', 'Descontos', 'Justificativa'];

  const tableTop = boxY - 8;
  const footerReserve = 95;
  const headerH = 14;
  const rowH = Math.min(18, (tableTop - footerReserve - headerH) / lastDay);
  const fs = rowH >= 16 ? 7 : rowH >= 14 ? 6.5 : 6;

  // Cabeçalho da tabela
  page.drawRectangle({ x: MX, y: tableTop - headerH, width: right - MX, height: headerH, color: headerBg });
  headers.forEach((h, i) => {
    page.drawText(h, {
      x: cols[i] + 2,
      y: tableTop - 10,
      size: 5.5,
      font: bold,
      color: dark,
      maxWidth: cols[i + 1] - cols[i] - 3,
    });
  });
  page.drawLine({ start: { x: MX, y: tableTop - headerH }, end: { x: right, y: tableTop - headerH }, thickness: 0.5, color: line });

  let totalWorked = 0;
  let totalExpected = 0;
  let totalBalance = 0;
  let absences = 0;
  let bank = 0;

  for (let index = 0; index < lastDay; index += 1) {
    const date = new Date(year, monthNumber - 1, index + 1, 12, 0, 0);
    const dateKey = `${year}-${String(monthNumber).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`;
    const dateBr = `${String(index + 1).padStart(2, '0')}/${String(monthNumber).padStart(2, '0')}/${year}`;

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

    const balance = creditedWorked === null || expected === null ? null : creditedWorked - expected;
    if (balance !== null) {
      totalBalance += balance;
      bank += balance;
    }

    const y = tableTop - headerH - rowH * (index + 1) + 3;
    if (index % 2 === 1) {
      page.drawRectangle({
        x: MX, y: y - 2.5, width: right - MX, height: rowH,
        color: rgb(0.97, 0.97, 0.98),
      });
    }

    const horarios = !scheduled
      ? ''
      : employee.scheduleStart && employee.scheduleEnd
        ? `${employee.scheduleStart.slice(0, 5)} a ${employee.scheduleEnd.slice(0, 5)}  (01:00)`
        : '';
    const marks = dayPunches.length
      ? dayPunches.map((p) => `${formatTime(p.timestamp)}`).join(' ')
      : '';
    const htc = expected !== null ? formatMinutes(expected) : '00:00'; // horas a cumprir
    const desconto = absent && expected ? formatMinutes(expected) : balance !== null && balance < 0 ? formatMinutes(Math.abs(balance)) : '';
    const just = coveredByCertificate
      ? 'ATESTADO'
      : approvedRequest
        ? approvedRequest.type === 'AUSENCIA' ? 'AUSÊNCIA' : 'TROCA'
        : absent ? 'FALTA' : '';

    const values = [
      `${dateBr} ${weekdayShort[weekday]}`,
      horarios,
      marks,
      formatMinutes(creditedWorked),
      formatMinutes(expected),
      htc,
      balance === null ? '00:00' : formatSignedMinutes(balance),
      balance === null ? '00:00' : formatSignedMinutes(balance),
      desconto,
      just,
    ];

    values.forEach((value, i) => {
      page.drawText(String(value).slice(0, i === 2 ? 28 : 18), {
        x: cols[i] + 2,
        y,
        size: i === 2 ? Math.max(5.2, fs - 0.5) : fs,
        font: regular,
        color: dark,
        maxWidth: cols[i + 1] - cols[i] - 3,
      });
    });

    page.drawLine({
      start: { x: MX, y: y - 2.5 },
      end: { x: right, y: y - 2.5 },
      thickness: 0.25,
      color: line,
    });
  }

  // Totais
  const totY = footerReserve - 8;
  page.drawLine({ start: { x: MX, y: totY + 28 }, end: { x: right, y: totY + 28 }, thickness: 0.8, color: dark });
  page.drawText('Totais:', { x: cols[2] + 2, y: totY + 18, size: 7, font: bold, color: dark });
  page.drawText(formatMinutes(totalWorked), { x: cols[3] + 2, y: totY + 18, size: 7, font: bold, color: dark });
  page.drawText(formatMinutes(totalExpected), { x: cols[4] + 2, y: totY + 18, size: 7, font: bold, color: dark });
  page.drawText(formatMinutes(totalExpected), { x: cols[5] + 2, y: totY + 18, size: 7, font: bold, color: dark });
  page.drawText(formatSignedMinutes(totalBalance), { x: cols[6] + 2, y: totY + 18, size: 7, font: bold, color: dark });
  page.drawText(formatSignedMinutes(bank), { x: cols[7] + 2, y: totY + 18, size: 7, font: bold, color: dark });

  page.drawText(`Total H. Positivas: ${formatMinutes(Math.max(0, totalBalance))}`, {
    x: MX, y: totY + 4, size: 7, font: regular, color: dark,
  });
  page.drawText(`Total H. Negativas: ${formatMinutes(Math.max(0, -totalBalance))}`, {
    x: MX, y: totY - 8, size: 7, font: regular, color: dark,
  });
  page.drawText(`Saldo de Horas: ${formatSignedMinutes(totalBalance)}`, {
    x: MX, y: totY - 20, size: 7, font: bold, color: dark,
  });
  page.drawText(`Banco de Horas: ${formatSignedMinutes(bank)}`, {
    x: 220, y: totY + 4, size: 7, font: regular, color: dark,
  });
  page.drawText(`Faltas: ${String(absences).padStart(2, '0')}:00`, {
    x: 220, y: totY - 8, size: 7, font: regular, color: dark,
  });
  page.drawText('Atrasos: 00:00', { x: 220, y: totY - 20, size: 7, font: regular, color: dark });

  page.drawText('Concordo com as marcações acima registradas', {
    x: 400, y: totY + 4, size: 6.5, font: regular, color: muted, maxWidth: 160,
  });

  // Assinatura
  page.drawLine({ start: { x: 400, y: 42 }, end: { x: right, y: 42 }, thickness: 0.6, color: muted });
  page.drawText('Assinatura do Colaborador', { x: 400, y: 32, size: 6.5, font: regular, color: muted });
  page.drawText(employee.name, { x: 400, y: 22, size: 6, font: regular, color: muted, maxWidth: 160 });

  page.drawRectangle({
    x: MX, y: 18, width: 250, height: 22,
    color: rgb(0.94, 0.98, 0.95), borderColor: green, borderWidth: 0.5,
  });
  page.drawText('✓ Assinado digitalmente — ESPAÇO PROGREDIR', {
    x: MX + 4, y: 30, size: 6.5, font: bold, color: green,
  });
  page.drawText('Certificado A1 · ICP-Brasil · CNPJ 05.553.848/0001-61', {
    x: MX + 4, y: 21, size: 5.5, font: regular, color: muted,
  });

  pdflibAddPlaceholder({
    pdfDoc, pdfPage: page,
    reason: 'Assinatura institucional da Folha de Ponto',
    contactInfo: 'Espaço Progredir', name: 'Espaço Progredir', location: 'Nova Iguaçu - RJ',
    signatureLength: 20000, widgetRect: [MX, 18, MX + 250, 40],
  });
  const pdfWithPlaceholder = Buffer.from(await pdfDoc.save());
  const signedPdf = await signpdf.sign(pdfWithPlaceholder, new P12Signer(certificate, { passphrase: password }));
  return Buffer.from(signedPdf);
}
