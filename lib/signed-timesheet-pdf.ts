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
  startDate: Date;
  endDate: Date;
  startTime?: string | null;
  endTime?: string | null;
  hoursPerDayMinutes?: number | null;
  status: string;
};
export type TimesheetRequest = { type: string; startDate: Date; endDate: Date; status: string; reason: string };

/** A4 landscape em pontos PDF (1 pt = 1/72 in). Garante UMA página. */
const A4_LANDSCAPE: [number, number] = [841.89, 595.28];
const MARGIN_X = 18;
const FOOTER_H = 52;
const HEADER_H = 48;

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
  const entry = ordered.find((punch) => punch.type === 'ENTRADA');
  const interval = ordered.find((punch) => punch.type === 'INTERVALO' && entry && punch.timestamp > entry.timestamp);
  const retorno = ordered.find((punch) => punch.type === 'RETORNO' && interval && punch.timestamp > interval.timestamp);
  const saida = ordered.find((punch) => punch.type === 'SAIDA' && retorno && punch.timestamp > retorno.timestamp);
  const pairs: Array<[Date, Date]> = [];
  if (entry && interval) pairs.push([entry.timestamp, interval.timestamp]);
  if (retorno && saida) pairs.push([retorno.timestamp, saida.timestamp]);
  if (!pairs.length && ordered.length >= 2) pairs.push([ordered[0].timestamp, ordered[ordered.length - 1].timestamp]);
  return ordered.length ? pairs.reduce((total, [start, end]) => total + minutesBetween(start, end), 0) : null;
}

