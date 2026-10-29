import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import signpdf from '@signpdf/signpdf';
import { P12Signer } from '@signpdf/signer-p12';
import { INTER_BOLD, INTER_EXTRABOLD, INTER_REGULAR, INTER_SEMIBOLD } from './fonts/inter-fonts';
import { COMPANIES, companyCnpjLabel, DEFAULT_COMPANY, isCompanyCode, type CompanyCode } from './company';
import { LOGO_ESCOLA_PNG_B64 } from './company-logos';
import { buildTimesheetRows, formatClock, formatSigned, type TimesheetRow, type SituationTone } from './timesheet-rows';

export type TimesheetEmployee = {
  name: string;
  employeeNumber: string | null;
  cpf: string | null;
  jobTitle: string | null;
  workDays: string | null;
  scheduleStart: string | null;
  scheduleEnd: string | null;
  scheduleByDay?: string | null;
  department?: string | null;
  unit?: string | null;
  /** empresa do colaborador (cabeçalho, CNPJ e nome no selo); padrão Espaço Progredir */
  company?: CompanyCode | null;
};

/** origin 'ADJUSTED' = marcação incluída/ajustada pelo gestor (Portaria 671) → exibida com * */
export type TimesheetPunch = { type: string; timestamp: Date; origin?: string | null };
export type TimesheetCertificate = {
  type?: string | null; startDate: Date; endDate: Date; startTime?: string | null; endTime?: string | null;
  hoursPerDayMinutes?: number | null; status: string;
};
export type TimesheetRequest = { type: string; startDate: Date; endDate: Date; status: string; reason: string };

export type TimesheetBuildOptions = {
  /** data de referência (YYYY-MM-DD, fuso SP); dias depois dela ficam fora dos totais */
  today?: string;
  /** feriados extras por data (ex.: municipais) além dos cadastrados em operational-abonos */
  extraHolidays?: Record<string, string>;
  emittedAt?: Date;
};

/* ============ Geometria (mm) — idêntica à arte aprovada "arte-nova" ============ */
const MM = 72 / 25.4;
const PAGE_W = 297 * MM;
const PAGE_H = 210 * MM;
const APP_TZ = 'America/Sao_Paulo';
const CAP = 0.7275; // altura das maiúsculas/algarismos da Inter (em)

const C = {
  g: hex('#1e651d'), gd: hex('#0a3a09'), gl: hex('#eaf2e6'), gz: hex('#f6f9f4'), gold: hex('#c9a24e'), goldl: hex('#f7efdc'),
  ink: hex('#111111'), mut: hex('#333333'), fut: hex('#555555'), line: hex('#6f8a6b'), line2: hex('#8fa58b'), cell: hex('#5f7a5b'),
  we: hex('#e9eee7'), fer: hex('#fbf6ea'), abn: hex('#eef4fb'), neg: hex('#b3261e'), white: rgb(1, 1, 1),
  sbox: hex('#fbfdfa'), sboxLine: hex('#c9d8c4'), sealBg: hex('#f3f8f1'), star: hex('#9a6a00'),
};
const TAGS: Record<SituationTone, { bg: RGB | null; fg: RGB }> = {
  ok: { bg: C.gl, fg: C.g }, folga: { bg: hex('#dfe6dc'), fg: C.mut }, feriado: { bg: C.goldl, fg: hex('#7a5410') },
  abono: { bg: hex('#e3eefb'), fg: hex('#1d4f8a') }, falta: { bg: hex('#fbe3e1'), fg: C.neg },
  alerta: { bg: hex('#fff1d6'), fg: hex('#8a5a00') }, futuro: { bg: null, fg: C.fut },
};
const TABLE = {
  x: 7.13, top: 25.69, headH: 4.87, rowH: 4.44, footH: 5.26,
  cols: [19.5, 12.5, 28, 20.18, 27, 20.18, 20.18, 20.18, 20.18, 20.18, 20.18, 54.5],
  heads: ['Data', 'Dia', 'Escala', 'Entrada', 'Saída intervalo', 'Retorno', 'Saída', 'Trabalhado', 'Previsto', 'Falta', 'Saldo', 'Situação'],
};
const SEAL = { x: 7, y: 193.08, w: 183, h: 11.91 };
const SIGN = { x: 198, y: 176.01, w: 92, h: 28.99 };

