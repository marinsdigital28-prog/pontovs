import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'app/app');
const out = path.join(dir, 'employee-shell.tsx');
if (fs.existsSync(out)) {
  const cur = fs.readFileSync(out, 'utf8');
  if (cur.includes('cancelMyRequest') && cur.includes('Desmarcar') && cur.length > 10000) {
    console.log('employee-shell.tsx already complete', cur.length, 'bytes');
    process.exit(0);
  }
}
const parts = [];
for (let i = 0; ; i++) {
  const f = path.join(dir, `employee-shell.b64.${i}`);
  if (!fs.existsSync(f)) break;
  parts.push(fs.readFileSync(f, 'utf8').trim());
}
if (!parts.length) {
  console.error('no employee-shell.b64.*');
  process.exit(1);
}
const text = zlib.gunzipSync(Buffer.from(parts.join(''), 'base64')).toString('utf8');
fs.writeFileSync(out, text);
console.log('expanded employee-shell.tsx', text.length, 'bytes', text.includes('Desmarcar') ? 'HAS Desmarcar' : 'NO');
