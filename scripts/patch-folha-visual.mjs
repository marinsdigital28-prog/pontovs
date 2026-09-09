import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const panelPath = path.join(root, 'app/admin/folha-ponto-panel.tsx');
const restore = path.join(root, 'scripts/restore-folha-panel-local.mjs');

let t = fs.existsSync(panelPath) ? fs.readFileSync(panelPath, 'utf8') : '';
if (!t.includes('export default function FolhaPontoPanel') || t.trim() === 'PLACEHOLDER') {
  console.log('folha panel missing/placeholder — restoring from local b64 parts...');
  const r = spawnSync(process.execPath, [restore], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
  t = fs.readFileSync(panelPath, 'utf8');
}

if (!t.includes('folha-sit') && t.includes("row.punches.length ? 'OK' : '';")) {
  const newSit = `const situation = row.certificate || (row.justified && row.justified > 0)
                      ? (row.punches.length ? 'ABONO + PONTO' : 'ABONO/ATESTADO')
                      : row.absent ? 'FALTA'
                      : row.incomplete ? 'INCOMPLETO'
                      : row.late ? 'ATRASO'
                      : isFolga ? 'FOLGA'
                      : row.punches.length ? 'OK' : '';
                    const sitClass =
                      situation.startsWith('ABONO') ? 'folha-sit-abono'
                      : situation === 'FALTA' ? 'folha-sit-falta'
                      : situation === 'INCOMPLETO' ? 'folha-sit-incompleto'
                      : situation === 'ATRASO' ? 'folha-sit-atraso'
                      : situation === 'FOLGA' ? 'folha-sit-folga'
                      : situation === 'OK' ? 'folha-sit-ok'
                      : '';`;
  t = t.replace(
    /const situation = row\.certificate[\s\S]*?row\.punches\.length \? 'OK' : '';/,
    newSit.trim()
  );
  t = t.replace(
    '<td className="folha-col-sit">{situation}</td>',
    "<td className=\"folha-col-sit\">{situation ? <span className={`folha-sit ${sitClass}`}>{situation}</span> : '—'}</td>"
  );
  fs.writeFileSync(panelPath, t);
  console.log('folha panel badges applied');
} else {
  console.log('folha panel ok', fs.statSync(panelPath).size);
}
