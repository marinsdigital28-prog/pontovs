import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { PDFParse } from 'pdf-parse';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { parseBackupText } from '@/lib/pdf-import';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function clockParts(value: string | undefined) {
  const match = value?.match(/(\d{1,2}):(\d{2})/);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : null;
}

function localTimestamp(date: string, time: string) {
  return new Date(`${date}T${time}-03:00`);
}

async function readPayload(request: Request) {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) throw new Error('Selecione um arquivo PDF.');
    if (file.size > 15 * 1024 * 1024 || !file.name.toLowerCase().endsWith('.pdf')) throw new Error('O PDF deve ter até 15 MB.');
    const parser = new PDFParse({ data: new Uint8Array(await file.arrayBuffer()) });
    try {
      const parsed = await parser.getText();
      const backup = parseBackupText(parsed.text);
      return { employees: backup.employees, punches: backup.punches, pagesDetected: backup.pagesDetected };
    } finally {
      await parser.destroy();
    }
  }
  return request.json();
}

export async function POST(request: Request) {
  const token = request.headers.get('x-import-token');
  const configuredPassword = process.env.ADMIN_PASSWORD || process.env.SENHA_DE_ADMINISTRADOR || process.env.SENHA_DE_ACESSO_DE_ADMINISTRADOR;
  const tokenAuthorized = Boolean(configuredPassword && token === configuredPassword);
  const session = tokenAuthorized ? null : ((await getServerSession(authOptions as any)) as any);
  const sessionUserId = session?.user?.id as string | undefined;
  const manager = sessionUserId ? await prisma.user.findFirst({ where: { id: sessionUserId, active: true, role: { in: ['ADMIN', 'MANAGER'] } }, select: { id: true } }) : null;
  if (!tokenAuthorized && !manager) return NextResponse.json({ error: 'Sessão de gestor ou token de importação obrigatório.' }, { status: 401 });

  try {
    const body = await readPayload(request);
    const employees = Array.isArray(body?.employees) ? body.employees : [];
    const punches = Array.isArray(body?.punches) ? body.punches : [];
    if (!employees.length || !punches.length || punches.length > 5000) return NextResponse.json({ error: 'O PDF não contém colaboradores e marcações válidas.' }, { status: 400 });

    const result = await prisma.$transaction(async (tx) => {
      const users = new Map<string, string>();
      let employeesUpdated = 0;
      for (const employee of employees) {
        const employeeNumber = String(employee.employeeNumber ?? '').replace(/\D/g, '').padStart(4, '0');
        const name = String(employee.name ?? '').trim();
        if (!/^\d{4,}$/.test(employeeNumber) || employeeNumber === '0000' || !name) continue;
        const jornada = String(employee.jornada ?? '');
        const scheduleStart = clockParts(jornada.split(/[–-]/)[0]);
        const scheduleEnd = clockParts(jornada.split(/[–-]/)[1]);
        const cpf = String(employee.cpf ?? '').replace(/\D/g, '') || null;
        const existing = await tx.user.findUnique({ where: { employeeNumber }, select: { id: true } });
        const user = existing
          ? await tx.user.update({ where: { employeeNumber }, data: { name, cpf, jobTitle: String(employee.jobTitle ?? '').trim() || null, workDays: String(employee.schedule ?? '').trim() || null, scheduleStart, scheduleEnd, active: true }, select: { id: true } })
          : await tx.user.create({ data: { id: crypto.randomUUID(), name, employeeNumber, cpf, email: `${employeeNumber}@employee.local`, role: 'EMPLOYEE', active: true, jobTitle: String(employee.jobTitle ?? '').trim() || null, workDays: String(employee.schedule ?? '').trim() || null, scheduleStart, scheduleEnd }, select: { id: true } });
        users.set(employeeNumber, user.id);
        employeesUpdated += 1;
      }
      let punchesCreated = 0;
      let punchesExisting = 0;
      let rowsIgnored = 0;
      for (const punch of punches) {
        const employeeNumber = String(punch.employeeNumber ?? '').replace(/\D/g, '').padStart(4, '0');
        const userId = users.get(employeeNumber);
        const time = String(punch.time ?? '');
        const date = String(punch.date ?? '');
        const type = String(punch.type ?? 'ENTRADA').toUpperCase();
        if (!userId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}:\d{2}$/.test(time) || !['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA'].includes(type)) { rowsIgnored += 1; continue; }
        const clientId = `pdf-20260826-${employeeNumber}-${date}-${time}-${type}`;
        const existing = await tx.punch.findUnique({ where: { clientId }, select: { id: true } });
        if (existing) { punchesExisting += 1; continue; }
        await tx.punch.create({ data: { id: crypto.randomUUID(), userId, type, timestamp: localTimestamp(date, time), clientTimestamp: localTimestamp(date, time), status: 'VALID', origin: 'ADJUSTED', locationValid: false, clientId } });
        punchesCreated += 1;
      }
      return { employeesUpdated, punchesCreated, punchesExisting, rowsIgnored, pagesDetected: Number(body?.pagesDetected || 0) };
    }, { timeout: 120000 });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error('PDF import failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Falha ao importar o backup. Nenhuma operação parcial foi confirmada.' }, { status: 400 });
  }
}
