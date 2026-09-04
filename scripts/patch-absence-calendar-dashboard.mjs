import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dashPath = path.join(root, 'app/admin/admin-dashboard.tsx');
let t = fs.readFileSync(dashPath, 'utf8');

if (!t.includes("from './absence-calendar-live'")) {
  t = t.replace(
    "import OverviewExitWatch from './overview-exit-watch';",
    "import OverviewExitWatch from './overview-exit-watch';\nimport AbsenceCalendarLive from './absence-calendar-live';",
  );
}
if (!t.includes('<AbsenceCalendarLive')) {
  t = t.replace(
    '<OverviewCalendar />',
    '<AbsenceCalendarLive />\n      <OverviewCalendar />',
  );
}
fs.writeFileSync(dashPath, t);
console.log('dashboard absence calendar', t.includes('AbsenceCalendarLive'));
