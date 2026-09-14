import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const panelPath = path.join(root, 'app/admin/folha-ponto-panel.tsx');

if (!fs.existsSync(panelPath)) {
  console.log('panel ausente, skip');
  process.exit(0);
}

let t = fs.readFileSync(panelPath, 'utf8');
if (!t.includes('export default function FolhaPontoPanel') || t.trim().startsWith('PLACEHOLDER')) {
  console.log('panel inválido, skip header patch');
  process.exit(0);
}

if (t.includes('folha-print-header')) {
  console.log('print header já aplicado');
  process.exit(0);
}

const oldHeading =
  '<div className="section-heading">\n' +
  '              <div>\n' +
  '                <h3>{employee.name}</h3>\n' +
  "                <p className=\"small-muted\">{employee.employeeNumber || 'Sem matrícula'} · {monthLabel(month)}</p>\n" +
  '              </div>';

const newHeading =
  '<div className="section-heading folha-emp-heading">\n' +
  '              <div className="folha-print-header">\n' +
  '                <div className="folha-print-org">ESPAÇO PROGREDIR · Folha de ponto</div>\n' +
  '                <h3>{employee.name}</h3>\n' +
  '                <p className="folha-print-meta">\n' +
  '                  <span><b>Matrícula:</b> {employee.employeeNumber || \'—\'}</span>\n' +
  '                  <span><b>CPF:</b> {employee.cpf || \'—\'}</span>\n' +
  '                  <span><b>Cargo:</b> {employee.jobTitle || \'—\'}</span>\n' +
  '                </p>\n' +
  '                <p className="folha-print-meta">\n' +
  '                  <span><b>Jornada:</b> {employee.scheduleStart && employee.scheduleEnd\n' +
  '                    ? `${employee.scheduleStart.slice(0, 5)}–${employee.scheduleEnd.slice(0, 5)}`\n' +
  "                    : 'Conforme escala'}</span>\n" +
  '                  <span><b>Competência:</b> {monthLabel(month)}</span>\n' +
  '                </p>\n' +
  '              </div>';

if (t.includes(oldHeading)) {
  t = t.replace(oldHeading, newHeading);
} else {
  const re =
    /<div className="section-heading">\s*<div>\s*<h3>\{employee\.name\}<\/h3>\s*<p className="small-muted">\{employee\.employeeNumber \|\| 'Sem matrícula'\} · \{monthLabel\(month\)\}<\/p>\s*<\/div>/;
  if (!re.test(t)) {
    console.log('padrão de heading não encontrado');
    process.exit(0);
  }
  t = t.replace(re, newHeading);
}

fs.writeFileSync(panelPath, t);
console.log('print header aplicado', fs.statSync(panelPath).size);
