import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outPath = path.join(root, 'lib/signed-timesheet-pdf.ts');

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        get(res.headers.location).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error('HTTP ' + res.statusCode));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    }).on('error', reject);
  });
}

// Restaura o layout original da folha (sem alterações visuais)
const BASE = 'https://raw.githubusercontent.com/marinsdigital28-prog/pontovs/e59d028cf28e5421d8dfab60dc36839bf912b1f3/lib/signed-timesheet-pdf.ts';
const t = await get(BASE);
fs.writeFileSync(outPath, t);
console.log('timesheet pdf restored to original layout', t.length);
