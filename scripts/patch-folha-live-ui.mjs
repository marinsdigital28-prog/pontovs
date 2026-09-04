import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const panelPath = path.join(root, 'app/admin/folha-ponto-panel.tsx');
let t = fs.readFileSync(panelPath, 'utf8');

if (!t.includes('folha-live-poll')) {
  t = t.replace(
    "useEffect(() => { void load(); }, [load]);",
    `useEffect(() => { void load(); }, [load]);\n  // folha-live-poll: atualiza sozinho quando batidas entram\n  useEffect(() => {\n    const id = window.setInterval(() => { void load(); }, 25000);\n    return () => window.clearInterval(id);\n  }, [load]);`,
  );
}

const theadOld = t.match(/<thead>[\s\S]*?<\/thead>/);
if (theadOld && !t.includes('<th>Trab.</th>')) {
  t = t.replace(
    theadOld[0],
    `<thead>\n                  <tr>\n                    <th>Data</th>\n                    <th>Escala</th>\n                    <th>Marcações</th>\n                    <th>Trab.</th>\n                    <th>Prev.</th>\n                    <th>Just.</th>\n                    <th>Saldo</th>\n                    <th>Situação</th>\n                  </tr>\n                </thead>`,
  );
  console.log('thead replaced');
}

if (t.includes('formatMinutes(row.missing)')) {
  t = t.replace(
    /<td>\{formatMinutes\(row\.worked\)\}<\/td>\s*<td>\{formatMinutes\(row\.justified\)\}<\/td>\s*<td>\{formatMinutes\(row\.expected\)\}<\/td>\s*<td>\{formatMinutes\(row\.missing\)\}<\/td>\s*<td>\{formatMinutes\(row\.surplus\)\}<\/td>\s*<td className=\{row\.balance !== null && row\.balance < 0 \? 'folha-neg' : row\.balance !== null && row\.balance > 0 \? 'folha-pos' : ''\}>\{formatMinutes\(row\.balance\)\}<\/td>\s*<td className="folha-col-sit">\{situation\}<\/td>/,
    `<td>{formatMinutes(row.worked)}</td>\n                        <td>{formatMinutes(row.expected)}</td>\n                        <td>{formatMinutes(row.justified)}</td>\n                        <td className={row.balance !== null && row.balance < 0 ? 'folha-neg' : row.balance !== null && row.balance > 0 ? 'folha-pos' : ''}>{formatMinutes(row.balance)}</td>\n                        <td className="folha-col-sit">{situation}</td>`,
  );
  console.log('row cells simplified');
}

t = t.replace(
  "row.certificate ? (row.punches.length ? 'ABONO + PONTO' : 'ABONO/ATESTADO')",
  "row.certificate ? (row.punches.length ? 'Atestado+ponto' : 'Atestado')",
);
t = t.replace(
  "row.absent ? 'FALTA' : row.late ? 'ATRASO' : isFolga ? 'FOLGA' : ''",
  "row.absent ? 'Falta' : row.late ? 'Atraso' : isFolga ? 'Folga' : (row.punches.length ? 'OK' : '')",
);

if (!t.includes('folha-live-dot')) {
  t = t.replace(
    '{batchProgress ? <span className="folha-batch-progress">{batchProgress}</span> : null}',
    `{batchProgress ? <span className="folha-batch-progress">{batchProgress}</span> : null}\n        <span className="folha-live-dot" title="Atualiza sozinho a cada 25s">Ao vivo</span>`,
  );
}

fs.writeFileSync(panelPath, t);
console.log('panel live ui', t.includes('folha-live-poll'), t.includes('Trab.'));
