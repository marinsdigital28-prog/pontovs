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

// Cabeçalho sóbrio e profissional
if (!t.includes('Cabeçalho sóbrio')) {
  t = t.replace(
    `  page.drawText('EP  ESPAÇO PROGREDIR', { x: MX, y: PAGE_H - MY - 2, size: 9, font: bold, color: dark });\n  page.drawText('Estrada da Grama, 21 — Miguel Couto, Nova Iguaçu — RJ  ·  CNPJ 05.553.848/0001-61', {\n    x: MX, y: PAGE_H - MY - 12, size: 6, font: regular, color: muted,\n  });\n  page.drawText('RELATÓRIO DE PONTO DO COLABORADOR', {\n    x: PAGE_W / 2 - 95, y: PAGE_H - MY - 2, size: 9, font: bold, color: dark,\n  });\n  page.drawText(\`Período: \${periodLabel}\`, { x: right - 160, y: PAGE_H - MY - 2, size: 7, font: regular, color: muted });\n  page.drawText(\`Emissão: \${emitted}\`, { x: right - 160, y: PAGE_H - MY - 12, size: 6, font: regular, color: muted });\n  page.drawLine({ start: { x: MX, y: PAGE_H - MY - 18 }, end: { x: right, y: PAGE_H - MY - 18 }, thickness: 0.7, color: line });\n\n  const infoY = PAGE_H - MY - 30;\n  const jornada =\n    employee.scheduleStart && employee.scheduleEnd\n      ? \`\${employee.scheduleStart.slice(0, 5)} às \${employee.scheduleEnd.slice(0, 5)}\`\n      : '—';\n\n  page.drawText(\`Nome: \${employee.name}\`, { x: MX, y: infoY, size: 8, font: bold, color: dark, maxWidth: 260 });\n  page.drawText(\`Matrícula: \${employee.employeeNumber || '—'}\`, { x: MX + 270, y: infoY, size: 7.5, font: regular, color: dark });\n  page.drawText(\`CPF: \${employee.cpf || '—'}\`, { x: MX + 380, y: infoY, size: 7.5, font: regular, color: dark });\n  page.drawText(\`Cargo: \${employee.jobTitle || '—'}\`, { x: MX + 500, y: infoY, size: 7.5, font: regular, color: dark, maxWidth: 140 });\n  page.drawText(\`Departamento: \${employee.department || 'ADMINISTRATIVO'}\`, { x: MX, y: infoY - 11, size: 7, font: regular, color: dark });\n  page.drawText(\`Unidade: \${employee.unit || 'Espaço Progredir'}\`, { x: MX + 200, y: infoY - 11, size: 7, font: regular, color: dark });\n  page.drawText(\`Jornada: \${jornada}\`, { x: MX + 380, y: infoY - 11, size: 7, font: regular, color: dark });\n  page.drawLine({ start: { x: MX, y: infoY - 17 }, end: { x: right, y: infoY - 17 }, thickness: 0.5, color: line });`,
    `  // Cabeçalho sóbrio e profissional (sem destaque grande)\n  page.drawText('Espaço Progredir', { x: MX, y: PAGE_H - MY - 4, size: 7, font: regular, color: muted });\n  page.drawText('Estrada da Grama, 21 — Miguel Couto, Nova Iguaçu/RJ  ·  CNPJ 05.553.848/0001-61', {\n    x: MX, y: PAGE_H - MY - 13, size: 5.5, font: regular, color: muted,\n  });\n  page.drawText('Relatório de ponto', {\n    x: PAGE_W / 2 - 48, y: PAGE_H - MY - 4, size: 9, font: bold, color: dark,\n  });\n  page.drawText(\`Período: \${periodLabel}\`, { x: right - 175, y: PAGE_H - MY - 4, size: 7, font: regular, color: dark });\n  page.drawText(\`Emitido em: \${emitted}\`, { x: right - 175, y: PAGE_H - MY - 13, size: 5.5, font: regular, color: muted });\n  page.drawLine({ start: { x: MX, y: PAGE_H - MY - 18 }, end: { x: right, y: PAGE_H - MY - 18 }, thickness: 0.6, color: dark });\n\n  const infoY = PAGE_H - MY - 30;\n  const jornada =\n    employee.scheduleStart && employee.scheduleEnd\n      ? \`\${employee.scheduleStart.slice(0, 5)} às \${employee.scheduleEnd.slice(0, 5)}\`\n      : '—';\n\n  page.drawText(\`Colaborador: \${employee.name}\`, { x: MX, y: infoY, size: 8, font: bold, color: dark, maxWidth: 280 });\n  page.drawText(\`Matrícula: \${employee.employeeNumber || '—'}\`, { x: MX + 290, y: infoY, size: 7, font: regular, color: dark });\n  page.drawText(\`CPF: \${employee.cpf || '—'}\`, { x: MX + 400, y: infoY, size: 7, font: regular, color: dark });\n  page.drawText(\`Cargo: \${employee.jobTitle || '—'}\`, { x: MX + 520, y: infoY, size: 7, font: regular, color: dark, maxWidth: 130 });\n  page.drawText(\`Departamento: \${employee.department || 'Administrativo'}\`, { x: MX, y: infoY - 11, size: 6.5, font: regular, color: dark });\n  page.drawText(\`Unidade: \${employee.unit || 'Espaço Progredir'}\`, { x: MX + 200, y: infoY - 11, size: 6.5, font: regular, color: dark });\n  page.drawText(\`Jornada: \${jornada}\`, { x: MX + 400, y: infoY - 11, size: 6.5, font: regular, color: dark });\n  page.drawLine({ start: { x: MX, y: infoY - 16 }, end: { x: right, y: infoY - 16 }, thickness: 0.4, color: line });`,
  );
}

