import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'app/api/admin/certificates/route.ts');

async function fetchGood() {
  const urls = [
    'https://raw.githubusercontent.com/marinsdigital28-prog/pontovs/main/app/api/admin/certificates/route.ts',
  ];
  // Prefer local fixed copy embedded if remote is PLACEHOLDER
  return null;
}

const FIXED = String.raw`PLACEHOLDER_WILL_BE_REPLACED`;

console.log('certificates restore: checking', target);
let current = '';
try {
  current = fs.readFileSync(target, 'utf8');
} catch {}

if (current.includes('emptyToNull') && current.includes('medicalCertificate') && !current.trim().startsWith('PLACEHOLDER')) {
  console.log('certificates route ok', current.length);
  process.exit(0);
}

// Fetch from a gist-like approach: decode embedded base64 written below by second patch
const b64Path = path.join(root, 'scripts/certificates-route.b64');
if (fs.existsSync(b64Path)) {
  const b64 = fs.readFileSync(b64Path, 'utf8').replace(/\s+/g, '');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, Buffer.from(b64, 'base64').toString('utf8'));
  console.log('certificates route restored from b64', fs.statSync(target).size);
  process.exit(0);
}

console.error('certificates route broken and no b64 backup');
process.exit(1);
