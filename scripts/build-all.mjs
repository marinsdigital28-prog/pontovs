/**
 * Orquestra patches/expands do build (Vercel limita buildCommand a 256 chars).
 * Uso: node scripts/build-all.mjs
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

function run(cmd, args, { optional = false } = {}) {
  const label = [cmd, ...args].join(' ');
  console.log(`\n>>> ${label}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: false, env: process.env });
  if (r.status !== 0) {
    if (optional) {
      console.warn(`(opcional) falhou com código ${r.status}: ${label}`);
      return false;
    }
    console.error(`falhou com código ${r.status}: ${label}`);
    process.exit(r.status || 1);
  }
  return true;
}

function runNode(rel, opts) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) {
    if (opts?.optional) {
      console.warn(`(opcional) script ausente: ${rel}`);
      return false;
    }
    console.error(`script ausente: ${rel}`);
    process.exit(1);
  }
  return run(process.execPath, [full], opts);
}

// 1) inject v0 (opcional)
runNode('.v0/inject-built-with-v0.mjs', { optional: true });

// 2) patches de UI / PDF / calendário / jornada
const patches = [
  'scripts/patch-timesheet-pdf-borders.mjs',
  'scripts/patch-timesheet-signature-api.mjs',
  'scripts/patch-folha-preclose.mjs',
  'scripts/patch-folha-live-ui.mjs',
  'scripts/patch-absence-calendar-dashboard.mjs',
  'scripts/patch-absence-filter.mjs',
  'scripts/patch-absence-calendar-css-import.mjs',
  'scripts/patch-calendar-soft-ui.mjs',
  'scripts/patch-shifts-panel-dashboard.mjs',
  'scripts/patch-requests-calendar.mjs',
  'scripts/patch-folha-signature.mjs',
  'scripts/expand-employee-shell.mjs',
  'scripts/expand-folga.mjs',
  'scripts/patch-ponto-perf.mjs',
];

for (const p of patches) {
  runNode(p);
}

// 3) prisma + next
run('npx', ['prisma', 'generate']);
run('npx', ['prisma', 'db', 'push', '--skip-generate'], { optional: true });
run('npx', ['next', 'build']);

console.log('\n>>> build-all concluído');
