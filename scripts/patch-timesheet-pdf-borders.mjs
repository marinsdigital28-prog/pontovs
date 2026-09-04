import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outPath = path.join(root, 'lib/signed-timesheet-pdf.ts');

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        get(res.headers.location).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error('HTTP ' + res.statusCode));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    }).on('error', reject);
  });
}

const BASE = 'https://raw.githubusercontent.com/marinsdigital28-prog/pontovs/e59d028cf28e5421d8dfab60dc36839bf912b1f3/lib/signed-timesheet-pdf.ts';
let t = await get(BASE);

if (!t.includes('Moldura A4')) {
  t = t.replace(
    '  const right = PAGE_W - MX;\n\n  page.drawText',
    `  const right = PAGE_W - MX;\n\n  // Moldura A4 horizontal (dupla)\n  page.drawRectangle({\n    x: MX - 4, y: MY - 4, width: PAGE_W - 2 * (MX - 4), height: PAGE_H - 2 * (MY - 4),\n    borderColor: dark, borderWidth: 1.5,\n  });\n  page.drawRectangle({\n    x: MX - 1.5, y: MY - 1.5, width: PAGE_W - 2 * (MX - 1.5), height: PAGE_H - 2 * (MY - 1.5),\n    borderColor: green, borderWidth: 0.7,\n  });\n\n  page.drawText`,
  );
}

t = t.replace(
  'page.drawRectangle({ x: MX, y: tableTop - headerH, width: right - MX, height: headerH, color: headerBg });',
  'page.drawRectangle({ x: MX, y: tableTop - headerH, width: right - MX, height: headerH, color: green });',
);
t = t.replace(
  'page.drawText(h, {\n      x: cols[i] + 2, y: tableTop - 9, size: 5.5, font: bold, color: dark,',
  'page.drawText(h, {\n      x: cols[i] + 2, y: tableTop - 9, size: 6, font: bold, color: rgb(1, 1, 1),',
);
t = t.replace(
  'const fs = rowH >= 13 ? 6.5 : rowH >= 11.5 ? 6 : 5.5;',
  'const fs = rowH >= 13 ? 7 : rowH >= 11.5 ? 6.5 : 6;',
);

if (!t.includes('tableBottom')) {
  t = t.replace(
    `  const totY = footerReserve - 48;\n  page.drawLine({ start: { x: MX, y: totY + 36 }, end: { x: right, y: totY + 36 }, thickness: 0.8, color: dark });`,
    `  // Bordas verticais e contorno da tabela\n  const tableBottom = tableTop - headerH - lastDay * rowH;\n  page.drawLine({ start: { x: MX, y: tableTop }, end: { x: MX, y: tableBottom }, thickness: 0.7, color: dark });\n  page.drawLine({ start: { x: right, y: tableTop }, end: { x: right, y: tableBottom }, thickness: 0.7, color: dark });\n  for (let ci = 1; ci < cols.length - 1; ci += 1) {\n    page.drawLine({ start: { x: cols[ci], y: tableTop }, end: { x: cols[ci], y: tableBottom }, thickness: 0.35, color: line });\n  }\n  page.drawLine({ start: { x: MX, y: tableTop }, end: { x: right, y: tableTop }, thickness: 0.8, color: dark });\n  page.drawLine({ start: { x: MX, y: tableBottom }, end: { x: right, y: tableBottom }, thickness: 0.8, color: dark });\n\n  const totY = footerReserve - 48;\n  page.drawRectangle({\n    x: MX, y: totY - 2, width: right - MX, height: 42,\n    borderColor: dark, borderWidth: 0.8, color: rgb(0.97, 0.98, 0.97),\n  });\n  page.drawLine({ start: { x: MX, y: totY + 36 }, end: { x: right, y: totY + 36 }, thickness: 0.5, color: line });`,
  );
}

t = t.replace(
  "page.drawRectangle({ x: MX, y: 10, width: 230, height: 28, color: rgb(0.94, 0.98, 0.95), borderColor: green, borderWidth: 0.5 });",
  "page.drawRectangle({ x: MX, y: 10, width: 230, height: 28, color: rgb(0.94, 0.98, 0.95), borderColor: green, borderWidth: 1 });",
);

fs.writeFileSync(outPath, t);
console.log('timesheet pdf borders patched', t.includes('Moldura A4'), t.includes('tableBottom'), t.length);
