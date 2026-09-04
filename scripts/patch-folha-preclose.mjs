import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const panelPath = path.join(root, 'app/admin/folha-ponto-panel.tsx');

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

const BASE = 'https://raw.githubusercontent.com/marinsdigital28-prog/pontovs/main/app/admin/folha-ponto-panel.tsx';
let t;
try {
  t = await get(BASE);
} catch (e) {
  console.warn('download failed, using local panel', e.message);
  t = fs.readFileSync(panelPath, 'utf8');
}

if (!t.includes("import './folha-preclose.css'")) {
  t = t.replace("import './folha-ponto.css';", "import './folha-ponto.css';\nimport './folha-preclose.css';");
}

if (!t.includes('incomplete: boolean')) {
  t = t.replace(
    'absent: boolean; late: boolean; certificate: boolean; schedule: string;',
    'absent: boolean; late: boolean; certificate: boolean; incomplete: boolean; schedule: string;',
  );
}

if (!t.includes('const incomplete = Boolean')) {
  t = t.replace(
    `    return {\n      date, weekday: weekdayNames[weekday], punches: dayPunches, worked, expected, justified, missing, surplus, balance,\n      absent: configuredWorkday && !dayPunches.length && !covered, late: configuredWorkday && late && !covered,\n      certificate: covered, schedule: scheduleLabel,\n    };`,
    `    const types = new Set(dayPunches.map((p) => p.type));\n    const incomplete = Boolean(\n      configuredWorkday\n      && !covered\n      && dayPunches.length > 0\n      && (!types.has('ENTRADA') || !types.has('SAIDA')),\n    );\n    return {\n      date, weekday: weekdayNames[weekday], punches: dayPunches, worked, expected, justified, missing, surplus, balance,\n      absent: configuredWorkday && !dayPunches.length && !covered, late: configuredWorkday && late && !covered,\n      certificate: covered, incomplete, schedule: scheduleLabel,\n    };`,
  );
}

if (!t.includes('preCloseAudit')) {
  t = t.replace(
    `  const dayRowsByEmployee = useMemo(\n    () => new Map(visibleEmployees.map((employee) => [employee.id, buildDayRows(employee, records, month, certificates, requests)])),\n    [month, records, certificates, requests, visibleEmployees],\n  );\n\n  async function downloadPdfBlob`,
    `  const dayRowsByEmployee = useMemo(\n    () => new Map(visibleEmployees.map((employee) => [employee.id, buildDayRows(employee, records, month, certificates, requests)])),\n    [month, records, certificates, requests, visibleEmployees],\n  );\n\n  const preCloseAudit = useMemo(() => {\n    const bounds = monthBounds(month);\n    const noSchedule = [];\n    const faltas = [];\n    const incompletos = [];\n    let totalFaltas = 0;\n    let totalIncompletos = 0;\n    let totalAtrasos = 0;\n    for (const emp of visibleEmployees) {\n      if (!emp.scheduleStart || !emp.scheduleEnd) noSchedule.push((emp.employeeNumber || '—') + ' · ' + emp.name);\n      const rows = dayRowsByEmployee.get(emp.id) || [];\n      const fDays = rows.filter((r) => r.absent).map((r) => r.date.slice(8));\n      const iDays = rows.filter((r) => r.incomplete).map((r) => r.date.slice(8));\n      totalFaltas += fDays.length;\n      totalIncompletos += iDays.length;\n      totalAtrasos += rows.filter((r) => r.late).length;\n      if (fDays.length) faltas.push({ name: emp.name, days: fDays });\n      if (iDays.length) incompletos.push({ name: emp.name, days: iDays });\n    }\n    const pendingRequests = requests.filter((r) => {\n      if (r.status !== 'PENDENTE') return false;\n      const start = String(r.startDate).slice(0, 10);\n      const end = String(r.endDate).slice(0, 10);\n      return start <= bounds.to && end >= bounds.from;\n    });\n    const pendingCerts = certificates.filter((c) => {\n      if (c.status !== 'PENDENTE') return false;\n      const start = String(c.startDate).slice(0, 10);\n      const end = String(c.endDate).slice(0, 10);\n      return start <= bounds.to && end >= bounds.from;\n    });\n    const blockers = noSchedule.length + pendingRequests.length + pendingCerts.length + totalIncompletos;\n    return { noSchedule, faltas, incompletos, totalFaltas, totalIncompletos, totalAtrasos, pendingRequests, pendingCerts, blockers, ready: blockers === 0 };\n  }, [visibleEmployees, dayRowsByEmployee, requests, certificates, month]);\n\n  async function downloadPdfBlob`,
  );
}

if (!t.includes('signAllPdfsInner')) {
  t = t.replace(
    'async function signAllPdfs()',
    `async function signAllPdfs() {\n    if (preCloseAudit.blockers > 0) {\n      const ok = window.confirm('Pré-fechamento: ainda há ' + preCloseAudit.blockers + ' pendência(s) (escala, incompletos, solicitações ou atestados).\\n\\nGerar PDF de todos mesmo assim?');\n      if (!ok) return;\n    }\n    return signAllPdfsInner();\n  }\n  async function signAllPdfsInner()`,
  );
}

