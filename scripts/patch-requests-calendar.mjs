import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const p = path.join(root, 'app/admin/requests-panel.tsx');
let t = fs.readFileSync(p, 'utf8');

if (!t.includes("from './absence-calendar-live'")) {
  t = t.replace("'use client';", "'use client';\n\nimport AbsenceCalendarLive from './absence-calendar-live';");
}
if (!t.includes('<AbsenceCalendarLive')) {
  if (t.includes('return <section className="card">')) {
    t = t.replace('return <section className="card">', 'return <><AbsenceCalendarLive /><section className="card">');
    t = t.replace('</section>;\n}', '</section></>;\n}');
  }
}
fs.writeFileSync(p, t);
console.log('requests calendar', t.includes('AbsenceCalendarLive'));
