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

if (!t.includes('Cabeçalho moderno')) {
  t = t.replace(
    `  page.drawText('EP  ESPAÇO PROGREDIR', { x: MX, y: PAGE_H - MY - 2, size: 9, font: bold, color: dark });\n  page.drawText('Estrada da Grama, 21 — Miguel Couto, Nova Iguaçu — RJ  ·  CNPJ 05.553.848/0001-61', {\n    x: MX, y: PAGE_H - MY - 12, size: 6, font: regular, color: muted,\n  });\n  page.drawText('RELATÓRIO DE PONTO DO COLABORADOR', {\n    x: PAGE_W / 2 - 95, y: PAGE_H - MY - 2, size: 9, font: bold, color: dark,\n  });\n  page.drawText(\`Período: \${periodLabel}\`, { x: right - 160, y: PAGE_H - MY - 2, size: 7, font: regular, color: muted });\n  page.drawText(\`Emissão: \${emitted}\`, { x: right - 160, y: PAGE_H - MY - 12, size: 6, font: regular, color: muted });\n  page.drawLine({ start: { x: MX, y: PAGE_H - MY - 18 }, end: { x: right, y: PAGE_H - MY - 18 }, thickness: 0.7, color: line });\n\n  const infoY = PAGE_H - MY - 30;\n  const jornada =\n    employee.scheduleStart && employee.scheduleEnd\n      ? \`\${employee.scheduleStart.slice(0, 5)} às \${employee.scheduleEnd.slice(0, 5)}\`\n      : '—';\n\n  page.drawText(\`Nome: \${employee.name}\`, { x: MX, y: infoY, size: 8, font: bold, color: dark, maxWidth: 260 });\n  page.drawText(\`Matrícula: \${employee.employeeNumber || '—'}\`, { x: MX + 270, y: infoY, size: 7.5, font: regular, color: dark });\n  page.drawText(\`CPF: \${employee.cpf || '—'}\`, { x: MX + 380, y: infoY, size: 7.5, font: regular, color: dark });\n  page.drawText(\`Cargo: \${employee.jobTitle || '—'}\`, { x: MX + 500, y: infoY, size: 7.5, font: regular, color: dark, maxWidth: 140 });\n  page.drawText(\`Departamento: \${employee.department || 'ADMINISTRATIVO'}\`, { x: MX, y: infoY - 11, size: 7, font: regular, color: dark });\n  page.drawText(\`Unidade: \${employee.unit || 'Espaço Progredir'}\`, { x: MX + 200, y: infoY - 11, size: 7, font: regular, color: dark });\n  page.drawText(\`Jornada: \${jornada}\`, { x: MX + 380, y: infoY - 11, size: 7, font: regular, color: dark });\n  page.drawLine({ start: { x: MX, y: infoY - 17 }, end: { x: right, y: infoY - 17 }, thickness: 0.5, color: line });`,
    `  // Cabeçalho moderno — limpo, legível, sem cara de documento antigo\n  page.drawText('Espaço Progredir', { x: MX, y: PAGE_H - MY - 3, size: 8, font: bold, color: green });\n  page.drawText('Estrada da Grama, 21 · Miguel Couto, Nova Iguaçu/RJ · CNPJ 05.553.848/0001-61', {\n    x: MX, y: PAGE_H - MY - 12, size: 5.5, font: regular, color: muted,\n  });\n  page.drawText('Relatório de ponto', {\n    x: PAGE_W / 2 - 52, y: PAGE_H - MY - 5, size: 11, font: bold, color: dark,\n  });\n  page.drawText(\`\${periodLabel}\`, { x: right - 155, y: PAGE_H - MY - 3, size: 7.5, font: bold, color: dark });\n  page.drawText(\`Emitido em \${emitted}\`, { x: right - 155, y: PAGE_H - MY - 12, size: 5.5, font: regular, color: muted });\n  page.drawRectangle({ x: MX, y: PAGE_H - MY - 17, width: right - MX, height: 1.8, color: green });\n\n  const infoY = PAGE_H - MY - 30;\n  const jornada =\n    employee.scheduleStart && employee.scheduleEnd\n      ? \`\${employee.scheduleStart.slice(0, 5)} – \${employee.scheduleEnd.slice(0, 5)}\`\n      : '—';\n\n  page.drawText(employee.name, { x: MX, y: infoY, size: 9, font: bold, color: dark, maxWidth: 260 });\n  page.drawText(\`Matrícula \${employee.employeeNumber || '—'}\`, { x: MX + 270, y: infoY, size: 7.5, font: regular, color: dark });\n  page.drawText(\`CPF \${employee.cpf || '—'}\`, { x: MX + 380, y: infoY, size: 7.5, font: regular, color: dark });\n  page.drawText(\`\${employee.jobTitle || 'Colaborador'}\`, { x: MX + 500, y: infoY, size: 7.5, font: regular, color: dark, maxWidth: 140 });\n  page.drawText(\`\${employee.department || 'Administrativo'}  ·  \${employee.unit || 'Espaço Progredir'}  ·  Jornada \${jornada}\`, {\n    x: MX, y: infoY - 11, size: 6.5, font: regular, color: muted,\n  });\n  page.drawLine({ start: { x: MX, y: infoY - 16 }, end: { x: right, y: infoY - 16 }, thickness: 0.4, color: line });`,
  );
}

