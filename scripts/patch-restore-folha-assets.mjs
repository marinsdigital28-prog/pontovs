import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
  return res.text();
}

const GOOD_PANEL = '7e7b290decae4398c6c7d9b8ef42bb23e65fd501';
const GOOD_PDF = 'e4f876610e0ccb6404a99ba0b2436068284e64b9';
const GOOD_CSS = '604b759a28cd1956ca0b680de2848b709e51aaef';

const panelPath = path.join(root, 'app/admin/folha-ponto-panel.tsx');
const pdfPath = path.join(root, 'lib/signed-timesheet-pdf.ts');
const cssPath = path.join(root, 'app/admin/folha-ponto.css');

let panel = fs.existsSync(panelPath) ? fs.readFileSync(panelPath, 'utf8') : '';
if (!panel.includes('export default function FolhaPontoPanel') || panel.trim().startsWith('PLACEHOLDER')) {
  console.log('restoring panel from', GOOD_PANEL);
  panel = await fetchText(`https://raw.githubusercontent.com/marinsdigital28-prog/pontovs/${GOOD_PANEL}/app/admin/folha-ponto-panel.tsx`);
  if (!panel.includes('folha-sit') && panel.includes("row.punches.length ? 'OK' : '';")) {
    const newSit = `const situation = row.certificate || (row.justified && row.justified > 0)\n                      ? (row.punches.length ? 'ABONO + PONTO' : 'ABONO/ATESTADO')\n                      : row.absent ? 'FALTA'\n                      : row.incomplete ? 'INCOMPLETO'\n                      : row.late ? 'ATRASO'\n                      : isFolga ? 'FOLGA'\n                      : row.punches.length ? 'OK' : '';\n                    const sitClass =\n                      situation.startsWith('ABONO') ? 'folha-sit-abono'\n                      : situation === 'FALTA' ? 'folha-sit-falta'\n                      : situation === 'INCOMPLETO' ? 'folha-sit-incompleto'\n                      : situation === 'ATRASO' ? 'folha-sit-atraso'\n                      : situation === 'FOLGA' ? 'folha-sit-folga'\n                      : situation === 'OK' ? 'folha-sit-ok'\n                      : '';`;
    panel = panel.replace(/const situation = row\.certificate[\s\S]*?row\.punches\.length \? 'OK' : '';/, newSit.trim());
    panel = panel.replace(
      '<td className="folha-col-sit">{situation}</td>',
      "<td className=\"folha-col-sit\">{situation ? <span className={`folha-sit ${sitClass}`}>{situation}</span> : '—'}</td>"
    );
  }
  fs.writeFileSync(panelPath, panel);
  console.log('panel restored', panel.length);
} else {
  console.log('panel ok', panel.length);
}

let pdf = fs.existsSync(pdfPath) ? fs.readFileSync(pdfPath, 'utf8') : '';
if (!pdf.includes('createSignedTimesheetPdf') || pdf.trim().startsWith('PLACEHOLDER')) {
  console.log('restoring pdf from', GOOD_PDF);
  pdf = await fetchText(`https://raw.githubusercontent.com/marinsdigital28-prog/pontovs/${GOOD_PDF}/lib/signed-timesheet-pdf.ts`);
  if (pdf.includes("page.drawText('ESPAÇO PROGREDIR'") && !pdf.includes('// moldura-externa')) {
    pdf = pdf.replace(
      "page.drawText('ESPAÇO PROGREDIR'",
      `// moldura-externa\n  page.drawRectangle({ x: MX - 3, y: MY - 3, width: right - MX + 6, height: PAGE_H - 2 * MY + 6, borderColor: green, borderWidth: 1.3 });\n  page.drawRectangle({ x: MX - 0.5, y: MY - 0.5, width: right - MX + 1, height: PAGE_H - 2 * MY + 1, borderColor: rgb(0.788, 0.635, 0.153), borderWidth: 0.6 });\n  page.drawText('ESPAÇO PROGREDIR'`
    );
  }
  if (pdf.includes('page.drawRectangle({ x: MX, y: PAGE_H - MY - 22, width: right - MX, height: 1.2, color: green });') && !pdf.includes('gold-line')) {
    pdf = pdf.replace(
      'page.drawRectangle({ x: MX, y: PAGE_H - MY - 22, width: right - MX, height: 1.2, color: green });',
      `page.drawRectangle({ x: MX, y: PAGE_H - MY - 22, width: right - MX, height: 1.2, color: green });\n  // gold-line\n  page.drawRectangle({ x: MX, y: PAGE_H - MY - 24, width: right - MX, height: 0.9, color: rgb(0.788, 0.635, 0.153) });`
    );
  }
  fs.writeFileSync(pdfPath, pdf);
  console.log('pdf restored', pdf.length);
} else {
  console.log('pdf ok', pdf.length);
}

let css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : '';
if (!css.includes('.folha-table') || css.trim().startsWith('PLACEHOLDER')) {
  console.log('restoring css from', GOOD_CSS);
  css = await fetchText(`https://raw.githubusercontent.com/marinsdigital28-prog/pontovs/${GOOD_CSS}/app/admin/folha-ponto.css`);
  fs.writeFileSync(cssPath, css);
  console.log('css restored', css.length);
} else {
  console.log('css ok', css.length);
}
