import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const panelPath = path.join(root, 'app/admin/folha-ponto-panel.tsx');

// Commit onde o painel ainda estava completo (antes do PLACEHOLDER)
const GOOD_COMMIT = '7e7b290decae4398c6c7d9b8ef42bb23e65fd501';
const RAW = `https://raw.githubusercontent.com/marinsdigital28-prog/pontovs/${GOOD_COMMIT}/app/admin/folha-ponto-panel.tsx`;

async function main() {
  let t = fs.existsSync(panelPath) ? fs.readFileSync(panelPath, 'utf8') : '';
  const broken = !t.includes('export default function FolhaPontoPanel') || t.trim() === 'PLACEHOLDER';

  if (broken) {
    console.log('folha panel PLACEHOLDER/quebrado — baixando versao boa do commit', GOOD_COMMIT);
    const res = await fetch(RAW);
    if (!res.ok) {
      throw new Error('fetch panel failed ' + res.status + ' url=' + RAW);
    }
    t = await res.text();
    if (!t.includes('export default function FolhaPontoPanel')) {
      throw new Error('conteudo baixado nao parece o painel');
    }
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
    console.log('folha panel: badges de situacao aplicados');
  }

  fs.writeFileSync(panelPath, t);
  console.log('folha panel ok', fs.statSync(panelPath).size, t.includes('folha-sit') ? 'com badges' : 'sem badges');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
