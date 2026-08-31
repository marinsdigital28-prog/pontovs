import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { appendAuditEvent, consumeRateLimit, getRequestKey, rateLimitResponse } from '@/lib/security-controls';
import { createSignedTimesheetPdf, createSignedTimesheetPdfBatch } from '@/lib/signed-timesheet-pdf';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function validMonth(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export async function POST(request: Request) {
  const session = (await getServerSession(authOptions as any)) as any;
  const managerId = session?.user?.id as string | undefined;
  if (!managerId) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 401 });
  const manager = await prisma.user.findFirst({
    where: { id: managerId, active: true, role: { in: ['ADMIN', 'MANAGER'] } },
    select: { id: true },
  });
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 403 });

  const rate = await consumeRateLimit(getRequestKey(request, 'admin-timesheet-pdf', manager.id), 15, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);

  const certificateBase64 = process.env.PONTO_A1_CERT_BASE64;
  const certificatePassword = process.env.PONTO_A1_PASSWORD;
  if (!certificateBase64 || !certificatePassword) {
    return NextResponse.json(
      { error: 'Certificado A1 ainda não configurado no ambiente seguro de produção.' },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => null);
  const month = body?.month;
  const all = body?.all === true;
  const employeeId = typeof body?.employeeId === 'string' ? body.employeeId : '';

  if (!validMonth(month)) {
    return NextResponse.json({ error: 'Competência (mês) é obrigatória.' }, { status: 400 });
  }
  if (!all && !employeeId) {
    return NextResponse.json({ error: 'Informe o colaborador ou all: true.' }, { status: 400 });
  }

  const [year, monthNumber] = month.split('-').map(Number);
  const from = new Date(year, monthNumber - 1, 1);
  const to = new Date(year, monthNumber, 1);
  const certBuf = Buffer.from(certificateBase64, 'base64');

  try {
    if (all) {
      const employees = await prisma.user.findMany({
        where: { role: 'EMPLOYEE', active: true },
        select: {
          id: true,
          name: true,
          employeeNumber: true,
          cpf: true,
          jobTitle: true,
          workDays: true,
          scheduleStart: true,
          scheduleEnd: true,
        },
        orderBy: [{ employeeNumber: 'asc' }, { name: 'asc' }],
      });

      if (!employees.length) {
        return NextResponse.json({ error: 'Nenhum colaborador ativo encontrado.' }, { status: 404 });
      }

      const batches = await Promise.all(
        employees.map(async (emp) => {
          const [punches, certificates, requests] = await Promise.all([
            prisma.punch.findMany({
              where: { userId: emp.id, status: 'VALID', timestamp: { gte: from, lt: to } },
              select: { type: true, timestamp: true },
              orderBy: { timestamp: 'asc' },
            }),
            prisma.medicalCertificate.findMany({
              where: {
                userId: emp.id,
                status: { not: 'CANCELADO' },
                startDate: { lt: to },
                endDate: { gte: from },
              },
              select: {
                startDate: true,
                endDate: true,
                startTime: true,
                endTime: true,
                hoursPerDayMinutes: true,
                status: true,
              },
            }),
            prisma.employeeRequest.findMany({
              where: {
                employeeId: emp.id,
                status: 'APROVADO',
                startDate: { lt: to },
                endDate: { gte: from },
              },
              select: { type: true, startDate: true, endDate: true, status: true, reason: true },
            }),
          ]);
          return {
            employee: {
              name: emp.name,
              employeeNumber: emp.employeeNumber,
              cpf: emp.cpf,
              jobTitle: emp.jobTitle,
              workDays: emp.workDays,
              scheduleStart: emp.scheduleStart,
              scheduleEnd: emp.scheduleEnd,
            },
            punches,
            certificates,
            requests,
          };
        }),
      );

      const signedPdf = await createSignedTimesheetPdfBatch({
        items: batches,
        month,
        certificate: certBuf,
        password: certificatePassword,
      });

      await appendAuditEvent({
        action: 'TIMESHEET_PDF_BATCH_SIGNED_A1',
        actorId: manager.id,
        resource: 'Timesheet',
        resourceId: 'ALL',
        metadata: { month, count: employees.length },
      });

      return new NextResponse(signedPdf as any, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="folhas-todos-${month}-assinadas.pdf"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    const employee = await prisma.user.findFirst({
      where: { id: employeeId, role: 'EMPLOYEE' },
      select: {
        name: true,
        employeeNumber: true,
        cpf: true,
        jobTitle: true,
        workDays: true,
        scheduleStart: true,
        scheduleEnd: true,
      },
    });
    if (!employee) return NextResponse.json({ error: 'Colaborador não encontrado.' }, { status: 404 });

    const [punches, certificates, requests] = await Promise.all([
      prisma.punch.findMany({
        where: { userId: employeeId, status: 'VALID', timestamp: { gte: from, lt: to } },
        select: { type: true, timestamp: true },
        orderBy: { timestamp: 'asc' },
      }),
      prisma.medicalCertificate.findMany({
        where: {
          userId: employeeId,
          status: { not: 'CANCELADO' },
          startDate: { lt: to },
          endDate: { gte: from },
        },
        select: {
          startDate: true,
          endDate: true,
          startTime: true,
          endTime: true,
          hoursPerDayMinutes: true,
          status: true,
        },
      }),
      prisma.employeeRequest.findMany({
        where: {
          employeeId,
          status: 'APROVADO',
          startDate: { lt: to },
          endDate: { gte: from },
        },
        select: { type: true, startDate: true, endDate: true, status: true, reason: true },
      }),
    ]);

    const signedPdf = await createSignedTimesheetPdf({
      employee,
      punches,
      certificates,
      requests,
      month,
      certificate: certBuf,
      password: certificatePassword,
    });

    await appendAuditEvent({
      action: 'TIMESHEET_PDF_SIGNED_A1',
      actorId: manager.id,
      resource: 'Timesheet',
      resourceId: employeeId,
      metadata: { month, employeeNumber: employee.employeeNumber, punchCount: punches.length },
    });

    return new NextResponse(signedPdf as any, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="folha-${employee.employeeNumber || employeeId}-${month}-assinada.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('A1 timesheet signing failed', error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: 'Não foi possível assinar a folha. Verifique o certificado A1, a senha e a validade.' },
      { status: 422 },
    );
  }
}
