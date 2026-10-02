import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const panelPath = path.join(root, 'app/admin/folha-ponto-panel.tsx');

// Commit onde o painel ainda estava completo (antes do PLACEHOLDER)
const GOOD_COMMIT = '7e7b290decae4398c6c7d9b8ef42bb23e65fd501';
const RAW = `https://raw.githubusercontent.com/marinsdigital28-prog/pontovs/${GOOD_COMMIT}/app/admin/folha-ponto-panel.tsx`;

async function main() {
  let t = fs.existsSync(panelPath) ? fs.readFileSync(panelPath, 'utf8') : '';
  const broken =
    !t.includes('export default function FolhaPontoPanel') ||
    t.trim() === 'PLACEHOLDER' ||
    t.includes('TEMP: content loaded via next push') ||
    t.includes('SEE_FILE') ||
    t.length < 5000;

  if (broken) {
    console.log('folha panel PLACEHOLDER/quebrado — baixando versao boa do commit', GOOD_COMMIT);
    const res = await fetch(RAW);
    if (!res.ok) {
      throw new Error('fetch panel failed ' + res.status + ' url=' + RAW);
    }
    t = await res.text();
    if (!t.includes('export default function FolhaPontoPanel')) {
      throw new Error('conteudo baixado nao parece o painel');
    }
  }

  // Import shouldSuppressAbono
  if (!t.includes('shouldSuppressAbono')) {
    t = t.replace(
      "import { getOperationalAbono, operationalJustifiedMinutes, shouldHidePunchesForDay } from '@/lib/operational-abonos';",
      "import { getOperationalAbono, operationalJustifiedMinutes, shouldHidePunchesForDay, shouldSuppressAbono } from '@/lib/operational-abonos';",
    );
    console.log('folha: import shouldSuppressAbono');
  }

  // suppressAbono no dia
  if (!t.includes('const suppressAbono = shouldSuppressAbono')) {
    t = t.replace(
      "const hidePunches = shouldHidePunchesForDay(employee.employeeNumber, date);",
      "const suppressAbono = shouldSuppressAbono(employee.employeeNumber, date);\n    const hidePunches = shouldHidePunchesForDay(employee.employeeNumber, date);",
    );
    console.log('folha: suppressAbono no dia');
  }

  // dayCertificates vazio quando suppress
  if (t.includes('const suppressAbono') && !t.includes('suppressAbono\n      ? []')) {
    t = t.replace(
      /const dayCertificates = certificates\s*\n\s*\.filter\(\(item\) => item\.userId === employee\.id\)/,
      'const dayCertificates = suppressAbono\n      ? []\n      : certificates\n          .filter((item) => item.userId === employee.id)',
    );
    console.log('folha: dayCertificates suppress');
  }

  // certificate find
  if (t.includes('const suppressAbono') && !t.includes('suppressAbono\n      ? undefined')) {
    t = t.replace(
      'const certificate = certificates.find((item) => item.userId === employee.id && item.startDate.slice(0, 10) <= date && item.endDate.slice(0, 10) >= date);',
      "const certificate = suppressAbono\n      ? undefined\n      : certificates.find((item) => item.userId === employee.id && item.startDate.slice(0, 10) <= date && item.endDate.slice(0, 10) >= date);",
    );
    console.log('folha: certificate suppress');
  }

  // justifiedByCertificate
  if (t.includes('const suppressAbono') && !t.includes('!suppressAbono && certificate')) {
    t = t.replace(
      "const justifiedByCertificate = certificate && dayStart !== null && dayEnd !== null ? certificateMinutesForDay(certificate, date, dayStart, dayEnd, daySchedule?.mode === 'FULL', expected) : 0;",
      "const justifiedByCertificate = !suppressAbono && certificate && dayStart !== null && dayEnd !== null ? certificateMinutesForDay(certificate, date, dayStart, dayEnd, daySchedule?.mode === 'FULL', expected) : 0;",
    );
    console.log('folha: justifiedByCertificate suppress');
  }

  if (t.includes('const suppressAbono') && !t.includes("suppressAbono ? 0 : (approvedRequest")) {
    t = t.replace(
      "const justifiedByRequest = approvedRequest?.type === 'AUSENCIA' ? expected || 0 : 0;",
      "const justifiedByRequest = suppressAbono ? 0 : (approvedRequest?.type === 'AUSENCIA' ? expected || 0 : 0);",
    );
    console.log('folha: justifiedByRequest suppress');
  }

  // Força zero de abono/justificado quando suppress (Taiane 30/09 etc.)
  if (t.includes('const suppressAbono') && !t.includes('/* FORCE_SUPPRESS_ZERO */')) {
    t = t.replace(
      /const justified = Math\.max\(justifiedByCertificate, justifiedByRequest, justifiedByOps\);\s*\n\s*const considered = worked === null \? \(justified > 0 \? justified : null\) : worked \+ justified;/,
      `const justifiedRaw = Math.max(justifiedByCertificate, justifiedByRequest, justifiedByOps);
    /* FORCE_SUPPRESS_ZERO */
    const justified = suppressAbono ? 0 : justifiedRaw;
    const considered = worked === null ? (justified > 0 ? justified : null) : worked + justified;`,
    );
    console.log('folha: FORCE zero justified no suppress');
  }

  if (!t.includes('folha-sit') && t.includes("row.punches.length ? 'OK' : '';")) {
    const newSit = `const situation = row.certificate || (row.justified && row.justified > 0)
                      ? (row.punches.length ? 'ABONO + PONTO' : 'ABONO/ATESTADO')
                      : row.absent ? 'FALTA'
                      : row.incomplete ? 'INCOMPLETO'
                      : row.late ? ''
                      : isFolga ? 'FOLGA'
                      : row.punches.length ? 'OK' : '';
                    const sitClass =
                      situation.startsWith('ABONO') ? 'folha-sit-abono'
                      : situation === 'FALTA' ? 'folha-sit-falta'
                      : situation === 'INCOMPLETO' ? 'folha-sit-incompleto'
                      : situation === 'ATRASO' ? ''
                      : situation === 'FOLGA' ? 'folha-sit-folga'
                      : situation === 'OK' ? 'folha-sit-ok'
                      : '';`;
    t = t.replace(
      /const situation = row\.certificate[\s\S]*?row\.punches\.length \? 'OK' : '';/,
      newSit.trim()
    );
    t = t.replace(
      '<td className="folha-col-sit">{situation}</td>',
      "<td className=\"folha-col-sit\">{situation ? <span className={`folha-sit ${sitClass}`}>{situation}</span> : '—'}</td>"
    );
    console.log('folha panel: badges de situacao aplicados');
  }

  // Garante isFolga definido se a situação o referencia
  if (t.includes('isFolga ?') && !t.includes('const isFolga')) {
    t = t.replace(
      /const situation = row\.certificate/,
      "const isFolga = row.schedule.startsWith('Folga');\n                    const situation = row.certificate",
    );
    console.log('folha: isFolga definido');
  }

  fs.writeFileSync(panelPath, t);
  console.log('folha panel ok', fs.statSync(panelPath).size, t.includes('folha-sit') ? 'com badges' : 'sem badges', t.includes('suppressAbono') ? 'com suppress' : '', t.includes('FORCE_SUPPRESS_ZERO') ? 'FORCE' : '');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
