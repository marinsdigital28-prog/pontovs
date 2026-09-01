import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { appendAuditEvent, consumeRateLimit, getRequestKey, rateLimitResponse } from '../../../../lib/security-controls';
import { normalizeCpf } from '../../../../lib/employee-validation';
import prisma from '../../../../lib/prisma';

export const dynamic = 'force-dynamic';

const rowSchema = z.object({
  employeeNumber: z.string().trim().min(1).max(80), name: z.string().trim().min(1).max(180), cpf: z.string().trim().max(30).nullable().optional(),
  jobTitle: z.string().trim().max(180).nullable().optional(), department: z.string().trim().max(180).nullable().optional(), admissionDate: z.string().max(30).nullable().optional(),
  email: z.string().trim().max(320).nullable().optional(), workDaysFromPdf: z.string().trim().max(180).nullable().optional(), scheduleStartFromPdf: z.string().trim().max(10).nullable().optional(), scheduleEndFromPdf: z.string().trim().max(10).nullable().optional(), scheduleRaw: z.string().max(500).nullable().optional(),
  minutesPerDay: z.number().int().min(0).max(1_440).nullable().optional(), sourcePage: z.number().int().positive().max(10_000).optional(), matchBasis: z.string().max(120).optional(), cpfValid: z.boolean().optional(),
}).passthrough();
const payloadSchema = z.object({ source: z.string().max(180).optional(), preserveEmployeeNumber: z.literal(true).optional(), matched: z.array(rowSchema).max(1_000), review: z.array(rowSchema).max(1_000).default([]) });
type ReportPayload = z.infer<typeof payloadSchema>;
type ReportRow = ReportPayload['matched'][number];

async function requireManager() {
  const session = (await getServerSession(authOptions as any)) as any;
  const id = session?.user?.id as string | undefined;
  if (!id) return null;
  return prisma.user.findFirst({ where: { id, active: true, role: { in: ['ADMIN', 'MANAGER'] } }, select: { id: true, name: true } });
}

function rowPayload(row: ReportRow) {
  const fields: Record<string, unknown> = { name: row.name, jobTitle: row.jobTitle || null, registrationData: JSON.stringify({ ...row, importedFrom: row.sourcePage ? `Report.pdf — página ${row.sourcePage}` : 'Report.pdf' }) };
  if (row.cpf && normalizeCpf(row.cpf)) fields.cpf = normalizeCpf(row.cpf);
  if (row.workDaysFromPdf) fields.workDays = row.workDaysFromPdf;
  if (row.scheduleStartFromPdf && row.scheduleEndFromPdf) { fields.scheduleStart = row.scheduleStartFromPdf; fields.scheduleEnd = row.scheduleEndFromPdf; }
  return fields;
}

async function buildPreview(reportData: ReportPayload) {
  const rows = reportData.matched as ReportRow[];
  const numbers = rows.map((row) => row.employeeNumber);
  const current = await prisma.user.findMany({ where: { role: 'EMPLOYEE', employeeNumber: { in: numbers } }, select: { id: true, name: true, employeeNumber: true, cpf: true, jobTitle: true, workDays: true, scheduleStart: true, scheduleEnd: true }, take: 1_000 });
  const currentByNumber = new Map(current.map((employee) => [employee.employeeNumber, employee]));
  const cpfOwners = new Map(current.filter((employee) => employee.cpf).map((employee) => [employee.cpf as string, employee]));
  const matched = rows.map((row) => {
    const employee = currentByNumber.get(row.employeeNumber);
    const normalizedCpf = row.cpf ? normalizeCpf(row.cpf) : null;
    const conflict = normalizedCpf && cpfOwners.get(normalizedCpf) && cpfOwners.get(normalizedCpf)?.id !== employee?.id ? 'CPF já pertence a outro cadastro' : null;
    return { ...row, currentId: employee?.id || null, currentName: employee?.name || null, status: !employee ? 'REVISAR_SEM_MATRICULA' : conflict ? 'REVISAR_CONFLITO_CPF' : 'PRONTO', conflict };
  });
  return { source: reportData.source || 'Report.pdf', preserveEmployeeNumber: true, totalPdfRecords: reportData.matched.length + reportData.review.length, matched: matched.filter((row) => row.status === 'PRONTO'), review: [...matched.filter((row) => row.status !== 'PRONTO'), ...reportData.review.map((row) => ({ ...row, status: 'REVISAR_SEM_MATRICULA', conflict: 'O arquivo não informa uma correspondência segura com matrícula existente.' }))], existingCount: current.length };
}

