import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { appendAuditEvent, consumeRateLimit, getRequestKey, rateLimitResponse } from '@/lib/security-controls';
import { createSignedTimesheetPdf } from '@/lib/signed-timesheet-pdf';

export const dynamic = 'force-dynamic';

function validMonth(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value); }

export async function POST(request: Request) {
  const session = (await getServerSession(authOptions as any)) as any;
  const managerId = session?.user?.id as string | undefined;
  if (!managerId) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 401 });
  const manager = await prisma.user.findFirst({ where: { id: managerId, active: true, role: { in: ['ADMIN', 'MANAGER'] } }, select: { id: true } });
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 403 });
  const rate = await consumeRateLimit(getRequestKey(request, 'admin-timesheet-pdf', manager.id), 10, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);

  const certificateBase64 = process.env.PONTO_A1_CERT_BASE64;
  const certificatePassword = process.env.PONTO_A1_PASSWORD;
  if (!certificateBase64 || !certificatePassword) return NextResponse.json({ error: 'Certificado A1 ainda não configurado no ambiente seguro de produção.' }, { status: 503 });
  const body = await request.json().catch(() => null);
  const employeeId = typeof body?.employeeId === 'string' ? body.employeeId : '';
  const month = body?.month;
  if (!employeeId || !validMonth(month)) return NextResponse.json({ error: 'Colaborador e competência são obrigatórios.' }, { status: 400 });

  const [year, monthNumber] = month.split('-').map(Number);
  const from = new Date(year, monthNumber - 1, 1);
  const to = new Date(year, monthNumber, 1);
  const employee = await prisma.user.findFirst({ where: { id: employeeId, role: 'EMPLOYEE' }, select: { name: true, employeeNumber: true, cpf: true, jobTitle: true, workDays: true, scheduleStart: true, scheduleEnd: true } });
  if (!employee) return NextResponse.json({ error: 'Colaborador não encontrado.' }, { status: 404 });
  const [punches, certificates, requests] = await Promise.all([
    prisma.punch.findMany({ where: { userId: employeeId, status: 'VALID', timestamp: { gte: from, lt: to } }, select: { type: true, timestamp: true }, orderBy: { timestamp: 'asc' } }),
    prisma.medicalCertificate.findMany({ where: { userId: employeeId, status: { not: 'CANCELADO' }, startDate: { lt: to }, endDate: { gte: from } }, select: { startDate: true, endDate: true, startTime: true, endTime: true, hoursPerDayMinutes: true, status: true } }),
    prisma.employeeRequest.findMany({ where: { employeeId, status: 'APROVADO', startDate: { lt: to }, endDate: { gte: from } }, select: { type: true, startDate: true, endDate: true, status: true, reason: true } }),
  ]);

  try {
    const signedPdf = await createSignedTimesheetPdf({ employee, punches, certificates, requests, month, certificate: Buffer.from(certificateBase64, 'base64'), password: certificatePassword });
    await appendAuditEvent({ action: 'TIMESHEET_PDF_SIGNED_A1', actorId: manager.id, resource: 'Timesheet', resourceId: employeeId, metadata: { month, employeeNumber: employee.employeeNumber, punchCount: punches.length } });
    return new NextResponse(signedPdf as any, { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="folha-${employee.employeeNumber || employeeId}-${month}-assinada.pdf"`, 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('A1 timesheet signing failed', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Não foi possível assinar a folha. Verifique o certificado A1, a senha e a validade.' }, { status: 422 });
  }
}
