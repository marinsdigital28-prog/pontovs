import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { appendAuditEvent, consumeRateLimit, getRequestKey, rateLimitResponse } from '@/lib/security-controls';
import { findConflictingPunches } from '@/lib/certificate-conflicts';

export const dynamic = 'force-dynamic';

async function requireManager() {
  const session = (await getServerSession(authOptions as any)) as any;
  const id = session?.user?.id as string | undefined;
  if (!id) return null;
  return prisma.user.findFirst({
    where: { id, active: true, role: { in: ['ADMIN', 'MANAGER'] } },
    select: { id: true },
  });
}

/**
 * GET  → lista conflitos atestado × marcação (somente leitura)
 * POST → rejeita marcações VALID que caem dentro de atestado/trabalho externo aprovado
 *
 * Query/body opcional: from, to (YYYY-MM-DD), userId, certificateId, dryRun
 */
export async function GET(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 401 });

  const url = new URL(request.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const userId = url.searchParams.get('userId') || undefined;
  const certificateId = url.searchParams.get('certificateId') || undefined;

  const certWhere: any = {
    status: { in: ['APROVADO', 'ATIVO'] },
  };
  if (userId) certWhere.userId = userId;
  if (certificateId) certWhere.id = certificateId;
  if (from || to) {
    certWhere.AND = [
      from ? { endDate: { gte: new Date(`${from}T00:00:00.000Z`) } } : {},
      to ? { startDate: { lte: new Date(`${to}T23:59:59.999Z`) } } : {},
    ];
  }

  const certificates = await prisma.medicalCertificate.findMany({
    where: certWhere,
    select: {
      id: true,
      userId: true,
      type: true,
      startDate: true,
      endDate: true,
      startTime: true,
      endTime: true,
      status: true,
      observation: true,
      user: { select: { name: true, employeeNumber: true } },
    },
    take: 500,
  });

  if (!certificates.length) {
    return NextResponse.json({ conflicts: [], total: 0 });
  }

  const minStart = certificates.reduce((m, c) => (c.startDate < m ? c.startDate : m), certificates[0].startDate);
  const maxEnd = certificates.reduce((m, c) => (c.endDate > m ? c.endDate : m), certificates[0].endDate);
  const rangeStart = new Date(minStart);
  rangeStart.setUTCHours(0, 0, 0, 0);
  const rangeEnd = new Date(maxEnd);
  rangeEnd.setUTCHours(23, 59, 59, 999);

  const userIds = [...new Set(certificates.map((c) => c.userId))];
  const punches = await prisma.punch.findMany({
    where: {
      status: 'VALID',
      userId: { in: userIds },
      timestamp: { gte: rangeStart, lte: rangeEnd },
    },
    select: {
      id: true,
      userId: true,
      type: true,
      timestamp: true,
      status: true,
      user: { select: { name: true, employeeNumber: true } },
    },
    take: 10000,
  });

  const pairs = findConflictingPunches(
    punches.map((p) => ({ id: p.id, userId: p.userId, type: p.type, timestamp: p.timestamp, status: p.status })),
    certificates.map((c) => ({
      id: c.id,
      userId: c.userId,
      type: c.type,
      startDate: c.startDate,
      endDate: c.endDate,
      startTime: c.startTime,
      endTime: c.endTime,
      status: c.status,
    })),
  );

  const certById = new Map(certificates.map((c) => [c.id, c]));
  const punchById = new Map(punches.map((p) => [p.id, p]));

  const conflicts = pairs.map(({ punch, certificate }) => {
    const fullPunch = punchById.get(punch.id)!;
    const fullCert = certById.get(certificate.id!)!;
    return {
      punchId: punch.id,
      punchType: punch.type,
      punchTimestamp: punch.timestamp.toISOString(),
      userId: punch.userId,
      employeeName: fullPunch.user.name,
      employeeNumber: fullPunch.user.employeeNumber,
      certificateId: fullCert.id,
      certificateType: fullCert.type,
      certificateWindow: fullCert.startTime && fullCert.endTime
        ? `${fullCert.startTime}–${fullCert.endTime}`
        : 'dia integral',
      certificateObservation: fullCert.observation,
    };
  });

  return NextResponse.json({ conflicts, total: conflicts.length });
}

