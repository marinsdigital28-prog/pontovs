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
export type TimesheetCertificate = { startDate: Date; endDate: Date; startTime?: string | null; endTime?: string | null; hoursPerDayMinutes?: number | null; status: string };
export type TimesheetRequest = { type: string; startDate: Date; endDate: Date; status: string; reason: string };

const weekdayCodes: Record<number, string> = { 0: 'DOM', 1: 'SEG', 2: 'TER', 3: 'QUA', 4: 'QUI', 5: 'SEX', 6: 'SÁB' };
const monthNames = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const APP_TIME_ZONE = 'America/Sao_Paulo';
function formatTime(value: Date) { return value.toLocaleTimeString('pt-BR', { timeZone: APP_TIME_ZONE, hour: '2-digit', minute: '2-digit' }); }
function minutesFromClock(value: string | null) { const match = value?.match(/^(\d{1,2}):(\d{2})/); return match ? Number(match[1]) * 60 + Number(match[2]) : null; }
function certificateMinutesForDay(item: TimesheetCertificate, date: Date) { if (!item.hoursPerDayMinutes || item.startDate > date || item.endDate < date) return 0; return item.hoursPerDayMinutes; }
function minutesBetween(start: Date, end: Date) { return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000)); }
function formatMinutes(value: number | null) { if (value === null) return '—'; return `${String(Math.floor(Math.abs(value) / 60)).padStart(2, '0')}:${String(Math.abs(value) % 60).padStart(2, '0')}`; }
function formatSignedMinutes(value: number | null) { if (value === null) return '—'; return `${value < 0 ? '-' : ''}${formatMinutes(Math.abs(value))}`; }
/** Dia civil em America/Sao_Paulo — não usa UTC (evita vazar para o mês seguinte). */
function rowDayKey(value: Date) {
  return value.toLocaleDateString('en-CA', { timeZone: APP_TIME_ZONE });
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

export async function createSignedTimesheetPdf({ employee, punches, certificates = [], requests = [], month, certificate, password }: { employee: TimesheetEmployee; punches: TimesheetPunch[]; certificates?: TimesheetCertificate[]; requests?: TimesheetRequest[]; month: string; certificate: Buffer; password: string }) {
  const [year, monthNumber] = month.split('-').map(Number);
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([842, 595]);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = page.getWidth();
  const pageHeight = page.getHeight();
  const green = rgb(0.05, 0.35, 0.25);
  const dark = rgb(0.1, 0.14, 0.12);
  const muted = rgb(0.4, 0.45, 0.42);

  page.drawRectangle({ x: 0, y: pageHeight - 58, width: pageWidth, height: 58, color: green });
  page.drawText('ESPAÇO PROGREDIR — FOLHA DE PONTO', { x: 26, y: pageHeight - 28, size: 14, font: bold, color: rgb(1, 1, 1) });
  page.drawText('Estrada da Grama, 21 — Miguel Couto · Nova Iguaçu — RJ', { x: 26, y: pageHeight - 46, size: 8, font: regular, color: rgb(0.93, 1, 0.96) });
  const lastCalendarDay = new Date(year, monthNumber, 0).getDate();
  page.drawText(`Período: 01/${String(monthNumber).padStart(2, '0')}/${year} a ${lastCalendarDay}/${String(monthNumber).padStart(2, '0')}/${year} · ${monthNames[monthNumber - 1].toUpperCase()}`, { x: 480, y: pageHeight - 46, size: 8, font: regular, color: rgb(0.93, 1, 0.96) });

  page.drawText(employee.name, { x: 26, y: pageHeight - 78, size: 12, font: bold, color: dark });
  page.drawText(`Matrícula: ${employee.employeeNumber || '—'} · CPF: ${employee.cpf || '—'} · ${employee.jobTitle || '—'}`, { x: 26, y: pageHeight - 94, size: 9, font: regular, color: muted });

  const workDays = employee.workDays ? parseWorkDays(employee.workDays) : new Set(['SEG', 'TER', 'QUA', 'QUI', 'SEX']);
  const scheduleStart = minutesFromClock(employee.scheduleStart);
  const scheduleEnd = minutesFromClock(employee.scheduleEnd);
  const scheduleSpan = scheduleStart !== null && scheduleEnd !== null ? Math.max(0, scheduleEnd - scheduleStart) : null;
  const lunch = scheduleSpan !== null && scheduleSpan > 6 * 60 ? 60 : 0;
  const expectedBase = scheduleSpan === null ? null : Math.max(0, scheduleSpan - lunch);

  const columns = [26, 78, 210, 420, 480, 540, 600, 680, 816];
  const headers = ['Data', 'Escala', 'Marcações', 'Trab.', 'Prev.', 'Saldo', 'Sit.', 'Obs.'];
  const tableTop = pageHeight - 118;
  const rowHeight = 13.5;
  headers.forEach((header, index) => page.drawText(header, { x: columns[index] + 3, y: tableTop, size: 8, font: bold, color: green }));
  page.drawLine({ start: { x: 26, y: tableTop - 4 }, end: { x: 816, y: tableTop - 4 }, thickness: 1, color: green });

  const lastDay = lastCalendarDay;
  let totalWorked = 0;
  let totalExpected = 0;
  let absences = 0;

  for (let index = 0; index < lastDay; index += 1) {
    const date = new Date(year, monthNumber - 1, index + 1, 12, 0, 0);
    // Chave fixa da competência — nunca UTC
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
      rawDayPunches.map((p, i) => ({ id: String(i), userId: '', type: p.type, timestamp: p.timestamp, status: 'VALID' })),
      dayCerts as any,
    ).map((p) => ({ type: p.type, timestamp: p.timestamp }));

    const weekday = date.getDay();
    const scheduled = isScheduledDay(workDays, weekdayCodes[weekday]);
    const expected = scheduled ? expectedBase : null;
    const configuredWorkday = scheduled && expected !== null;
    const worked = workedMinutes(dayPunches);
    const certificate = certificates.find((item) => item.status === 'APROVADO' || item.status === 'ATIVO') && certificates.find((item) => {
      const startKey = rowDayKey(item.startDate);
      const endKey = rowDayKey(item.endDate);
      return startKey <= dateKey && endKey >= dateKey;
    });
    const certificateMinutes = certificate ? (certificate.startTime && certificate.endTime ? Math.max(0, (minutesFromClock(certificate.endTime) || 0) - (minutesFromClock(certificate.startTime) || 0)) : (expected || 0)) : 0;
    const creditedWorked = worked === null ? (certificateMinutes > 0 ? certificateMinutes : null) : worked + certificateMinutes;
    if (creditedWorked !== null) totalWorked += creditedWorked;
    if (expected !== null) totalExpected += expected;
    const coveredByCertificate = Boolean(certificate);
    const approvedRequest = requests.find((item) => item.status === 'APROVADO' && ((item.type === 'AUSENCIA' && rowDayKey(item.startDate) <= dateKey && rowDayKey(item.endDate) >= dateKey) || (item.type === 'TROCA_DIA' && (rowDayKey(item.startDate) === dateKey || rowDayKey(item.endDate) === dateKey))));
    const absent = configuredWorkday && !dayPunches.length && !coveredByCertificate && approvedRequest?.type !== 'AUSENCIA';
    if (absent) absences += 1;
    const y = tableTop - rowHeight * (index + 2);
    if (index % 2 === 1) page.drawRectangle({ x: 26, y: y - 3, width: 790, height: rowHeight, color: rgb(0.975, 0.985, 0.978) });
    const schedule = !scheduled ? 'Folga' : employee.scheduleStart && employee.scheduleEnd ? `${employee.scheduleStart} às ${employee.scheduleEnd}${lunch ? ' · 1h almoço' : ' · meio exp.'}` : 'Sem horário';
    const marks = dayPunches.length ? dayPunches.map((punch) => `${formatTime(punch.timestamp)} ${punch.type}`).join(' · ') : '—';
    const balance = creditedWorked === null || expected === null ? null : creditedWorked - expected;
    const certificateLabel = certificateMinutes > 0 ? `ATESTADO ${certificate?.startTime || ''}–${certificate?.endTime || ''}` : 'ATESTADO';
    const values = [`${String(index + 1).padStart(2, '0')} ${['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][weekday]}`, schedule, marks, formatMinutes(creditedWorked), formatMinutes(expected), balance === null ? '—' : `${balance < 0 ? '-' : ''}${formatMinutes(Math.abs(balance))}`, coveredByCertificate ? certificateLabel : approvedRequest ? (approvedRequest.type === 'AUSENCIA' ? 'AUSÊNCIA' : 'TROCA') : absent ? 'FALTA' : '', coveredByCertificate && dayPunches.length ? 'ABONO + PONTO' : approvedRequest ? approvedRequest.reason : ''];
    values.forEach((value, valueIndex) => page.drawText(String(value).slice(0, 48), { x: columns[valueIndex] + 3, y, size: valueIndex === 2 ? 8 : 9, font: valueIndex === 6 ? bold : regular, color: valueIndex === 6 && absent ? rgb(0.65, 0.12, 0.12) : valueIndex === 6 && (coveredByCertificate || Boolean(approvedRequest)) ? green : dark, maxWidth: columns[valueIndex + 1] - columns[valueIndex] - 6, lineHeight: 9.2 }));
    page.drawLine({ start: { x: 26, y: y - 4 }, end: { x: 816, y: y - 4 }, thickness: 0.35, color: rgb(0.76, 0.82, 0.78) });
  }

  const totalsY = 68;
  page.drawLine({ start: { x: 26, y: totalsY + 11 }, end: { x: 816, y: totalsY + 11 }, thickness: 1.2, color: green });
  page.drawText(`Total trabalhado: ${formatMinutes(totalWorked)}`, { x: 26, y: totalsY, size: 11, font: bold, color: dark });
  page.drawText(`Total previsto: ${formatMinutes(totalExpected)}`, { x: 200, y: totalsY, size: 11, font: bold, color: dark });
  page.drawText(`Saldo: ${formatSignedMinutes(totalWorked - totalExpected)}`, { x: 370, y: totalsY, size: 11, font: bold, color: dark });
  page.drawText(`Faltas: ${absences}`, { x: 500, y: totalsY, size: 11, font: bold, color: dark });

  page.drawRectangle({ x: 26, y: 18, width: 310, height: 34, color: rgb(0.95, 1, 0.96), borderColor: rgb(0.24, 0.61, 0.39), borderWidth: 0.8 });
  page.drawText('✓ Assinado digitalmente por ESPAÇO PROGREDIR', { x: 32, y: 42, size: 8.2, font: bold, color: green });
  page.drawText('Certificado digital A1 · CNPJ 05.553.848/0001-61', { x: 32, y: 31, size: 7.1, font: regular, color: green });
  page.drawText('SHA-256 · PKCS#7 (CMS) · ICP-Brasil A1', { x: 32, y: 22, size: 7.1, font: regular, color: muted });
  page.drawText('ASSINATURA DO COLABORADOR', { x: 560, y: 43, size: 8.5, font: bold, color: green });
  page.drawLine({ start: { x: 560, y: 31 }, end: { x: 816, y: 31 }, thickness: 0.8, color: muted });
  page.drawText(employee.name, { x: 560, y: 21, size: 7.5, font: regular, color: muted, maxWidth: 256 });

  pdflibAddPlaceholder({ pdfDoc, pdfPage: page, reason: 'Assinatura institucional da Folha de Ponto', contactInfo: 'Espaço Progredir', name: 'Espaço Progredir', location: 'Nova Iguaçu - RJ', signatureLength: 20000, widgetRect: [26, 23, 300, 38] });
  const pdfWithPlaceholder = Buffer.from(await pdfDoc.save());
  const signedPdf = await signpdf.sign(pdfWithPlaceholder, new P12Signer(certificate, { passphrase: password }));
  return Buffer.from(signedPdf);
}
