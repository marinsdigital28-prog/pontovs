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

// Após o commit do layout melhorado, este script mantém o arquivo se já tiver o marcador;
// senão baixa a versão commitada da main.
let t = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : '';
if (!(t.includes('Banco de Horas') && t.includes('Concordo com as marcações'))) {
  t = await get('https://raw.githubusercontent.com/marinsdigital28-prog/pontovs/main/lib/signed-timesheet-pdf.ts');
  fs.writeFileSync(outPath, t);
}
console.log('timesheet pdf layout apponte-improved', t.includes('Banco de Horas'), t.length);