export async function POST(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 401 });
  const rate = await consumeRateLimit(getRequestKey(request, 'admin-cert-conflicts', manager.id), 10, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);

  const body = (await request.json().catch(() => ({}))) as {
    from?: string;
    to?: string;
    userId?: string;
    certificateId?: string;
    dryRun?: boolean;
  };

  const certWhere: any = { status: { in: ['APROVADO', 'ATIVO'] } };
  if (body.userId) certWhere.userId = body.userId;
  if (body.certificateId) certWhere.id = body.certificateId;
  if (body.from || body.to) {
    certWhere.AND = [
      body.from ? { endDate: { gte: new Date(`${body.from}T00:00:00.000Z`) } } : {},
      body.to ? { startDate: { lte: new Date(`${body.to}T23:59:59.999Z`) } } : {},
    ];
  }

  const certificates = await prisma.medicalCertificate.findMany({
    where: certWhere,
    select: {
      id: true,
      userId: true,
      type: true,
      startDate: true,
      endDate: true,
      startTime: true,
      endTime: true,
      status: true,
      observation: true,
    },
    take: 500,
  });

  if (!certificates.length) {
    return NextResponse.json({ ok: true, rejected: 0, conflicts: [], message: 'Nenhum atestado ativo no filtro.' });
  }

  const minStart = certificates.reduce((m, c) => (c.startDate < m ? c.startDate : m), certificates[0].startDate);
  const maxEnd = certificates.reduce((m, c) => (c.endDate > m ? c.endDate : m), certificates[0].endDate);
  const rangeStart = new Date(minStart);
  rangeStart.setUTCHours(0, 0, 0, 0);
  const rangeEnd = new Date(maxEnd);
  rangeEnd.setUTCHours(23, 59, 59, 999);

  const userIds = [...new Set(certificates.map((c) => c.userId))];
  const punches = await prisma.punch.findMany({
    where: {
      status: 'VALID',
      userId: { in: userIds },
      timestamp: { gte: rangeStart, lte: rangeEnd },
    },
    select: { id: true, userId: true, type: true, timestamp: true, status: true },
    take: 10000,
  });

  const pairs = findConflictingPunches(punches, certificates);

  if (body.dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      wouldReject: pairs.length,
      punchIds: pairs.map((p) => p.punch.id),
    });
  }

  let rejected = 0;
  for (const { punch, certificate } of pairs) {
    const window =
      certificate.startTime && certificate.endTime
        ? `${certificate.startTime}–${certificate.endTime}`
        : 'dia integral';
    await prisma.$transaction(async (tx) => {
      await tx.punch.update({
        where: { id: punch.id },
        data: { status: 'REJECTED', origin: 'ADJUSTED' },
      });
      await tx.punchAudit.create({
        data: {
          id: crypto.randomUUID(),
          punchId: punch.id,
          changedById: manager.id,
          field: 'status',
          oldValue: 'VALID',
          newValue: 'REJECTED',
          reason: `Conflito com atestado/trabalho externo (${window}): não é possível estar em dois lugares ao mesmo tempo`,
        },
      });
    });
    rejected += 1;
  }

  await appendAuditEvent({
    action: 'CERTIFICATE_PUNCH_CONFLICTS_RESOLVED',
    actorId: manager.id,
    resource: 'Punch',
    metadata: {
      rejected,
      certificateIds: certificates.map((c) => c.id),
      from: body.from || null,
      to: body.to || null,
    },
  });

  return NextResponse.json({
    ok: true,
    rejected,
    message:
      rejected > 0
        ? `${rejected} marcação(ões) rejeitada(s) por conflito com atestado/trabalho externo.`
        : 'Nenhum conflito encontrado.',
  });
}