function hex(value: string) {
  const n = parseInt(value.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

type Fonts = { r: PDFFont; sb: PDFFont; b: PDFFont; xb: PDFFont };

class Painter {
  constructor(public page: PDFPage, public f: Fonts) {}
  rect(x: number, y: number, w: number, h: number, o: { fill?: RGB; stroke?: RGB; sw?: number } = {}) {
    this.page.drawRectangle({
      x: x * MM, y: PAGE_H - (y + h) * MM, width: w * MM, height: h * MM,
      color: o.fill, borderColor: o.stroke, borderWidth: o.stroke ? (o.sw ?? 0.2) * MM : 0,
    });
  }
  rrect(x: number, y: number, w: number, h: number, r: number, o: { fill?: RGB; stroke?: RGB; sw?: number } = {}) {
    const W = w * MM, H = h * MM, R = r * MM;
    const d = `M ${R} 0 H ${W - R} Q ${W} 0 ${W} ${R} V ${H - R} Q ${W} ${H} ${W - R} ${H} H ${R} Q 0 ${H} 0 ${H - R} V ${R} Q 0 0 ${R} 0 Z`;
    this.page.drawSvgPath(d, {
      x: x * MM, y: PAGE_H - y * MM, color: o.fill, borderColor: o.stroke, borderWidth: o.stroke ? (o.sw ?? 0.2) * MM : 0,
    });
  }
  hline(x1: number, x2: number, y: number, sw: number, color: RGB) {
    this.page.drawLine({ start: { x: x1 * MM, y: PAGE_H - y * MM }, end: { x: x2 * MM, y: PAGE_H - y * MM }, thickness: sw * MM, color });
  }
  vline(x: number, y1: number, y2: number, sw: number, color: RGB) {
    this.page.drawLine({ start: { x: x * MM, y: PAGE_H - y1 * MM }, end: { x: x * MM, y: PAGE_H - y2 * MM }, thickness: sw * MM, color });
  }
  width(text: string, size: number, font: PDFFont, spacing = 0) {
    return font.widthOfTextAtSize(text, size) / MM + spacing * size * (25.4 / 72) * Math.max(0, text.length - 1);
  }
  fit(text: string, size: number, font: PDFFont, max: number) {
    if (this.width(text, size, font) <= max) return text;
    let t = text;
    while (t.length > 1 && this.width(`${t}…`, size, font) > max) t = t.slice(0, -1);
    return `${t.trimEnd()}…`;
  }
  /** baseline em mm; align relativo a x (left) ou centro (center) ou borda direita (right) */
  text(text: string, x: number, baseline: number, size: number, font: PDFFont, color: RGB, align: 'left' | 'center' | 'right' = 'left', spacing = 0) {
    const w = this.width(text, size, font, spacing);
    let sx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    if (!spacing) {
      this.page.drawText(text, { x: sx * MM, y: PAGE_H - baseline * MM, size, font, color });
      return w;
    }
    for (const ch of text) {
      this.page.drawText(ch, { x: sx * MM, y: PAGE_H - baseline * MM, size, font, color });
      sx += font.widthOfTextAtSize(ch, size) / MM + spacing * size * (25.4 / 72);
    }
    return w;
  }
}
/** baseline que centraliza opticamente algarismos/maiúsculas numa faixa [top, top+h] */
function mid(top: number, h: number, size: number) {
  return top + h / 2 + (CAP * size * (25.4 / 72)) / 2;
}

const logoCache = new Map<string, Promise<Buffer>>();
async function loadLogo(pdfDoc: PDFDocument, code: CompanyCode = DEFAULT_COMPANY) {
  const cfg = COMPANIES[code];
  try {
    if (cfg.pdfLogo === 'escola') return await pdfDoc.embedPng(Buffer.from(LOGO_ESCOLA_PNG_B64, 'base64'));
    if (!logoCache.has(cfg.logoPath)) logoCache.set(cfg.logoPath, readFile(path.join(process.cwd(), 'public', cfg.logoPath)));
    const bytes = await logoCache.get(cfg.logoPath)!;
    return cfg.logoMime === 'png' ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
  } catch {
    logoCache.delete(cfg.logoPath);
    return null;
  }
}

function monthTitle(month: string) {
  const [y, m] = month.split('-').map(Number);
  const name = new Date(y, m - 1, 15).toLocaleDateString('pt-BR', { month: 'long', timeZone: APP_TZ });
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}/${y}`;
}
function fmtDateTime(d: Date, seconds = false) {
  const date = d.toLocaleDateString('pt-BR', { timeZone: APP_TZ });
  const time = d.toLocaleTimeString('pt-BR', { timeZone: APP_TZ, hour: '2-digit', minute: '2-digit', second: seconds ? '2-digit' : undefined, hour12: false });
  return `${date} ${time}`;
}

function drawShield(p: Painter, x: number, y: number, size: number) {
  const s = (size * MM) / 48;
  const at = { x: x * MM, y: PAGE_H - y * MM, scale: s };
  p.page.drawSvgPath('M24 3l17 6v13c0 11-7.3 19.6-17 23-9.7-3.4-17-12-17-23V9z', { ...at, color: C.g });
  p.page.drawSvgPath('M24 7.5l13 4.6v9.9c0 8.6-5.4 15.4-13 18.5-7.6-3.1-13-9.9-13-18.5v-9.9z', { ...at, borderColor: C.gold, borderWidth: 1.4 * s });
  p.page.drawSvgPath('M16.5 24.5l5 5 10-11', { ...at, borderColor: C.white, borderWidth: 3.4 * s, borderLineCap: 1 as any });
}

export async function buildTimesheetDocument({
  employee, punches, certificates = [], requests = [], month, options = {},
}: {
  employee: TimesheetEmployee;
  punches: TimesheetPunch[];
  certificates?: TimesheetCertificate[];
  requests?: TimesheetRequest[];
  month: string;
  options?: TimesheetBuildOptions;
}) {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  const emittedAt = options.emittedAt ?? new Date();
  const { rows, totals } = buildTimesheetRows({
    employee, punches, certificates, requests, month, today: options.today, extraHolidays: options.extraHolidays,
  });

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  pdfDoc.setTitle(`Folha de ponto — ${employee.name} — ${monthTitle(month)}`);
  const companyCode: CompanyCode = isCompanyCode(employee.company) ? employee.company : DEFAULT_COMPANY;
  const company = COMPANIES[companyCode];
  const cnpjText = companyCnpjLabel(companyCode);
  pdfDoc.setAuthor(company.shortName);
  const load = (b64: string) => pdfDoc.embedFont(Buffer.from(b64, 'base64'), { subset: true });
  const f: Fonts = { r: await load(INTER_REGULAR), sb: await load(INTER_SEMIBOLD), b: await load(INTER_BOLD), xb: await load(INTER_EXTRABOLD) };
  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  const p = new Painter(page, f);

  // Moldura dupla
  p.rrect(2.4, 2.4, 297 - 4.8, 210 - 4.8, 2, { stroke: C.g, sw: 0.5 });
  p.rrect(3.1, 3.1, 297 - 6.2, 210 - 6.2, 1.5, { stroke: C.gold, sw: 0.2 });

  // Cabeçalho
  const logo = await loadLogo(pdfDoc, companyCode);
  if (logo) {
    const h = 7; const w = h * (logo.width / logo.height);
    page.drawImage(logo, { x: 8 * MM, y: PAGE_H - (5.7 + h) * MM, width: w * MM, height: h * MM });
  }
  const logoW = logo ? 7 * (logo.width / logo.height) : 9;
  const nameX = Math.max(19.3, 8 + logoW + 2.3);
  const headSize = Math.max(8, Math.min(10.5, 10.5 * (118 - nameX) / Math.max(1, p.width(company.name, 10.5, f.b))));
  p.text(company.name, nameX, 8.75, headSize, f.b, C.g, 'left', 0.02);
  p.text(cnpjText, nameX, 12.35, 7.4, f.r, C.mut);
  p.text('FOLHA DE PONTO', 148.5, 9.35, 12.5, f.b, C.gd, 'center', 0.14);
  p.text('Registro eletrônico de ponto · Portaria MTP nº 671/2021', 148.5, 12.75, 6.8, f.r, C.mut, 'center', 0.04);
  p.rrect(233, 5.2, 56, 8, 1.2, { stroke: C.line, sw: 0.25 });
  p.hline(233.1, 288.9, 9.07, 0.2, C.line2);
  const period = `01/${String(monthNumber).padStart(2, '0')}/${year} a ${lastDay}/${String(monthNumber).padStart(2, '0')}/${year}`;
  p.text('Período', 235.3, mid(5.3, 3.77, 7), 7, f.r, C.mut);
  p.text(period, 286.8, mid(5.3, 3.77, 7), 7, f.b, C.gd, 'right');
  p.text('Emitido em', 235.3, mid(9.07, 4.03, 7), 7, f.r, C.mut);
  p.text(fmtDateTime(emittedAt), 286.8, mid(9.07, 4.03, 7), 7, f.b, C.gd, 'right');
  p.hline(7, 290, 13.81, 0.5, C.g);

  // Bloco do colaborador
  const jornadaSpan = (() => {
    const s = employee.scheduleStart?.match(/^(\d{1,2}):(\d{2})/); const e = employee.scheduleEnd?.match(/^(\d{1,2}):(\d{2})/);
    if (!s || !e) return null;
    return (Number(e[1]) * 60 + Number(e[2])) - (Number(s[1]) * 60 + Number(s[2]));
  })();
  const jornada = employee.scheduleStart && employee.scheduleEnd
    ? `${employee.scheduleStart.slice(0, 5)}–${employee.scheduleEnd.slice(0, 5)}${jornadaSpan !== null && jornadaSpan > 360 ? ' · 1h' : ''}`
    : 'Conforme escala';
  const emp: Array<[string, string, number, number]> = [
    ['COLABORADOR(A)', employee.name, 7.26, 75.78], ['MATRÍCULA', employee.employeeNumber || '—', 83.05, 31],
    ['CPF', employee.cpf || 'Não cadastrado', 114.05, 44.78], ['CARGO', employee.jobTitle || 'Colaborador(a)', 158.83, 41.34],
    ['JORNADA', jornada, 200.17, 44.78], ['COMPETÊNCIA', monthTitle(month), 244.95, 44.78],
  ];
  p.rrect(7, 15.46, 283, 7.51, 1.2, { stroke: C.line, sw: 0.3 });
  emp.forEach(([label, value, x, w], i) => {
    if (i) p.vline(x, 15.6, 22.83, 0.2, C.line2);
    p.text(label, x + 2.2, 18.2, 5.8, f.sb, C.mut, 'left', 0.08);
    p.text(p.fit(value, 9, f.b, w - 4.4), x + 2.2, 21.75, 9, f.b, C.gd);
  });

  // Tabela
  const xs: number[] = [TABLE.x];
  TABLE.cols.forEach((w) => xs.push(xs[xs.length - 1] + w));
  const tableW = xs[xs.length - 1] - TABLE.x;
  const BORDER = 0.24;
  p.rect(TABLE.x, TABLE.top, tableW, TABLE.headH, { fill: C.g });
  TABLE.heads.forEach((h, i) => p.text(h, (xs[i] + xs[i + 1]) / 2, mid(TABLE.top, TABLE.headH, 8), 8, f.b, C.white, 'center', 0.03));

  const BODY = 10;
  const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  rows.forEach((row: TimesheetRow, i) => {
    const top = TABLE.top + TABLE.headH + i * TABLE.rowH;
    const h = TABLE.rowH;
    const weekendLike = !row.scheduled;
    let bg: RGB | undefined = i % 2 === 1 ? C.gz : undefined;
    if (weekendLike) bg = C.we;
    else if (row.future) bg = undefined;
    else if (row.tone === 'feriado') bg = C.fer;
    else if (row.fullDayAbono) bg = C.abn;
    if (bg) p.rect(TABLE.x, top, tableW, h, { fill: bg });
    const base = mid(top, h, BODY);
    const color = row.future ? C.fut : weekendLike ? C.mut : C.ink;
    const center = (col: number, text: string, font: PDFFont, c: RGB = color) => p.text(text, (xs[col] + xs[col + 1]) / 2, base, BODY, font, c, 'center');

    p.text(`${String(row.day).padStart(2, '0')}/${String(monthNumber).padStart(2, '0')}`, xs[0] + 1.8, base, BODY, f.b, row.future ? C.fut : C.gd);
    center(1, days[row.weekday], f.sb, row.future ? C.fut : C.mut);
    p.text(row.schedule, xs[2] + 1.8, base, BODY, f.sb, color);
    ([row.entrada, row.intervalo, row.retorno, row.saida] as const).forEach((cell, k) => {
      const col = 3 + k;
      if (!cell) { center(col, '—', f.sb); return; }
      if (cell.manual) {
        p.rect(xs[col] + BORDER / 2, top + BORDER / 2, xs[col + 1] - xs[col] - BORDER, h - BORDER, { fill: C.goldl });
        const w = p.width(cell.time, BODY, f.b);
        const cx = (xs[col] + xs[col + 1]) / 2 - 0.8;
        p.text(cell.time, cx - w / 2, base, BODY, f.b, color);
        p.text('*', cx + w / 2 + 0.2, base - 0.9, 7.5, f.xb, C.star);
      } else center(col, cell.time, f.sb);
    });
    center(7, row.credited === null ? '—' : formatClock(row.credited), f.xb);
    center(8, row.expected === null ? '—' : formatClock(row.expected), f.sb);
    center(9, row.missing ? formatClock(row.missing) : '—', f.sb);
    if (row.balance === null) center(10, '—', f.sb);
    else center(10, formatSigned(row.balance), f.b, row.balance < 0 ? C.neg : row.balance > 0 ? C.g : color);

    // Situação
    const tag = TAGS[row.tone];
    const sx = xs[11] + 1.93; const maxW = xs[12] - sx - 1.2;
    if (!tag.bg) p.text(row.situation, sx, base, BODY, f.sb, tag.fg);
    else {
      const size = 8.8;
      const label = p.fit(row.situation, size, f.b, maxW - 3.2);
      const w = Math.max(11, p.width(label, size, f.b) + 3.2);
      const th = 3.1; const ty = top + (h - th) / 2;
      p.rrect(sx, ty, w, th, 0.8, { fill: tag.bg });
      p.text(label, sx + 1.6, mid(ty, th, size), size, f.b, tag.fg);
    }
  });

  // Totais
  const footTop = TABLE.top + TABLE.headH + rows.length * TABLE.rowH;
  p.rect(TABLE.x, footTop, tableW, TABLE.footH, { fill: C.gl });
  const fb = mid(footTop, TABLE.footH, 11);
  p.text(`TOTAIS DO MÊS · ${totals.workedDays} dias trabalhados`, xs[0] + 1.8, fb, 11, f.xb, C.gd, 'left', 0.06);
  const tf = (col: number, text: string, c: RGB = C.gd) => p.text(text, (xs[col] + xs[col + 1]) / 2, fb, 11, f.xb, c, 'center');
  tf(7, formatClock(totals.worked)); tf(8, formatClock(totals.expected)); tf(9, formatClock(totals.missing));
  tf(10, formatSigned(totals.balance), totals.balance < 0 ? C.neg : C.g);

  // Grade (por cima dos fundos)
  const bottom = footTop + TABLE.footH;
  for (let k = 0; k <= rows.length; k += 1) p.hline(TABLE.x, TABLE.x + tableW, TABLE.top + TABLE.headH + k * TABLE.rowH, BORDER, C.cell);
  p.hline(TABLE.x, TABLE.x + tableW, footTop, 0.45, C.g);
  p.hline(TABLE.x, TABLE.x + tableW, bottom, BORDER, C.cell);
  p.hline(TABLE.x, TABLE.x + tableW, TABLE.top, BORDER, C.gd);
  xs.forEach((x, k) => {
    if (k > 0 && k < xs.length - 1) p.vline(x, TABLE.top, TABLE.top + TABLE.headH, BORDER, C.gd);
    p.vline(x, TABLE.top + TABLE.headH, k > 0 && k < 7 ? footTop : bottom, BORDER, C.cell);
    if (k === 0 || k === xs.length - 1) p.vline(x, TABLE.top, TABLE.top + TABLE.headH, BORDER, C.gd);
  });

  // Nota do *
  const noteBase = 191.65;
  const sw = p.text('*', 7, noteBase, 7, f.xb, C.gold);
  p.text(' Marcação incluída pelo gestor · original preservado na auditoria', 7 + sw, noteBase, 7, f.r, C.mut);

  // Selo A1 (canto inferior esquerdo)
  p.rrect(SEAL.x, SEAL.y, SEAL.w, SEAL.h, 1.4, { fill: C.sealBg, stroke: C.g, sw: 0.4 });
  p.rrect(SEAL.x, SEAL.y, 1.6, SEAL.h, 0.6, { fill: C.g });
  drawShield(p, 11.18, 195.29, 7.5);
  p.text('ASSINADO DIGITALMENTE', 21.08, 196.0, 5.8, f.b, C.gold, 'left', 0.12);
  const sealSize = Math.max(5.6, Math.min(8.6, 8.6 * 34.5 / Math.max(1, p.width(company.name, 8.6, f.b))));
  p.text(company.name, 21.08, 199.65, sealSize, f.b, C.gd, 'left', 0.02);
  p.text(cnpjText, 21.08, 203.0, 6, f.r, C.mut);
  p.vline(56.2, 194.4, 203.7, 0.25, C.line);
  const meta: Array<[string, string]> = [
    ['Certificado', 'ICP-Brasil A1 (e-CNPJ)'], ['Data/hora', `${fmtDateTime(emittedAt, true)} (BRT)`],
    ['Integridade', 'Qualquer alteração invalida a assinatura'],
  ];
  meta.forEach(([k, v], i) => {
    const b = 196.75 + i * 2.85;
    p.text(k, 58.57, b, 6.3, f.r, C.mut);
    p.text(v, 74.57, b, 6.3, f.sb, C.ink);
  });

  // Assinatura do colaborador (canto inferior direito)
  p.rrect(SIGN.x, SIGN.y, SIGN.w, SIGN.h, 1.4, { fill: C.sbox, stroke: C.sboxLine, sw: 0.3 });
  p.hline(204, 284, 192.47, 0.35, C.ink);
  const nameText = p.fit(employee.name, 7.4, f.b, 46);
  const rest = ` · Colaborador(a) · Matrícula ${employee.employeeNumber || '—'}`;
  const total = p.width(nameText, 7.4, f.b) + p.width(rest, 7.4, f.r);
  const nx = 244 - total / 2;
  p.text(nameText, nx, 196.25, 7.4, f.b, C.ink);
  p.text(rest, nx + p.width(nameText, 7.4, f.b), 196.25, 7.4, f.r, C.ink);
  p.text('Data: ____/____/________', 244, 202.6, 10.5, f.sb, C.ink, 'center', 0.04);

  return { pdfDoc, page, rows, totals };
}

const SEAL_WIDGET: [number, number, number, number] = [SEAL.x * MM, PAGE_H - (SEAL.y + SEAL.h) * MM, (SEAL.x + SEAL.w) * MM, PAGE_H - SEAL.y * MM];

export async function createSignedTimesheetPdf({
  employee, punches, certificates = [], requests = [], month, certificate, password, options,
}: {
  employee: TimesheetEmployee;
  punches: TimesheetPunch[];
  certificates?: TimesheetCertificate[];
  requests?: TimesheetRequest[];
  month: string;
  certificate: Buffer;
  password: string;
  options?: TimesheetBuildOptions;
}) {
  const { pdfDoc, page } = await buildTimesheetDocument({ employee, punches, certificates, requests, month, options });
  pdflibAddPlaceholder({
    pdfDoc, pdfPage: page,
    reason: 'Assinatura institucional da Folha de Ponto',
    contactInfo: 'Espaço Progredir', name: 'Espaço Progredir', location: 'Nova Iguaçu - RJ',
    signatureLength: 20000, widgetRect: SEAL_WIDGET,
  });
  const pdfWithPlaceholder = Buffer.from(await pdfDoc.save());
  const signedPdf = await signpdf.sign(pdfWithPlaceholder, new P12Signer(certificate, { passphrase: password }));
  return Buffer.from(signedPdf);
}

export async function createSignedTimesheetPdfBatch({
  items, month, certificate, password, options,
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
  options?: TimesheetBuildOptions;
}) {
  if (!items.length) throw new Error('Nenhum colaborador para gerar folha');
  if (items.length === 1) {
    return createSignedTimesheetPdf({ ...items[0], month, certificate, password, options });
  }

  const merged = await PDFDocument.create();
  let lastPage: ReturnType<PDFDocument['addPage']> | null = null;

  for (const item of items) {
    const { pdfDoc: single } = await buildTimesheetDocument({ ...item, month, options });
    const bytes = await single.save();
    const src = await PDFDocument.load(bytes);
    const pages = await merged.copyPages(src, src.getPageIndices());
    for (const pg of pages) {
      merged.addPage(pg);
      lastPage = pg;
    }
  }

  if (!lastPage) throw new Error('Falha ao montar PDF em lote');

  pdflibAddPlaceholder({
    pdfDoc: merged, pdfPage: lastPage,
    reason: 'Assinatura institucional da Folha de Ponto (lote)',
    contactInfo: 'Espaço Progredir', name: 'Espaço Progredir', location: 'Nova Iguaçu - RJ',
    signatureLength: 20000, widgetRect: SEAL_WIDGET,
  });
  const pdfWithPlaceholder = Buffer.from(await merged.save());
  const signedPdf = await signpdf.sign(pdfWithPlaceholder, new P12Signer(certificate, { passphrase: password }));
  return Buffer.from(signedPdf);
}
