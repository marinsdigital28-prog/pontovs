import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { appendAuditEvent, consumeRateLimit, getRequestKey, rateLimitResponse } from '@/lib/security-controls';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function manager(session: any) {
  return Boolean(session?.user?.id && ['ADMIN', 'MANAGER'].includes(String(session?.user?.role || '')));
}

function validMonth(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function csvEscape(value: unknown) {
  const text = value == null ? '' : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export async function GET(request: Request) {
  const session = (await getServerSession(authOptions as any)) as any;
  if (!manager(session)) return NextResponse.json({ error: 'Acesso administrativo necessário.' }, { status: 401 });

  const rate = await consumeRateLimit(getRequestKey(request, 'admin-backup', session.user.id), 10, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);

  const url = new URL(request.url);
  const mode = url.searchParams.get('mode') || 'summary';
  const month = url.searchParams.get('month') || '';
  const includePhotos = url.searchParams.get('photos') === '1';
  const format = (url.searchParams.get('format') || 'json').toLowerCase();

  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-');

  try {
    if (mode === 'summary') {
      const [users, punches, punchesWithPhoto, certs, requests, units, inconsistencies, auditEvents] =
        await Promise.all([
          prisma.user.count(),
          prisma.punch.count(),
          prisma.punch.count({ where: { photoData: { not: null } } }),
          prisma.medicalCertificate.count(),
          prisma.employeeRequest.count(),
          prisma.unit.count(),
          prisma.inconsistency.count({ where: { status: 'OPEN' } }),
          prisma.securityAuditEvent.count(),
        ]);

      let monthStats: null | { punches: number; withPhoto: number } = null;
      if (validMonth(month)) {
        const [y, m] = month.split('-').map(Number);
        const from = new Date(y, m - 1, 1);
        const to = new Date(y, m, 1);
        const [mp, mpp] = await Promise.all([
          prisma.punch.count({ where: { timestamp: { gte: from, lt: to } } }),
          prisma.punch.count({ where: { timestamp: { gte: from, lt: to }, photoData: { not: null } } }),
        ]);
        monthStats = { punches: mp, withPhoto: mpp };
      }

      return NextResponse.json({
        ok: true,
        generatedAt: now.toISOString(),
        totals: {
          users,
          punches,
          punchesWithPhoto,
          certificates: certs,
          requests,
          units,
          openInconsistencies: inconsistencies,
          auditEvents,
        },
        month: validMonth(month) ? { month, ...monthStats } : null,
        advice:
          'Exportação recomendada sem fotos (leve). Inclua fotos só antes de troca de banco ou fechamento anual.',
      });
    }

    let punchWhere: Record<string, unknown> = {};
    if (validMonth(month)) {
      const [y, m] = month.split('-').map(Number);
      punchWhere = { timestamp: { gte: new Date(y, m - 1, 1), lt: new Date(y, m, 1) } };
    }

    const [units, users, punches, certificates, requests, settings, inconsistencies] = await Promise.all([
      prisma.unit.findMany({ orderBy: { name: 'asc' } }),
      prisma.user.findMany({
        select: {
          id: true,
          name: true,
          employeeNumber: true,
          cpf: true,
          jobTitle: true,
          workDays: true,
          scheduleStart: true,
          scheduleEnd: true,
          scheduleByDay: true,
          profileJson: true,
          email: true,
          role: true,
          active: true,
          unitId: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: [{ employeeNumber: 'asc' }, { name: 'asc' }],
      }),
      prisma.punch.findMany({
        where: punchWhere,
        select: {
          id: true,
          userId: true,
          unitId: true,
          type: true,
          timestamp: true,
          clientTimestamp: true,
          syncedAt: true,
          syncStatus: true,
          deviceId: true,
          deviceOs: true,
          appVersion: true,
          connectivity: true,
          latitude: true,
          longitude: true,
          accuracy: true,
          locationValid: true,
          status: true,
          origin: true,
          clientId: true,
          createdAt: true,
          photoData: includePhotos,
        },
        orderBy: { timestamp: 'asc' },
      }),
      prisma.medicalCertificate.findMany({
        select: {
          id: true,
          type: true,
          userId: true,
          createdById: true,
          startDate: true,
          endDate: true,
          startTime: true,
          endTime: true,
          hoursPerDayMinutes: true,
          daysCount: true,
          workDaysCount: true,
          documentName: true,
          documentMime: true,
          observation: true,
          status: true,
          canceledAt: true,
          cancelReason: true,
          createdAt: true,
        },
        orderBy: { startDate: 'asc' },
      }),
      prisma.employeeRequest.findMany({
        select: {
          id: true,
          employeeId: true,
          reviewerId: true,
          type: true,
          status: true,
          startDate: true,
          endDate: true,
          reason: true,
          details: true,
          medicalSpecialty: true,
          classification: true,
          returnExpected: true,
          documentName: true,
          reviewNote: true,
          reviewedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.unitSettings.findMany(),
      prisma.inconsistency.findMany({
        select: {
          id: true,
          userId: true,
          punchId: true,
          type: true,
          status: true,
          description: true,
          detectedAt: true,
          resolvedAt: true,
          resolvedBy: true,
        },
      }),
    ]);

    await appendAuditEvent({
      action: 'BACKUP_EXPORT',
      actorId: session.user.id,
      resource: 'SystemBackup',
      resourceId: validMonth(month) ? month : 'FULL',
      metadata: {
        format,
        includePhotos,
        punchCount: punches.length,
        userCount: users.length,
      },
    }).catch(() => undefined);

    if (format === 'csv') {
      const header = [
        'id',
        'userId',
        'employeeNumber',
        'employeeName',
        'type',
        'timestamp',
        'status',
        'origin',
        'latitude',
        'longitude',
        'clientId',
        'hasPhoto',
      ];
      const byUser = new Map(users.map((u) => [u.id, u]));
      const lines = [header.join(',')];
      for (const p of punches) {
        const u = byUser.get(p.userId);
        lines.push(
          [
            p.id,
            p.userId,
            u?.employeeNumber || '',
            u?.name || '',
            p.type,
            p.timestamp instanceof Date ? p.timestamp.toISOString() : p.timestamp,
            p.status,
            p.origin,
            p.latitude ?? '',
            p.longitude ?? '',
            p.clientId || '',
            includePhotos && (p as { photoData?: string | null }).photoData ? '1' : '0',
          ]
            .map(csvEscape)
            .join(','),
        );
      }
      const body = lines.join('\n');
      const filename = `backup-marcacoes-${validMonth(month) ? month : 'completo'}-${stamp}.csv`;
      return new NextResponse(body, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    const payload = {
      meta: {
        system: 'Ponto Progredir',
        version: 1,
        generatedAt: now.toISOString(),
        month: validMonth(month) ? month : null,
        includePhotos,
        note: 'Backup operacional. Senhas não são exportadas. Documentos de atestado em binário não estão neste arquivo.',
      },
      units,
      unitSettings: settings.map((s) => ({
        ...s,
        signatureData: s.signatureData ? '[PRESENT]' : null,
      })),
      users,
      punches,
      medicalCertificates: certificates,
      employeeRequests: requests,
      inconsistencies,
    };

    const filename = `backup-ponto-${validMonth(month) ? month : 'completo'}${includePhotos ? '-com-fotos' : ''}-${stamp}.json`;
    return new NextResponse(JSON.stringify(payload), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('backup failed', error);
    return NextResponse.json({ error: 'Não foi possível gerar o backup.' }, { status: 500 });
  }
}
