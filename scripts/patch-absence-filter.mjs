import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const p = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'app/admin/absence-calendar.tsx');
let t = fs.readFileSync(p, 'utf8');
t = t.replace(".filter((item) => item.type === 'AUSENCIA')", ".filter((item) => ['AUSENCIA','PASSEIO','EVENTO_EXTERNO'].includes(item.type))");
fs.writeFileSync(p, t);
console.log('absence filter', t.includes('PASSEIO'));
