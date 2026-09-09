import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const panelPath = path.join(root, 'app/admin/folha-ponto-panel.tsx');

const GOOD_SHA = '605e9e1c7210a8cc71468f1de674da768708c63c';
const RAW = `https://raw.githubusercontent.com/marinsdigital28-prog/pontovs/${GOOD_SHA}/app/admin/folha-ponto-panel.tsx`;

async function main() {
  let t = fs.existsSync(panelPath) ? fs.readFileSync(panelPath, 'utf8') : '';
  if (!t.includes('export default function FolhaPontoPanel') || t.trim() === 'PLACEHOLDER') {
    console.log('folha panel missing/placeholder — fetching good version...');
    const res = await fetch(RAW);
    if (!res.ok) throw new Error('fetch panel failed ' + res.status);
    t = await res.text();
  }

  if (!t.includes('folha-sit')) {
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
    if (t.includes("row.punches.length ? 'OK' : '';")) {
      t = t.replace(
        /const situation = row\.certificate[\s\S]*?row\.punches\.length \? 'OK' : '';/,
        newSit.trim()
      );
    }
    t = t.replace(
      '<td className="folha-col-sit">{situation}</td>',
      '<td className="folha-col-sit">{situation ? <span className={`folha-sit ${sitClass}`}>{situation}</span> : \'—\'}</td>'
    );
  }

  fs.writeFileSync(panelPath, t);
  console.log('folha panel polished', fs.statSync(panelPath).size, t.includes('folha-sit') ? 'with badges' : 'no badges');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
