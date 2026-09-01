import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { brazilDayRange } from '@/lib/brazil-time';
import { getAuditEvents, verifyAuditChain } from '@/lib/security-controls';

export const dynamic = 'force-dynamic';

async function requireManager() {
  const session = (await getServerSession(authOptions as any)) as any;
  const id = session?.user?.id as string | undefined;
  if (!id) return null;
  return prisma.user.findFirst({ where: { id, active: true, role: { in: ['ADMIN', 'MANAGER'] } }, select: { id: true, name: true, role: true } });
}

function metadataText(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === 'string' ? value : null;
}

function metadataReason(metadata: Record<string, unknown> | undefined) {
  return metadataText(metadata, 'reason') || metadataText(metadata, 'justification') || null;
}

export async function GET() {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor.' }, { status: 401 });
  const { start, end } = brazilDayRange();

  try {
    const [recordsToday, alteredRecords, justifiedRecords, adminActions, openInconsistencies, pendingRequests, chainValid, events, withLocation, withPhoto, offlineRecords, pendingSync, failedSync, syncedLater, lastSync, withoutLocation] = await Promise.all([
      prisma.punch.count({ where: { timestamp: { gte: start, lt: end } } }),
      prisma.punch.count({ where: { origin: 'ADJUSTED' } }),
      prisma.punchAudit.count({ where: { reason: { not: null } } }),
      prisma.securityAuditEvent.count(),
      prisma.inconsistency.count({ where: { status: 'OPEN' } }),
      prisma.employeeRequest.count({ where: { status: 'PENDENTE' } }),
      verifyAuditChain(),
      getAuditEvents(30),
      prisma.punch.count({ where: { latitude: { not: null }, longitude: { not: null } } }),
      prisma.punch.count({ where: { photoData: { not: null } } }),
      prisma.punch.count({ where: { origin: 'OFFLINE' } }),
      prisma.punch.count({ where: { syncStatus: { in: ['PENDING', 'RETRYING'] } } }),
      prisma.punch.count({ where: { syncStatus: 'FAILED' } }),
      prisma.punch.count({ where: { origin: 'OFFLINE', syncedAt: { not: null } } }),
      prisma.punch.findFirst({ where: { syncedAt: { not: null } }, orderBy: { syncedAt: 'desc' }, select: { syncedAt: true } }),
      prisma.punch.count({ where: { latitude: null } }),
    ]);

    const [actorIds, punchIds, auditWithoutReason, auditRows, deniedAccessEvents] = [
      [...new Set(events.map((event) => event.actorId).filter((id): id is string => Boolean(id)))],
      [...new Set(events.filter((event) => event.resource === 'Punch' && event.resourceId).map((event) => event.resourceId as string))],
      await prisma.punchAudit.count({ where: { OR: [{ reason: null }, { reason: '' }] } }),
      await prisma.punchAudit.findMany({ select: { punchId: true }, take: 20000 }),
      await prisma.securityAuditEvent.count({ where: { action: { contains: 'DENIED' } } }),
    ];
    const [actors, relatedPunches] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, employeeNumber: true } }),
      prisma.punch.findMany({ where: { id: { in: punchIds } }, select: { id: true, user: { select: { name: true, employeeNumber: true } } } }),
    ]);
    const actorById = new Map(actors.map((actor) => [actor.id, actor]));
    const punchById = new Map(relatedPunches.map((punch) => [punch.id, punch.user]));
    const multipleChanges = new Set<string>();
    const auditCounts = new Map<string, number>();
    for (const row of auditRows) auditCounts.set(row.punchId, (auditCounts.get(row.punchId) || 0) + 1);
    for (const [punchId, count] of auditCounts) if (count > 1) multipleChanges.add(punchId);

    const mappedEvents = events.map((event) => {
      const employee = event.resourceId && punchById.get(event.resourceId) ? punchById.get(event.resourceId) : null;
      const actor = event.actorId ? actorById.get(event.actorId) : null;
      const reason = metadataReason(event.metadata);
      const changes = Array.isArray(event.metadata?.changes) ? event.metadata?.changes : null;
      return { id: event.id, createdAt: event.createdAt, action: event.action, resource: event.resource, resourceId: event.resourceId, actorName: actor?.name || event.actorId || 'Sistema', actorEmployeeNumber: actor?.employeeNumber || null, affectedEmployeeName: employee?.name || metadataText(event.metadata, 'employeeName') || null, affectedEmployeeNumber: employee?.employeeNumber || metadataText(event.metadata, 'employeeNumber') || null, reason, changes, status: event.action.includes('FAILED') || event.action.includes('DENIED') ? 'Atenção' : 'Registrado', hash: event.hash };
    });

    const alerts: Array<{ id: string; level: 'CRITICAL' | 'WARNING' | 'INFO'; title: string; detail: string; count?: number }> = [];
    if (!chainValid) alerts.push({ id: 'audit-chain', level: 'CRITICAL', title: 'Cadeia de auditoria requer revisão', detail: 'A verificação criptográfica encontrou uma divergência nos eventos registrados.' });
    if (openInconsistencies > 0) alerts.push({ id: 'inconsistencies', level: 'WARNING', title: 'Inconsistências de jornada pendentes', detail: 'Há ocorrências que precisam ser analisadas pela gestão.', count: openInconsistencies });
    if (auditWithoutReason > 0) alerts.push({ id: 'without-reason', level: 'WARNING', title: 'Ações sem justificativa registrada', detail: 'Existem alterações históricas sem motivo preenchido para conferência.', count: auditWithoutReason });
    if (multipleChanges.size > 0) alerts.push({ id: 'multiple-changes', level: 'INFO', title: 'Registros com múltiplas alterações', detail: 'Alguns registros possuem mais de uma mudança no histórico.', count: multipleChanges.size });
    if (deniedAccessEvents > 0) alerts.push({ id: 'denied-access', level: 'INFO', title: 'Tentativas de acesso sem permissão', detail: 'Há eventos de acesso negado registrados para análise.', count: deniedAccessEvents });
    if (pendingSync > 0) alerts.push({ id: 'pending-sync', level: 'WARNING', title: 'Existem marcações aguardando sincronização', detail: 'Registros offline ainda aguardam confirmação do servidor.', count: pendingSync });
    if (failedSync > 0) alerts.push({ id: 'failed-sync', level: 'WARNING', title: 'Falhas de sincronização', detail: 'Há registros que não foram confirmados e precisam de nova tentativa ou análise.', count: failedSync });
    if (withoutLocation > 0) alerts.push({ id: 'location-missing', level: 'INFO', title: 'Localização não registrada em alguns eventos', detail: 'A ausência de GPS é apresentada como informação incompleta, não como fraude.', count: withoutLocation });
    if (!alerts.length) alerts.push({ id: 'none', level: 'INFO', title: 'Nenhuma ocorrência crítica identificada', detail: 'As verificações disponíveis não encontraram alertas críticos neste momento.' });

    const last = mappedEvents[0] || null;
    return NextResponse.json({ generatedAt: new Date().toISOString(), controls: { integrityOperational: chainValid, auditActive: true, traceabilityActive: true, historyAvailable: true, accessControlActive: true }, metrics: { recordsToday, alteredRecords, justifiedRecords, adminActions, pendingOccurrences: openInconsistencies + pendingRequests + pendingSync + failedSync, identifiedInconsistencies: openInconsistencies, lastActivity: last?.createdAt || null, withLocation, withPhoto, offlineRecords, syncedLater, pendingSync, failedSync, lastSync: lastSync?.syncedAt || null, withoutLocation }, lastActivity: last, alerts, events: mappedEvents, chainValid, manager: { name: manager.name, role: manager.role } });
  } catch (error) {
    console.error('integrity dashboard failed', error);
    return NextResponse.json({ error: 'Não foi possível calcular os indicadores de integridade.' }, { status: 503 });
  }
}
