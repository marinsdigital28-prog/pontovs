import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'app/app');
const parts = [];
for (let i = 0; ; i++) {
  const f = path.join(dir, `employee-shell.b64.${i}`);
  if (!fs.existsSync(f)) break;
  parts.push(fs.readFileSync(f, 'utf8').trim());
}
if (!parts.length) {
  console.error('no employee-shell.b64.* parts');
  process.exit(1);
}
const b64 = parts.join('');
const buf = Buffer.from(b64, 'base64');
const text = zlib.gunzipSync(buf).toString('utf8');
const out = path.join(dir, 'employee-shell.tsx');
fs.writeFileSync(out, text);
console.log('expanded employee-shell.tsx', text.length, 'bytes', text.includes('Desmarcar') ? 'HAS Desmarcar' : 'NO Desmarcar');
