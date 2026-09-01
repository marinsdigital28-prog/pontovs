import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { appendAuditEvent, consumeRateLimit, getRequestKey, rateLimitResponse } from '@/lib/security-controls';
import { brazilDateKey } from '@/lib/brazil-time';
import { autoDescription, autoDescriptionPrefix, autoIssueKey, detectInconsistencies, extractAutoKey, parseDateBoundary } from '@/lib/inconsistency-detector';

export const dynamic = 'force-dynamic';

async function requireManager() {
  const session = (await getServerSession(authOptions as any)) as any;
  const id = session?.user?.id as string | undefined;
  if (!id) return null;
  return prisma.user.findFirst({ where: { id, active: true, role: { in: ['ADMIN', 'MANAGER'] } }, select: { id: true, name: true } });
}

function defaultBounds() {
  const today = brazilDateKey();
  return { fromValue: `${today.slice(0, 7)}-01`, toValue: today };
}

function mapPersistedIssue(issue: { id: string; userId: string; type: string; status: string; description: string | null; detectedAt: Date; user: { id: string; name: string; employeeNumber: string | null; jobTitle: string | null }; punch: { id: string; type: string; timestamp: Date } | null }) {
  return {
    key: `stored:${issue.id}`,
    id: issue.id,
    userId: issue.userId,
    punchId: issue.punch?.id || null,
    type: issue.type,
    severity: 'MEDIUM',
    date: issue.punch ? brazilDateKey(issue.punch.timestamp) : brazilDateKey(issue.detectedAt),
    weekday: '',
    description: issue.description || 'Pendência registrada para revisão.',
    missingTypes: [],
    duplicateTypes: [],
    suggestedTimes: {},
    actualPunches: issue.punch ? [{ id: issue.punch.id, type: issue.punch.type, timestamp: issue.punch.timestamp.toISOString() }] : [],
    expectedMinutes: null,
    workedMinutes: null,
    user: issue.user,
  };
}

export async function GET(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 401 });
  const rate = await consumeRateLimit(getRequestKey(request, 'admin-inconsistencies-read', manager.id), 30, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);

  const url = new URL(request.url);
  const defaults = defaultBounds();
  const fromValue = url.searchParams.get('from') || defaults.fromValue;
  const toValue = url.searchParams.get('to') || defaults.toValue;
  const employeeId = url.searchParams.get('employeeId') || '';
  const from = parseDateBoundary(fromValue, false);
  const to = parseDateBoundary(toValue, true);
  if (!from || !to) return NextResponse.json({ error: 'Período inválido.' }, { status: 400 });
  if (from > to) return NextResponse.json({ error: 'A data inicial não pode ser posterior à data final.' }, { status: 400 });

  const employeeWhere: any = { role: 'EMPLOYEE', active: true };
  if (employeeId) employeeWhere.id = employeeId;
  const employees = await prisma.user.findMany({ where: employeeWhere, select: { id: true, name: true, employeeNumber: true, jobTitle: true, workDays: true, scheduleStart: true, scheduleEnd: true, scheduleByDay: true }, orderBy: { name: 'asc' }, take: 1000 });
  const employeeIds = employees.map((employee) => employee.id);
  if (!employeeIds.length) return NextResponse.json({ inconsistencies: [], total: 0, from: fromValue, to: toValue });

  const [punches, certificates, requests, persistedOpen, persistedResolved] = await Promise.all([
    prisma.punch.findMany({ where: { userId: { in: employeeIds }, timestamp: { gte: from, lte: to } }, select: { id: true, userId: true, type: true, timestamp: true, status: true }, orderBy: { timestamp: 'asc' }, take: 10000 }),
    prisma.medicalCertificate.findMany({ where: { userId: { in: employeeIds }, startDate: { lte: to }, endDate: { gte: from }, status: { in: ['APROVADO', 'ATIVO'] } }, select: { userId: true, startDate: true, endDate: true, status: true, type: true }, take: 5000 }),
    prisma.employeeRequest.findMany({ where: { employeeId: { in: employeeIds }, startDate: { lte: to }, endDate: { gte: from }, status: 'APROVADO' }, select: { employeeId: true, startDate: true, endDate: true, status: true, type: true }, take: 5000 }),
    prisma.inconsistency.findMany({ where: { status: 'OPEN', ...(employeeId ? { userId: employeeId } : {}) }, orderBy: { detectedAt: 'desc' }, take: 5000, select: { id: true, userId: true, type: true, status: true, description: true, detectedAt: true, user: { select: { id: true, name: true, employeeNumber: true, jobTitle: true } }, punch: { select: { id: true, type: true, timestamp: true } } } }),
    prisma.inconsistency.findMany({ where: { status: 'RESOLVED', ...(employeeId ? { userId: employeeId } : {}) }, orderBy: { resolvedAt: 'desc' }, take: 10000, select: { description: true } }),
  ]);

  const resolvedKeys = new Set(persistedResolved.map((issue) => extractAutoKey(issue.description)).filter((key): key is string => Boolean(key)));
  const detected = detectInconsistencies({ employees, punches, exceptions: [...certificates, ...requests].map((item: any) => ({ userId: item.userId || item.employeeId, startDate: item.startDate, endDate: item.endDate, status: item.status, type: item.type })), from: fromValue, to: toValue }).filter((issue) => !resolvedKeys.has(issue.key));
  const stored = persistedOpen.filter((issue) => !extractAutoKey(issue.description || '')).map(mapPersistedIssue).filter((issue) => issue.date >= fromValue && issue.date <= toValue);
  const inconsistencies = [...detected, ...stored].sort((a, b) => `${b.date}|${b.user.name}`.localeCompare(`${a.date}|${a.user.name}`));
  return NextResponse.json({ inconsistencies, total: inconsistencies.length, from: fromValue, to: toValue });
}