async function readPayload(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = payloadSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

export async function GET(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor.' }, { status: 401 });
  const rate = await consumeRateLimit(getRequestKey(request, 'admin-import-report-read', manager.id), 10, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);
  return NextResponse.json({ requiresUpload: true, message: 'Envie o lote JSON exportado do Report.pdf para gerar a prévia. Nenhum dado pessoal fica versionado no aplicativo.' });
}

export async function POST(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor.' }, { status: 401 });
  const rate = await consumeRateLimit(getRequestKey(request, 'admin-import-report-write', manager.id), 3, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);
  const body = await request.json().catch(() => null) as (ReportPayload & { confirm?: boolean }) | null;
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Envie um lote JSON válido, com matched, review e preserveEmployeeNumber=true.' }, { status: 400 });
  const reportData = parsed.data;
  try {
    const preview = await buildPreview(reportData);
    if (body?.confirm !== true) return NextResponse.json(preview);
    const result = await prisma.$transaction(async (tx) => {
      let updated = 0; let skipped = 0; let cpfConflicts = 0; const changes: Array<Record<string, unknown>> = [];
      for (const row of preview.matched) {
        const current = await tx.user.findUnique({ where: { employeeNumber: row.employeeNumber }, select: { id: true, employeeNumber: true, name: true, cpf: true, jobTitle: true, workDays: true, scheduleStart: true, scheduleEnd: true } });
        if (!current) { skipped += 1; continue; }
        const data = rowPayload(row as ReportRow);
        const normalizedCpf = typeof data.cpf === 'string' ? data.cpf : null;
        if (normalizedCpf) { const owner = await tx.user.findFirst({ where: { cpf: normalizedCpf, id: { not: current.id } }, select: { id: true } }); if (owner) { delete data.cpf; cpfConflicts += 1; } }
        const changedFields = Object.keys(data).filter((key) => key !== 'registrationData' && (current as any)[key] !== data[key]);
        const updatedEmployee = await tx.user.update({ where: { id: current.id }, data, select: { id: true, employeeNumber: true, name: true, cpf: true, jobTitle: true, workDays: true, scheduleStart: true, scheduleEnd: true } });
        updated += 1;
        changes.push({ employeeId: updatedEmployee.id, employeeNumber: updatedEmployee.employeeNumber, fields: changedFields, before: { name: current.name, cpf: current.cpf, jobTitle: current.jobTitle, workDays: current.workDays, scheduleStart: current.scheduleStart, scheduleEnd: current.scheduleEnd }, after: updatedEmployee });
      }
      return { updated, skipped, cpfConflicts, review: preview.review.length, changes };
    }, { timeout: 120_000 });
    await appendAuditEvent({ action: 'REPORT_EMPLOYEE_IMPORT', actorId: manager.id, resource: 'User', metadata: { source: reportData.source || 'Report.pdf', preserveEmployeeNumber: true, ...result, changes: result.changes.slice(0, 100) } });
    return NextResponse.json({ ok: true, ...result, message: 'Dados cadastrais importados sem alteração de matrículas.' });
  } catch (error) { console.error('report employee import failed', error); return NextResponse.json({ error: 'Falha ao importar o lote. Nenhuma operação parcial foi confirmada.' }, { status: 500 }); }
}
