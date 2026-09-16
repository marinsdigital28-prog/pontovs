import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'app/api/admin/certificates/route.ts');
const GOOD = '9b5475a6c6636301055c8da6e7d95dac7478efdf';

async function main() {
  let t = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  if (!t.includes('medicalCertificate') || t.trim().startsWith('PLACEHOLDER') || t.trim() === 'PLACEHOLDER') {
    console.log('fetching good certificates route from', GOOD);
    const res = await fetch(
      `https://raw.githubusercontent.com/marinsdigital28-prog/pontovs/${GOOD}/app/api/admin/certificates/route.ts`,
    );
    if (!res.ok) throw new Error('fetch failed ' + res.status);
    t = await res.text();
  }

  if (!t.includes('emptyToNull')) {
    const oldSchema =
      "const bodySchema = z.object({\n" +
      "  userId: z.string().min(1),\n" +
      "  type: z.enum(certificateTypes).default('DIA_INTEGRAL'),\n" +
      "  startDate: z.string().regex(dateOnly),\n" +
      "  endDate: z.string().regex(dateOnly).optional().nullable(),\n" +
      "  startTime: z.string().regex(/^([01]\\d|2[0-3]):[0-5]\\d$/).optional().nullable(),\n" +
      "  endTime: z.string().regex(/^([01]\\d|2[0-3]):[0-5]\\d$/).optional().nullable(),\n" +
      "  observation: z.string().max(2000).optional().nullable(),\n" +
      "  documentName: z.string().max(180).optional().nullable(),\n" +
      "  documentMime: z.string().optional().nullable(),\n" +
      "  documentData: z.string().max(14_000_000).optional().nullable(),\n" +
      "});";

    const newSchema =
      "const emptyToNull = (v: unknown) => (v === '' || v === undefined ? null : v);\n" +
      "const optionalDate = z.preprocess(emptyToNull, z.string().regex(dateOnly).nullable().optional());\n" +
      "const optionalTime = z.preprocess(emptyToNull, z.string().regex(/^([01]\\d|2[0-3]):[0-5]\\d$/).nullable().optional());\n" +
      "const optionalText = z.preprocess(emptyToNull, z.string().max(2000).nullable().optional());\n" +
      "const optionalName = z.preprocess(emptyToNull, z.string().max(180).nullable().optional());\n" +
      "const optionalMime = z.preprocess(emptyToNull, z.string().nullable().optional());\n" +
      "const optionalDoc = z.preprocess(emptyToNull, z.string().max(14_000_000).nullable().optional());\n\n" +
      "const bodySchema = z.object({\n" +
      "  userId: z.string().min(1),\n" +
      "  type: z.enum(certificateTypes).default('DIA_INTEGRAL'),\n" +
      "  startDate: z.string().regex(dateOnly),\n" +
      "  endDate: optionalDate,\n" +
      "  startTime: optionalTime,\n" +
      "  endTime: optionalTime,\n" +
      "  observation: optionalText,\n" +
      "  documentName: optionalName,\n" +
      "  documentMime: optionalMime,\n" +
      "  documentData: optionalDoc,\n" +
      "});";

    if (t.includes(oldSchema)) {
      t = t.replace(oldSchema, newSchema);
      console.log('applied emptyToNull schema');
    } else {
      console.warn('schema pattern not exact — route still restored');
    }
  }

  if (!t.includes('if (!hourly && !input.endDate) input.endDate = input.startDate')) {
    t = t.replace(
      "if (!hourly && !input.endDate) return NextResponse.json({ error: 'Informe a data final do abono por dias.' }, { status: 400 });",
      "if (!hourly && !input.endDate) input.endDate = input.startDate;",
    );
    console.log('applied endDate default');
  }

  if (t.includes("status: 'PENDENTE',")) {
    t = t.replace("status: 'PENDENTE',", "status: 'ATIVO',");
    t = t.replace("status: 'PENDENTE' },", "status: 'ATIVO' },");
    console.log('applied ATIVO status');
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, t);
  console.log('certificates route final', t.length, 'emptyToNull=' + t.includes('emptyToNull'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