export async function PATCH(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 401 });
  const rate = await consumeRateLimit(getRequestKey(request, 'admin-inconsistencies-write', manager.id), 20, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);

  const body = await request.json().catch(() => null);
  const requestedIds = Array.isArray(body?.ids) ? body.ids : body?.id ? [body.id] : [];
  const ids: string[] = Array.from(new Set((requestedIds as unknown[]).map((value) => String(value ?? '').trim()).filter((value) => value.length > 0)));
  const status = body?.status === 'OPEN' ? 'OPEN' : body?.status === 'RESOLVED' ? 'RESOLVED' : '';
  const reason = String(body?.reason || '').trim();
  if (!ids.length || ids.length > 500) return NextResponse.json({ error: 'Selecione entre 1 e 500 inconsistências.' }, { status: 400 });
  if (!status) return NextResponse.json({ error: 'Status de tratamento inválido.' }, { status: 400 });
  if (reason.length < 5) return NextResponse.json({ error: 'Informe um motivo com pelo menos 5 caracteres.' }, { status: 400 });

  try {
    const result = await prisma.$transaction(async (tx) => {
      let updated = 0;
      for (const id of ids) {
        const key = autoIssueKey(id);
        if (key) {
          const existing = await tx.inconsistency.findFirst({ where: { OR: [{ description: { startsWith: autoDescriptionPrefix(key) } }, { description: { startsWith: `AUTO_KEY:${key}|` } }] }, select: { id: true } });
          if (existing) {
            await tx.inconsistency.update({ where: { id: existing.id }, data: { status, resolvedAt: status === 'RESOLVED' ? new Date() : null, resolvedBy: status === 'RESOLVED' ? manager.id : null, description: autoDescription(key, reason) } });
          } else if (status === 'RESOLVED') {
            const userId = key.split('|')[0];
            const type = key.split('|').slice(2).join('|') || 'REVIEW';
            await tx.inconsistency.create({ data: { id: crypto.randomUUID(), userId, type, status, description: autoDescription(key, reason), resolvedAt: new Date(), resolvedBy: manager.id } });
          }
          updated += 1;
          continue;
        }
        const changed = await tx.inconsistency.updateMany({ where: { id }, data: { status, resolvedAt: status === 'RESOLVED' ? new Date() : null, resolvedBy: status === 'RESOLVED' ? manager.id : null, description: status === 'RESOLVED' ? `${reason}` : undefined } });
        updated += changed.count;
      }
      return updated;
    });
    await appendAuditEvent({ action: status === 'RESOLVED' ? 'INCONSISTENCIES_RESOLVED' : 'INCONSISTENCIES_REOPENED', actorId: manager.id, resource: 'Inconsistency', metadata: { ids, count: result, reason } });
    return NextResponse.json({ ok: true, updated: result });
  } catch (error) {
    console.error('inconsistency treatment failed', error);
    return NextResponse.json({ error: 'Não foi possível tratar as inconsistências selecionadas.' }, { status: 500 });
  }
}