export async function createSignedTimesheetPdf({
  employee,
  punches,
  certificates = [],
  requests = [],
  month,
  certificate,
  password,
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
  // SEMPRE uma única página A4 paisagem
  const page = pdfDoc.addPage(A4_LANDSCAPE);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = page.getWidth();
  const pageHeight = page.getHeight();
  const green = rgb(0.05, 0.35, 0.25);
  const dark = rgb(0.08, 0.12, 0.1);
  const muted = rgb(0.38, 0.42, 0.4);
  const contentRight = pageWidth - MARGIN_X;

  // Cabeçalho compacto
  page.drawRectangle({ x: 0, y: pageHeight - HEADER_H, width: pageWidth, height: HEADER_H, color: green });
  page.drawText('ESPAÇO PROGREDIR — FOLHA DE PONTO', {
    x: MARGIN_X,
    y: pageHeight - 20,
    size: 11,
    font: bold,
    color: rgb(1, 1, 1),
  });
  page.drawText('Estrada da Grama, 21 — Miguel Couto · Nova Iguaçu — RJ · CNPJ 05.553.848/0001-61',
    { x: MARGIN_X, y: pageHeight - 34, size: 7, font: regular, color: rgb(0.9, 0.98, 0.94) });
  page.drawText(
    `Competência: 01/${String(monthNumber).padStart(2, '0')}/${year} a ${String(lastDay).padStart(2, '0')}/${String(monthNumber).padStart(2, '0')}/${year} · ${monthNames[monthNumber - 1].toUpperCase()} · 1 folha A4`,
    { x: MARGIN_X, y: pageHeight - 44, size: 7, font: regular, color: rgb(0.95, 0.9, 0.55) },
  );

  // Colaborador
  const nameY = pageHeight - HEADER_H - 12;
  page.drawText(employee.name, { x: MARGIN_X, y: nameY, size: 9.5, font: bold, color: dark, maxWidth: 420 });
  page.drawText(
    `Mat. ${employee.employeeNumber || '—'} · CPF ${employee.cpf || '—'} · ${employee.jobTitle || '—'}`,
    { x: MARGIN_X + 430, y: nameY, size: 7.5, font: regular, color: muted, maxWidth: 360 },
  );

  const workDays = employee.workDays ? parseWorkDays(employee.workDays) : new Set(['SEG', 'TER', 'QUA', 'QUI', 'SEX']);
  const scheduleStart = minutesFromClock(employee.scheduleStart);
  const scheduleEnd = minutesFromClock(employee.scheduleEnd);
  const scheduleSpan = scheduleStart !== null && scheduleEnd !== null ? Math.max(0, scheduleEnd - scheduleStart) : null;
  const lunch = scheduleSpan !== null && scheduleSpan > 6 * 60 ? 60 : 0;
  const expectedBase = scheduleSpan === null ? null : Math.max(0, scheduleSpan - lunch);

  // Colunas compactas (largura útil ~806)
  const columns = [MARGIN_X, 58, 168, 360, 410, 458, 510, 575, contentRight];
  const headers = ['Data', 'Escala', 'Marcações', 'Trab.', 'Prev.', 'Saldo', 'Sit.', 'Obs.'];

  // Espaço da tabela: entre nome e rodapé — cabe exatamente lastDay linhas + cabeçalho
  const tableTop = nameY - 14;
  const tableBottom = FOOTER_H + 18; // acima dos totais
  const rowsSlot = tableTop - tableBottom;
  const headerRowH = 11;
  const bodyRows = lastDay;
  const rowHeight = Math.min(12.2, (rowsSlot - headerRowH) / bodyRows);
  const fontSize = rowHeight >= 11.5 ? 7.2 : rowHeight >= 10.5 ? 6.8 : 6.3;

  headers.forEach((header, index) => {
    page.drawText(header, {
      x: columns[index] + 2,
      y: tableTop - 8,
      size: 6.5,
      font: bold,
      color: green,
    });
  });
  page.drawLine({
    start: { x: MARGIN_X, y: tableTop - headerRowH },
    end: { x: contentRight, y: tableTop - headerRowH },
    thickness: 0.8,
    color: green,
  });

  let totalWorked = 0;
  let totalExpected = 0;
  let absences = 0;

  for (let index = 0; index < lastDay; index += 1) {
    const date = new Date(year, monthNumber - 1, index + 1, 12, 0, 0);
    const dateKey = `${year}-${String(monthNumber).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`;
    const rawDayPunches = punches.filter((punch) => rowDayKey(punch.timestamp) === dateKey);
    const dayCerts = certificates.map((c) => ({
      userId: '',
      startDate: c.startDate,
      endDate: c.endDate,
      startTime: c.startTime,
      endTime: c.endTime,
      status: c.status,
    }));
    const dayPunches = filterPunchesOutsideCertificates(
      rawDayPunches.map((p, i) => ({
        id: String(i),
        userId: '',
        type: p.type,
        timestamp: p.timestamp,
        status: 'VALID',
      })),
      dayCerts as any,
    ).map((p) => ({ type: p.type, timestamp: p.timestamp }));

    const weekday = date.getDay();
    const scheduled = isScheduledDay(workDays, weekdayCodes[weekday]);
    const expected = scheduled ? expectedBase : null;
    const configuredWorkday = scheduled && expected !== null;
    const worked = workedMinutes(dayPunches);
    const certificate = certificates.find((item) => {
      if (item.status !== 'APROVADO' && item.status !== 'ATIVO') return false;
      const startKey = rowDayKey(item.startDate);
      const endKey = rowDayKey(item.endDate);
      return startKey <= dateKey && endKey >= dateKey;
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
          (item.type === 'TROCA_DIA' &&
            (rowDayKey(item.startDate) === dateKey || rowDayKey(item.endDate) === dateKey))),
    );
    const absent =
      configuredWorkday && !dayPunches.length && !coveredByCertificate && approvedRequest?.type !== 'AUSENCIA';
    if (absent) absences += 1;

    // y decresce; última linha permanece acima do rodapé
    const y = tableTop - headerRowH - rowHeight * (index + 1) + 3;
    if (index % 2 === 1) {
      page.drawRectangle({
        x: MARGIN_X,
        y: y - 2,
        width: contentRight - MARGIN_X,
        height: rowHeight,
        color: rgb(0.96, 0.98, 0.97),
      });
    }

    const schedule = !scheduled
      ? 'Folga'
      : employee.scheduleStart && employee.scheduleEnd
        ? `${employee.scheduleStart.slice(0, 5)}-${employee.scheduleEnd.slice(0, 5)}`
        : '—';
    const marks = dayPunches.length
      ? dayPunches.map((punch) => `${formatTime(punch.timestamp)}${shortType(punch.type)}`).join(' ')
      : '—';
    const balance =
      creditedWorked === null || expected === null ? null : creditedWorked - expected;
    const sit = coveredByCertificate
      ? 'ATEST.'
      : approvedRequest
        ? approvedRequest.type === 'AUSENCIA'
          ? 'AUS.'
          : 'TROCA'
        : absent
          ? 'FALTA'
          : !scheduled
            ? 'FOLGA'
            : '';
    const obs = coveredByCertificate && dayPunches.length
      ? 'abono+ponto'
      : approvedRequest
        ? String(approvedRequest.reason || '').slice(0, 18)
        : '';

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
      const maxW = columns[valueIndex + 1] - columns[valueIndex] - 4;
      page.drawText(String(value).slice(0, valueIndex === 2 ? 36 : 22), {
        x: columns[valueIndex] + 2,
        y,
        size: valueIndex === 2 ? Math.max(5.8, fontSize - 0.4) : fontSize,
        font: valueIndex === 6 && (absent || coveredByCertificate) ? bold : regular,
        color:
          valueIndex === 6 && absent
            ? rgb(0.65, 0.12, 0.12)
            : valueIndex === 6 && coveredByCertificate
              ? green
              : dark,
        maxWidth: maxW,
      });
    });
  }

  // Rodapé: totais + assinaturas — sempre na mesma página
  const totalsY = FOOTER_H + 8;
  page.drawLine({
    start: { x: MARGIN_X, y: totalsY + 14 },
    end: { x: contentRight, y: totalsY + 14 },
    thickness: 1,
    color: green,
  });
  page.drawText(`Trab. ${formatMinutes(totalWorked)}`, { x: MARGIN_X, y: totalsY + 4, size: 8, font: bold, color: dark });
  page.drawText(`Prev. ${formatMinutes(totalExpected)}`, { x: 120, y: totalsY + 4, size: 8, font: bold, color: dark });
  page.drawText(`Saldo ${formatSignedMinutes(totalWorked - totalExpected)}`, {
    x: 230,
    y: totalsY + 4,
    size: 8,
    font: bold,
    color: dark,
  });
  page.drawText(`Faltas ${absences}`, { x: 360, y: totalsY + 4, size: 8, font: bold, color: dark });
  page.drawText('Documento em 1 página A4 (paisagem)', {
    x: 440,
    y: totalsY + 4,
    size: 7,
    font: regular,
    color: muted,
  });

  page.drawRectangle({
    x: MARGIN_X,
    y: 8,
    width: 300,
    height: 28,
    color: rgb(0.95, 1, 0.96),
    borderColor: rgb(0.24, 0.61, 0.39),
    borderWidth: 0.6,
  });
  page.drawText('✓ Assinado digitalmente — ESPAÇO PROGREDIR', {
    x: MARGIN_X + 6,
    y: 26,
    size: 7,
    font: bold,
    color: green,
  });
  page.drawText('Certificado A1 · ICP-Brasil · CNPJ 05.553.848/0001-61', {
    x: MARGIN_X + 6,
    y: 14,
    size: 6,
    font: regular,
    color: muted,
  });

  page.drawText('ASSINATURA DO COLABORADOR', { x: 520, y: 28, size: 7, font: bold, color: green });
  page.drawLine({ start: { x: 520, y: 18 }, end: { x: contentRight, y: 18 }, thickness: 0.7, color: muted });
  page.drawText(employee.name, { x: 520, y: 10, size: 6.5, font: regular, color: muted, maxWidth: 280 });

  pdflibAddPlaceholder({
    pdfDoc,
    pdfPage: page,
    reason: 'Assinatura institucional da Folha de Ponto',
    contactInfo: 'Espaço Progredir',
    name: 'Espaço Progredir',
    location: 'Nova Iguaçu - RJ',
    signatureLength: 20000,
    widgetRect: [MARGIN_X, 8, MARGIN_X + 300, 36],
  });
  const pdfWithPlaceholder = Buffer.from(await pdfDoc.save());
  const signedPdf = await signpdf.sign(pdfWithPlaceholder, new P12Signer(certificate, { passphrase: password }));
  return Buffer.from(signedPdf);
}
