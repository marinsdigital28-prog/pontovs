import employees from '../imports/employees-from-pdf.json' with { type: 'json' };
import punchBackup from '../imports/punches-from-pdf.json' with { type: 'json' };

const baseUrl = process.env.IMPORT_BASE_URL || 'https://ponto.marinsdistemas.xyz';
const token = process.env.IMPORT_TOKEN;
if (!token) throw new Error('Defina IMPORT_TOKEN apenas no ambiente local seguro.');
const punches = punchBackup.rows ?? [];
const response = await fetch(`${baseUrl}/api/admin/import-pdf`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-import-token': token },
  body: JSON.stringify({ employees, punches }),
});
const text = await response.text();
if (!response.ok) throw new Error(`Importação não executada (${response.status}): ${text.slice(0, 300)}`);
console.log(text);
