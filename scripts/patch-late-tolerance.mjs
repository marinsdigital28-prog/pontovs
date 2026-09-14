import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/** Tolerância de entrada (minutos) antes de marcar ATRASO */
const TOLERANCE_MINUTES = 15;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const panelPath = path.join(root, 'app/admin/folha-ponto-panel.tsx');

if (!fs.existsSync(panelPath)) {
  console.log('panel ausente, skip');
  process.exit(0);
}

let t = fs.readFileSync(panelPath, 'utf8');
if (!t.includes('export default function FolhaPontoPanel') || t.trim().startsWith('PLACEHOLDER')) {
  console.log('panel inválido, skip late tolerance');
  process.exit(0);
}

const before = t;

// Padrão antigo: scheduleStart + 5 (ou qualquer número)
t = t.replace(
  /firstPunchMinutes\s*>\s*scheduleStart\s*\+\s*\d+/g,
  `firstPunchMinutes > scheduleStart + ${TOLERANCE_MINUTES}`,
);

// Também cobre dayStart se já existir
t = t.replace(
  /firstPunchMinutes\s*>\s*dayStart\s*\+\s*\d+/g,
  `firstPunchMinutes > dayStart + ${TOLERANCE_MINUTES}`,
);

if (t === before) {
  if (t.includes(`scheduleStart + ${TOLERANCE_MINUTES}`) || t.includes(`dayStart + ${TOLERANCE_MINUTES}`)) {
    console.log('tolerância já em', TOLERANCE_MINUTES, 'min');
  } else {
    console.log('padrão de atraso não encontrado');
  }
  process.exit(0);
}

fs.writeFileSync(panelPath, t);
console.log('tolerância de atraso =', TOLERANCE_MINUTES, 'min');