if (!t.includes('folha-preclose')) {
  t = t.replace(
    `{batchProgress ? <span className="folha-batch-progress">{batchProgress}</span> : null}\n      </div>\n\n      {error ? <p className="status-msg">{error}</p> : null}`,
    `{batchProgress ? <span className="folha-batch-progress">{batchProgress}</span> : null}\n      </div>\n\n      <div className={\`folha-preclose \${preCloseAudit.ready ? 'ok' : 'warn'}\`} role="status">\n        <div className="folha-preclose-head">\n          <strong>{preCloseAudit.ready ? 'Pré-fechamento: pronto' : 'Pré-fechamento: revisar antes de fechar'}</strong>\n          <span>\n            {preCloseAudit.totalFaltas} falta(s) · {preCloseAudit.totalIncompletos} incompleto(s) · {preCloseAudit.totalAtrasos} atraso(s) · {preCloseAudit.pendingRequests.length} solicitação(ões) pendente(s) · {preCloseAudit.pendingCerts.length} atestado(s) pendente(s)\n          </span>\n        </div>\n        {!preCloseAudit.ready ? (\n          <ul className="folha-preclose-list">\n            {preCloseAudit.noSchedule.length ? (\n              <li><b>Sem jornada cadastrada:</b> {preCloseAudit.noSchedule.slice(0, 8).join(' · ')}{preCloseAudit.noSchedule.length > 8 ? \` · +\${preCloseAudit.noSchedule.length - 8}\` : ''}</li>\n            ) : null}\n            {preCloseAudit.incompletos.slice(0, 6).map((item) => (\n              <li key={\`inc-\${item.name}\`}><b>Incompleto — {item.name}:</b> dia(s) {item.days.join(', ')}</li>\n            ))}\n            {preCloseAudit.faltas.slice(0, 6).map((item) => (\n              <li key={\`fal-\${item.name}\`}><b>Falta — {item.name}:</b> dia(s) {item.days.join(', ')}</li>\n            ))}\n            {preCloseAudit.pendingRequests.length ? (\n              <li><b>Solicitações pendentes no mês:</b> {preCloseAudit.pendingRequests.length} (aba Solicitações)</li>\n            ) : null}\n            {preCloseAudit.pendingCerts.length ? (\n              <li><b>Atestados pendentes no mês:</b> {preCloseAudit.pendingCerts.length} (aba Atestados)</li>\n            ) : null}\n          </ul>\n        ) : (\n          <p className="folha-preclose-ok">Nenhuma pendência crítica nesta visão. Pode exportar / imprimir com mais segurança.</p>\n        )}\n      </div>\n\n      {error ? <p className="status-msg">{error}</p> : null}`,
  );
}

if (!t.includes("row.incomplete ? 'INCOMPLETO'")) {
  t = t.replace(
    `const situation = row.certificate || (row.justified && row.justified > 0)\n                      ? (row.punches.length ? 'ABONO + PONTO' : 'ABONO/ATESTADO')\n                      : row.absent ? 'FALTA' : row.late ? 'ATRASO' : isFolga ? 'FOLGA' : '';`,
    `const situation = row.certificate || (row.justified && row.justified > 0)\n                      ? (row.punches.length ? 'ABONO + PONTO' : 'ABONO/ATESTADO')\n                      : row.absent ? 'FALTA'\n                      : row.incomplete ? 'INCOMPLETO'\n                      : row.late ? 'ATRASO'\n                      : isFolga ? 'FOLGA'\n                      : row.punches.length ? 'OK' : '';`,
  );
}

if (!t.includes('folha-row-incompleto')) {
  t = t.replace(
    "className={[isFolga ? 'folha-row-folga' : '', row.absent ? 'folha-row-falta' : '', row.certificate ? 'folha-row-abono' : ''].filter(Boolean).join(' ')}",
    "className={[isFolga ? 'folha-row-folga' : '', row.absent ? 'folha-row-falta' : '', row.incomplete ? 'folha-row-incompleto' : '', row.certificate ? 'folha-row-abono' : ''].filter(Boolean).join(' ')}",
  );
}

if (!t.includes('employeeId: r.employeeId || r.employee?.id')) {
  t = t.replace(
    "setRequests(Array.isArray(requestData.requests) ? requestData.requests : []);",
    `setRequests((Array.isArray(requestData.requests) ? requestData.requests : []).map((r) => ({\n        ...r,\n        employeeId: r.employeeId || r.employee?.id || '',\n        startDate: typeof r.startDate === 'string' ? r.startDate : String(r.startDate || '').slice(0, 10),\n        endDate: typeof r.endDate === 'string' ? r.endDate : String(r.endDate || '').slice(0, 10),\n      })).filter((r) => r.employeeId));`,
  );
}

fs.writeFileSync(panelPath, t);
console.log('folha panel patched', t.includes('preCloseAudit'), t.includes('INCOMPLETO'), t.length);
