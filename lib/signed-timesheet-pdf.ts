import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import signpdf from '@signpdf/signpdf';
import { P12Signer } from '@signpdf/signer-p12';
import { isScheduledDay, parseWorkDays } from './timesheet-schedule';

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

function formatTime(value: Date) { return value.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
function formatDate(value: Date) { return value.toLocaleDateString('pt-BR'); }
function minutesFromClock(value: string | null) { const match = value?.match(/^(\d{1,2}):(\d{2})/); return match ? Number(match[1]) * 60 + Number(match[2]) : null; }
function certificateMinutesForDay(item: TimesheetCertificate, date: Date) { if (!item.hoursPerDayMinutes || item.startDate > date || item.endDate < date) return 0; return item.hoursPerDayMinutes; }
function minutesBetween(start: Date, end: Date) { return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000)); }
function formatMinutes(value: number | null) { if (value === null) return '—'; return `${String(Math.floor(Math.abs(value) / 60)).padStart(2, '0')}:${String(Math.abs(value) % 60).padStart(2, '0')}`; }
function formatSignedMinutes(value: number | null) { if (value === null) return '—'; return `${value < 0 ? '-' : ''}${formatMinutes(Math.abs(value))}`; }
function rowDayKey(value: Date) { return value.toISOString().slice(0, 10); }
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
  const pageWidth = 842;
  const pageHeight = 595;
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([pageWidth, pageHeight]);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const green = rgb(0.02, 0.35, 0.25);
  const gold = rgb(0.83, 0.69, 0.22);
  const dark = rgb(0.09, 0.13, 0.11);
  const muted = rgb(0.30, 0.37, 0.33);
  const workDays = parseWorkDays(employee.workDays);
  const startMinutes = minutesFromClock(employee.scheduleStart);
  const endMinutes = minutesFromClock(employee.scheduleEnd);
  const span = startMinutes !== null && endMinutes !== null ? Math.max(0, endMinutes - startMinutes) : null;
  const lunch = span !== null && span > 6 * 60 ? 60 : 0;
  const expectedMinutes = span === null ? null : Math.max(0, span - lunch);

  page.drawRectangle({ x: 0, y: pageHeight - 62, width: pageWidth, height: 62, color: green });
  page.drawRectangle({ x: 0, y: pageHeight - 66, width: pageWidth, height: 4, color: gold });
  page.drawText('EP   ESPAÇO PROGREDIR', { x: 26, y: pageHeight - 27, size: 15, font: bold, color: rgb(1, 1, 1) });
  page.drawText('RELATÓRIO DE PONTO DO COLABORADOR', { x: 525, y: pageHeight - 27, size: 11, font: bold, color: rgb(1, 1, 1) });
  page.drawText('Estrada da Grama, 21 — Miguel Couto · Nova Iguaçu — RJ', { x: 26, y: pageHeight - 46, size: 8, font: regular, color: rgb(0.93, 1, 0.96) });
  page.drawText(`Período: 01/${String(monthNumber).padStart(2, '0')}/${year} a ${new Date(year, monthNumber, 0).getDate()}/${String(monthNumber).padStart(2, '0')}/${year} · ${monthNames[monthNumber - 1].toUpperCase()}`, { x: 525, y: pageHeight - 46, size: 8, font: regular, color: rgb(0.93, 1, 0.96) });

  const metaY = pageHeight - 90;
  page.drawText(`Nome: ${employee.name}`, { x: 26, y: metaY, size: 9, font: bold, color: dark });
  page.drawText(`Matrícula: ${employee.employeeNumber || 'Não informada'}`, { x: 300, y: metaY, size: 9, font: regular, color: dark });
  page.drawText(`CPF: ${employee.cpf || 'Não informado'}`, { x: 490, y: metaY, size: 9, font: regular, color: dark });
  page.drawText(`Cargo: ${employee.jobTitle || 'Não informado'}`, { x: 26, y: metaY - 15, size: 9, font: regular, color: dark });
  page.drawText(`Escala: ${employee.workDays || 'Não informada'}`, { x: 300, y: metaY - 15, size: 9, font: regular, color: dark });
  page.drawText(`Jornada: ${employee.scheduleStart || '—'} às ${employee.scheduleEnd || '—'}`, { x: 490, y: metaY - 15, size: 9, font: regular, color: dark });

  const tableTop = metaY - 35;
  // A4 horizontal: 842 x 595 pt. A linha de totais e as assinaturas ficam
  // dentro da mesma página, sem criar uma segunda página no visualizador.
  const rowHeight = 11.5;
  const columns = [26, 76, 190, 495, 555, 615, 675, 735, 816];
  page.drawRectangle({ x: 26, y: tableTop - rowHeight + 2, width: 790, height: rowHeight, color: rgb(0.91, 0.95, 0.92) });
  ['Data', 'Horários (escala)', 'Marcações', 'H.Trab', 'H.Prev', 'Saldo', 'Desc.', 'Justificativa'].forEach((label, index) => page.drawText(label, { x: columns[index] + 3, y: tableTop - 8, size: 7.2, font: bold, color: green }));

  const lastDay = new Date(year, monthNumber, 0).getDate();
  let totalWorked = 0;
  let totalExpected = 0;
  let absences = 0;
  for (let index = 0; index < lastDay; index += 1) {
    const date = new Date(year, monthNumber - 1, index + 1, 12, 0, 0);
    const dateKey = date.toISOString().slice(0, 10);
    const dayPunches = punches.filter((punch) => rowDayKey(punch.timestamp) === dateKey);
    const scheduled = isScheduledDay(workDays, weekdayCodes[date.getDay()]);
    const configuredWorkday = scheduled && expectedMinutes !== null;
    const worked = workedMinutes(dayPunches);
    const certificate = certificates.find((item) => item.status !== 'CANCELADO' && item.startDate <= date && item.endDate >= date);
    const certificateMinutes = certificate ? certificateMinutesForDay(certificate, date) : 0;
    const creditedWorked = worked === null && certificateMinutes > 0 ? certificateMinutes : worked !== null && certificateMinutes > 0 ? worked + certificateMinutes : worked;
    const expected = configuredWorkday ? expectedMinutes : null;
    if (creditedWorked !== null) totalWorked += creditedWorked;
    if (expected !== null) totalExpected += expected;
    const coveredByCertificate = Boolean(certificate);
    const approvedRequest = requests.find((item) => item.status === 'APROVADO' && ((item.type === 'AUSENCIA' && item.startDate <= date && item.endDate >= date) || (item.type === 'TROCA_DIA' && (item.startDate.getTime() === date.getTime() || item.endDate.getTime() === date.getTime()))));
    const absent = configuredWorkday && !dayPunches.length && !coveredByCertificate && approvedRequest?.type !== 'AUSENCIA';
    if (absent) absences += 1;
    const y = tableTop - rowHeight * (index + 2);
    if (index % 2 === 1) page.drawRectangle({ x: 26, y: y - 3, width: 790, height: rowHeight, color: rgb(0.975, 0.985, 0.978) });
    const schedule = !scheduled ? 'Folga' : employee.scheduleStart && employee.scheduleEnd ? `${employee.scheduleStart} às ${employee.scheduleEnd}${lunch ? ' · 1h almoço' : ' · meio expediente'}` : 'Escala sem horário';
    const marks = dayPunches.length ? dayPunches.map((punch) => `${formatTime(punch.timestamp)} ${punch.type}`).join(' · ') : '—';
    const balance = creditedWorked === null || expected === null ? null : creditedWorked - expected;
    const certificateLabel = certificateMinutes > 0 ? `ATESTADO ${certificate?.startTime || ''}–${certificate?.endTime || ''}` : 'ATESTADO';
    const values = [`${String(index + 1).padStart(2, '0')} ${['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][date.getDay()]}`, schedule, marks, formatMinutes(creditedWorked), formatMinutes(expected), balance === null ? '—' : `${balance < 0 ? '-' : ''}${formatMinutes(Math.abs(balance))}`, coveredByCertificate ? certificateLabel : approvedRequest ? (approvedRequest.type === 'AUSENCIA' ? 'AUSÊNCIA APROVADA' : 'TROCA APROVADA') : absent ? 'FALTA' : '', coveredByCertificate && dayPunches.length ? `${certificateLabel} + MARCAÇÃO EXISTENTE` : approvedRequest ? approvedRequest.reason : ''];
    values.forEach((value, valueIndex) => page.drawText(value, { x: columns[valueIndex] + 3, y, size: valueIndex === 2 ? 6.8 : 7.6, font: valueIndex === 6 ? bold : regular, color: valueIndex === 6 && absent ? rgb(0.65, 0.12, 0.12) : valueIndex === 6 && (coveredByCertificate || Boolean(approvedRequest)) ? green : dark, maxWidth: columns[valueIndex + 1] - columns[valueIndex] - 6, lineHeight: 7.6 }));
    page.drawLine({ start: { x: 26, y: y - 4 }, end: { x: 816, y: y - 4 }, thickness: 0.35, color: rgb(0.76, 0.82, 0.78) });
  }

  const totalsY = 68;
  page.drawLine({ start: { x: 26, y: totalsY + 11 }, end: { x: 816, y: totalsY + 11 }, thickness: 1.2, color: green });
  page.drawText(`Total trabalhado: ${formatMinutes(totalWorked)}`, { x: 26, y: totalsY, size: 9, font: bold, color: dark });
  page.drawText(`Total previsto: ${formatMinutes(totalExpected)}`, { x: 190, y: totalsY, size: 9, font: bold, color: dark });
  page.drawText(`Saldo: ${formatSignedMinutes(totalWorked - totalExpected)}`, { x: 345, y: totalsY, size: 9, font: bold, color: dark });
  page.drawText(`Faltas: ${absences}`, { x: 470, y: totalsY, size: 9, font: bold, color: dark });

  // Rodapé institucional: A1 à esquerda e assinatura manuscrita do colaborador à direita.
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
