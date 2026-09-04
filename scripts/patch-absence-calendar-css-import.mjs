import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const rel of ['app/admin/absence-calendar.tsx', 'app/admin/absence-calendar-live.tsx']) {
  const p = path.join(root, rel);
  let t = fs.readFileSync(p, 'utf8');
  if (!t.includes('absence-calendar.css')) {
    if (rel.endsWith('absence-calendar.tsx')) {
      t = t.replace("'use client';", "'use client';\n\nimport './absence-calendar.css';");
    } else {
      t = t.replace(
        "import AbsenceCalendar from './absence-calendar';",
        "import './absence-calendar.css';\nimport AbsenceCalendar from './absence-calendar';",
      );
    }
    fs.writeFileSync(p, t);
  }
  console.log(rel, t.includes('absence-calendar.css'));
}