if (!t.includes('Moldura moderna')) {
  const molduraBlock = `  const right = PAGE_W - MX;\n\n  // Moldura moderna (borda única, leve)\n  page.drawRectangle({\n    x: MX - 3, y: MY - 3, width: PAGE_W - 2 * (MX - 3), height: PAGE_H - 2 * (MY - 3),\n    borderColor: rgb(0.15, 0.22, 0.2), borderWidth: 1.1,\n  });\n\n  `;
  if (t.includes('Cabeçalho moderno')) {
    t = t.replace('  const right = PAGE_W - MX;\n\n  // Cabeçalho moderno', molduraBlock + '// Cabeçalho moderno');
  } else {
    t = t.replace('  const right = PAGE_W - MX;\n\n  page.drawText', molduraBlock + 'page.drawText');
  }
}

t = t.replace(
  'page.drawRectangle({ x: MX, y: tableTop - headerH, width: right - MX, height: headerH, color: headerBg });',
  'page.drawRectangle({ x: MX, y: tableTop - headerH, width: right - MX, height: headerH, color: rgb(0.08, 0.32, 0.24) });',
);
t = t.replace(
  'page.drawRectangle({ x: MX, y: tableTop - headerH, width: right - MX, height: headerH, color: green });',
  'page.drawRectangle({ x: MX, y: tableTop - headerH, width: right - MX, height: headerH, color: rgb(0.08, 0.32, 0.24) });',
);
t = t.replace(
  'page.drawRectangle({ x: MX, y: tableTop - headerH, width: right - MX, height: headerH, color: rgb(0.12, 0.18, 0.16) });',
  'page.drawRectangle({ x: MX, y: tableTop - headerH, width: right - MX, height: headerH, color: rgb(0.08, 0.32, 0.24) });',
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
    `  const tableBottom = tableTop - headerH - lastDay * rowH;\n  page.drawLine({ start: { x: MX, y: tableTop }, end: { x: MX, y: tableBottom }, thickness: 0.6, color: line });\n  page.drawLine({ start: { x: right, y: tableTop }, end: { x: right, y: tableBottom }, thickness: 0.6, color: line });\n  for (let ci = 1; ci < cols.length - 1; ci += 1) {\n    page.drawLine({ start: { x: cols[ci], y: tableTop }, end: { x: cols[ci], y: tableBottom }, thickness: 0.3, color: line });\n  }\n  page.drawLine({ start: { x: MX, y: tableTop }, end: { x: right, y: tableTop }, thickness: 0.7, color: dark });\n  page.drawLine({ start: { x: MX, y: tableBottom }, end: { x: right, y: tableBottom }, thickness: 0.7, color: dark });\n\n  const totY = footerReserve - 48;\n  page.drawRectangle({\n    x: MX, y: totY - 2, width: right - MX, height: 42,\n    borderColor: line, borderWidth: 0.6, color: rgb(0.97, 0.99, 0.98),\n  });\n  page.drawRectangle({ x: MX, y: totY + 38, width: 3, height: 4, color: green });\n  page.drawLine({ start: { x: MX, y: totY + 36 }, end: { x: right, y: totY + 36 }, thickness: 0.4, color: line });`,
  );
}

t = t.replace(
  "page.drawRectangle({ x: MX, y: 10, width: 230, height: 28, color: rgb(0.94, 0.98, 0.95), borderColor: green, borderWidth: 0.5 });",
  "page.drawRectangle({ x: MX, y: 10, width: 240, height: 28, color: rgb(0.96, 0.98, 0.97), borderColor: line, borderWidth: 0.7 });",
);
t = t.replace(
  "page.drawText('ASSINADO DIGITALMENTE - ESPACO PROGREDIR', { x: MX + 4, y: 28, size: 6.5, font: bold, color: green });",
  "page.drawText('Assinado digitalmente', { x: MX + 6, y: 28, size: 7, font: bold, color: dark });",
);

fs.writeFileSync(outPath, t);
console.log('timesheet modern', t.includes('Cabeçalho moderno'), t.includes('Moldura moderna'), t.includes('tableBottom'), t.length);