if (!t.includes('Moldura A4')) {
  t = t.replace(
    '  const right = PAGE_W - MX;\n\n  // Cabeçalho sóbrio',
    `  const right = PAGE_W - MX;\n\n  // Moldura A4 horizontal (dupla)\n  page.drawRectangle({\n    x: MX - 4, y: MY - 4, width: PAGE_W - 2 * (MX - 4), height: PAGE_H - 2 * (MY - 4),\n    borderColor: dark, borderWidth: 1.5,\n  });\n  page.drawRectangle({\n    x: MX - 1.5, y: MY - 1.5, width: PAGE_W - 2 * (MX - 1.5), height: PAGE_H - 2 * (MY - 1.5),\n    borderColor: green, borderWidth: 0.7,\n  });\n\n  // Cabeçalho sóbrio`,
  );
  if (!t.includes('Moldura A4')) {
    t = t.replace(
      '  const right = PAGE_W - MX;\n\n  page.drawText',
      `  const right = PAGE_W - MX;\n\n  // Moldura A4 horizontal (dupla)\n  page.drawRectangle({\n    x: MX - 4, y: MY - 4, width: PAGE_W - 2 * (MX - 4), height: PAGE_H - 2 * (MY - 4),\n    borderColor: dark, borderWidth: 1.5,\n  });\n  page.drawRectangle({\n    x: MX - 1.5, y: MY - 1.5, width: PAGE_W - 2 * (MX - 1.5), height: PAGE_H - 2 * (MY - 1.5),\n    borderColor: green, borderWidth: 0.7,\n  });\n\n  page.drawText`,
    );
  }
}

t = t.replace(
  'page.drawRectangle({ x: MX, y: tableTop - headerH, width: right - MX, height: headerH, color: headerBg });',
  'page.drawRectangle({ x: MX, y: tableTop - headerH, width: right - MX, height: headerH, color: rgb(0.12, 0.18, 0.16) });',
);
t = t.replace(
  'page.drawRectangle({ x: MX, y: tableTop - headerH, width: right - MX, height: headerH, color: green });',
  'page.drawRectangle({ x: MX, y: tableTop - headerH, width: right - MX, height: headerH, color: rgb(0.12, 0.18, 0.16) });',
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
    `  const tableBottom = tableTop - headerH - lastDay * rowH;\n  page.drawLine({ start: { x: MX, y: tableTop }, end: { x: MX, y: tableBottom }, thickness: 0.7, color: dark });\n  page.drawLine({ start: { x: right, y: tableTop }, end: { x: right, y: tableBottom }, thickness: 0.7, color: dark });\n  for (let ci = 1; ci < cols.length - 1; ci += 1) {\n    page.drawLine({ start: { x: cols[ci], y: tableTop }, end: { x: cols[ci], y: tableBottom }, thickness: 0.35, color: line });\n  }\n  page.drawLine({ start: { x: MX, y: tableTop }, end: { x: right, y: tableTop }, thickness: 0.8, color: dark });\n  page.drawLine({ start: { x: MX, y: tableBottom }, end: { x: right, y: tableBottom }, thickness: 0.8, color: dark });\n\n  const totY = footerReserve - 48;\n  page.drawRectangle({\n    x: MX, y: totY - 2, width: right - MX, height: 42,\n    borderColor: dark, borderWidth: 0.7, color: rgb(0.97, 0.98, 0.97),\n  });\n  page.drawLine({ start: { x: MX, y: totY + 36 }, end: { x: right, y: totY + 36 }, thickness: 0.5, color: line });`,
  );
}

t = t.replace(
  "page.drawRectangle({ x: MX, y: 10, width: 230, height: 28, color: rgb(0.94, 0.98, 0.95), borderColor: green, borderWidth: 0.5 });",
  "page.drawRectangle({ x: MX, y: 10, width: 230, height: 28, color: rgb(0.96, 0.96, 0.96), borderColor: dark, borderWidth: 0.7 });",
);
t = t.replace(
  "page.drawRectangle({ x: MX, y: 10, width: 230, height: 28, color: rgb(0.94, 0.98, 0.95), borderColor: green, borderWidth: 1 });",
  "page.drawRectangle({ x: MX, y: 10, width: 230, height: 28, color: rgb(0.96, 0.96, 0.96), borderColor: dark, borderWidth: 0.7 });",
);
t = t.replace(
  "page.drawText('ASSINADO DIGITALMENTE - ESPACO PROGREDIR', { x: MX + 4, y: 28, size: 6.5, font: bold, color: green });",
  "page.drawText('Documento assinado digitalmente', { x: MX + 4, y: 28, size: 6.5, font: bold, color: dark });",
);

fs.writeFileSync(outPath, t);
console.log('timesheet pdf patched', t.includes('Cabeçalho sóbrio'), t.includes('Moldura A4'), t.includes('tableBottom'), t.length);
