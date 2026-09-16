import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'app/admin/certificates-panel.tsx');
if (!fs.existsSync(target)) {
  console.log('panel missing');
  process.exit(0);
}
let t = fs.readFileSync(target, 'utf8');
if (t.includes('endDate: isHourly ? form.startDate')) {
  console.log('panel payload already clean');
  process.exit(0);
}
const old = `body: JSON.stringify({
        ...form,
        documentName: document?.name,
        documentMime: document?.mime,
        documentData: document?.data,
      }),`;
const neu = `body: JSON.stringify({
        userId: form.userId,
        type: form.type,
        startDate: form.startDate,
        endDate: isHourly ? form.startDate : (form.endDate || form.startDate),
        startTime: isHourly ? (form.startTime || null) : null,
        endTime: isHourly ? (form.endTime || null) : null,
        observation: form.observation || null,
        documentName: document?.name || null,
        documentMime: document?.mime || null,
        documentData: document?.data || null,
      }),`;
if (!t.includes(old)) {
  console.log('panel create body pattern not found');
  process.exit(0);
}
t = t.replace(old, neu);
fs.writeFileSync(target, t);
console.log('panel payload cleaned');
