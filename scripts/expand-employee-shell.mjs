import fs from 'fs';
import zlib from 'zlib';
import path from 'path';
import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const a = path.join(root, 'app/app/employee-shell.b64.a');
const b = path.join(root, 'app/app/employee-shell.b64.b');
const single = path.join(root, 'app/app/employee-shell.b64');
const outPath = path.join(root, 'app/app/employee-shell.tsx');
let b64;
if (fs.existsSync(a) && fs.existsSync(b)) {
  b64 = fs.readFileSync(a, 'utf8').trim() + fs.readFileSync(b, 'utf8').trim();
} else {
  b64 = fs.readFileSync(single, 'utf8').trim();
}
const buf = zlib.gunzipSync(Buffer.from(b64, 'base64'));
fs.writeFileSync(outPath, buf);
console.log('expanded employee-shell.tsx', buf.length, 'bytes');
