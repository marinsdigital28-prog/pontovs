import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'app/api/admin/certificates/route.ts');

let current = '';
try {
  current = fs.readFileSync(target, 'utf8');
} catch {}

if (
  current.includes('emptyToNull') &&
  current.includes('medicalCertificate') &&
  !current.trim().startsWith('PLACEHOLDER')
) {
  console.log('certificates route ok', current.length);
  process.exit(0);
}

const partA = path.join(root, 'scripts/certificates-route.b64.a');
const partB = path.join(root, 'scripts/certificates-route.b64.b');
if (!fs.existsSync(partA) || !fs.existsSync(partB)) {
  console.error('certificates route broken: missing b64 parts');
  process.exit(1);
}

const b64 = (fs.readFileSync(partA, 'utf8') + fs.readFileSync(partB, 'utf8')).replace(/\s+/g, '');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, Buffer.from(b64, 'base64').toString('utf8'));
console.log('certificates route restored', fs.statSync(target).size);
