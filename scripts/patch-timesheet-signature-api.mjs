import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiPath = path.join(root, 'app/api/admin/timesheet-pdf/route.ts');
let t = fs.readFileSync(apiPath, 'utf8');

if (!t.includes('signatureDataUrl')) {
  t = t.replace(
    "  const certBuf = Buffer.from(certificateBase64, 'base64');\n\n  try {",
    `  const certBuf = Buffer.from(certificateBase64, 'base64');\n  const unitSettings = await prisma.unitSettings.findFirst({\n    select: { signatureData: true },\n    orderBy: { updatedAt: 'desc' },\n  }).catch(() => null);\n  const signatureDataUrl = unitSettings?.signatureData || null;\n\n  try {`,
  );
  t = t.replace(
    `      const signedPdf = await createSignedTimesheetPdfBatch({\n        items: batches,\n        month,\n        certificate: certBuf,\n        password: certificatePassword,\n      });`,
    `      const signedPdf = await createSignedTimesheetPdfBatch({\n        items: batches,\n        month,\n        certificate: certBuf,\n        password: certificatePassword,\n        signatureDataUrl,\n      });`,
  );
  t = t.replace(
    `    const signedPdf = await createSignedTimesheetPdf({\n      employee: { ...employee, unit: employee.unit?.name || null },\n      punches,\n      certificates,\n      requests,\n      month,\n      certificate: certBuf,\n      password: certificatePassword,\n    });`,
    `    const signedPdf = await createSignedTimesheetPdf({\n      signatureDataUrl,\n      employee: { ...employee, unit: employee.unit?.name || null },\n      punches,\n      certificates,\n      requests,\n      month,\n      certificate: certBuf,\n      password: certificatePassword,\n    });`,
  );
  fs.writeFileSync(apiPath, t);
  console.log('timesheet API signatureDataUrl wired');
} else {
  console.log('timesheet API already has signatureDataUrl');
}
