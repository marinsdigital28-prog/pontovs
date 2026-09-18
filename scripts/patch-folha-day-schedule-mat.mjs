import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/** Garante que resolveDaySchedule receba a matrícula (jornada fixa 0028 etc.). */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const panelPath = path.join(root, 'app/admin/folha-ponto-panel.tsx');

if (!fs.existsSync(panelPath)) {
  console.log('folha panel ausente, skip');
  process.exit(0);
}

let t = fs.readFileSync(panelPath, 'utf8');
if (!t.includes('resolveDaySchedule') || t.trim().startsWith('PLACEHOLDER')) {
  console.log('folha panel inválido, skip');
  process.exit(0);
}

const before = t;

// Padrão sem matrícula → com matrícula
t = t.replace(
  /resolveDaySchedule\(\s*employee\.scheduleByDay\s*,\s*employee\.workDays\s*,\s*employee\.scheduleStart\s*,\s*employee\.scheduleEnd\s*,\s*weekday\s*\)/g,
  'resolveDaySchedule(employee.scheduleByDay, employee.workDays, employee.scheduleStart, employee.scheduleEnd, weekday, employee.employeeNumber)',
);

if (t === before) {
  if (t.includes('weekday, employee.employeeNumber)')) {
    console.log('folha já passa matrícula ao resolveDaySchedule');
  } else {
    console.log('padrão resolveDaySchedule não encontrado');
  }
  process.exit(0);
}

fs.writeFileSync(panelPath, t);
console.log('folha: resolveDaySchedule agora usa matrícula');
