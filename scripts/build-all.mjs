/**
 * Build de produção: prisma generate, sincroniza schema (opcional) e next build.
 * O código-fonte completo agora está versionado — não há mais patches em tempo de build.
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
    if (optional) { console.warn(`(opcional) falhou com código ${r.status}: ${label}`); return false; }
    console.error(`falhou com código ${r.status}: ${label}`);
    process.exit(r.status || 1);
  }
  return true;
}

const v0 = path.join(root, '.v0/inject-built-with-v0.mjs');
if (fs.existsSync(v0)) run(process.execPath, [v0], { optional: true });

run('npx', ['prisma', 'generate']);
run('npx', ['prisma', 'db', 'push', '--skip-generate'], { optional: true });
run('npx', ['next', 'build']);
console.log('\n>>> build-all concluído');
