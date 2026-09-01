import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { appendAuditEvent, getAuditEvents, verifyAuditChain } from '@/lib/security-controls';
import prisma from '@/lib/prisma';
import { parseDateBoundary } from '@/lib/inconsistency-detector';

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

function csvCell(value: unknown) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }

export async function GET(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor.' }, { status: 401 });
  await appendAuditEvent({ action: 'AUDIT_VIEWED', actorId: manager.id, resource: 'SecurityAudit' });

  const url = new URL(request.url);
  const fromValue = url.searchParams.get('from');
  const toValue = url.searchParams.get('to');
  const actorId = url.searchParams.get('actorId') || '';
  const employeeId = url.searchParams.get('employeeId') || '';
  const action = url.searchParams.get('action') || '';
  const status = url.searchParams.get('status') || '';
  const search = (url.searchParams.get('search') || '').trim().toLowerCase();
  const from = fromValue ? parseDateBoundary(fromValue, false) : null;
  const to = toValue ? parseDateBoundary(toValue, true) : null;
  if ((fromValue && !from) || (toValue && !to)) return NextResponse.json({ error: 'Período inválido.' }, { status: 400 });
  if (from && to && from > to) return NextResponse.json({ error: 'A data inicial não pode ser posterior à data final.' }, { status: 400 });

  const events = await getAuditEvents(5000);
  const actorIds = [...new Set(events.map((event) => event.actorId).filter((id): id is string => Boolean(id)))];
  const relatedPunchIds = [...new Set(events.filter((event) => event.resource === 'Punch' && event.resourceId).map((event) => event.resourceId as string))];
  const metadataEmployeeIds = [...new Set(events.map((event) => metadataText(event.metadata, 'userId') || metadataText(event.metadata, 'employeeId')).filter((id): id is string => Boolean(id)))];
  const [actors, employees, punches] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, employeeNumber: true }, take: 5000 }),
    prisma.user.findMany({ where: { id: { in: metadataEmployeeIds } }, select: { id: true, name: true, employeeNumber: true }, take: 5000 }),
    prisma.punch.findMany({ where: { id: { in: relatedPunchIds } }, select: { id: true, userId: true, user: { select: { id: true, name: true, employeeNumber: true } } }, take: 5000 }),
  ]);
  const actorById = new Map(actors.map((item) => [item.id, item]));
  const employeeById = new Map(employees.map((item) => [item.id, item]));
  const employeeByPunchId = new Map(punches.map((item) => [item.id, item.user]));
  const actionLabels: Record<string, string> = { PUNCH_CREATED: 'Criação de marcação', PUNCH_SYNCED_OFFLINE: 'Sincronização offline', PUNCH_EDITED: 'Alteração de marcação', PUNCH_CREATED_MANUAL: 'Ajuste manual', PUNCH_CANCELLED: 'Cancelamento de registro', AUDIT_VIEWED: 'Consulta de auditoria', INCONSISTENCIES_RESOLVED: 'Resolução de inconsistências', INCONSISTENCIES_REOPENED: 'Reabertura de inconsistências', PUNCHES_EXPORTED: 'Exportação de registros', TIMESHEET_CLOSED: 'Fechamento de folha', TIMESHEET_REOPENED: 'Reabertura de folha' };
  const mapped = events.map((event) => {
    const metadataEmployeeId = metadataText(event.metadata, 'userId') || metadataText(event.metadata, 'employeeId');
    const employee = (event.resourceId && employeeByPunchId.get(event.resourceId)) || (metadataEmployeeId ? employeeById.get(metadataEmployeeId) : null);
    const actor = event.actorId ? actorById.get(event.actorId) : null;
    const reason = metadataText(event.metadata, 'reason') || metadataText(event.metadata, 'justification');
    const eventStatus = event.action.includes('FAILED') || event.action.includes('DENIED') ? 'Atenção' : 'Registrado';
    return { id: event.id, createdAt: event.createdAt, actorId: event.actorId, actorName: actor?.name || event.actorId || 'Sistema', actorEmployeeNumber: actor?.employeeNumber || null, action: event.action, actionLabel: actionLabels[event.action] || event.action, resource: event.resource, resourceId: event.resourceId, employeeId: employee?.id || metadataEmployeeId || null, affectedEmployeeName: employee?.name || metadataText(event.metadata, 'employeeName') || null, affectedEmployeeNumber: employee?.employeeNumber || metadataText(event.metadata, 'employeeNumber') || null, reason: reason || null, status: eventStatus, metadata: event.metadata || null, previousHash: event.previousHash, hash: event.hash };
  }).filter((event) => {
    const eventDate = new Date(event.createdAt);
    if (from && eventDate < from) return false;
    if (to && eventDate > to) return false;
    if (actorId && event.actorId !== actorId) return false;
    if (employeeId && event.employeeId !== employeeId) return false;
    if (action && event.action !== action) return false;
    if (status && event.status !== status) return false;
    if (search && ![event.actorName, event.actionLabel, event.affectedEmployeeName, event.reason, event.resource, event.resourceId].filter(Boolean).join(' ').toLowerCase().includes(search)) return false;
    return true;
  });

  if (url.searchParams.get('format') === 'csv') {
    const header = ['Data', 'Hora', 'Usuário', 'Ação', 'Funcionário afetado', 'Registro relacionado', 'Motivo/justificativa', 'Status', 'Hash'];
    const rows = mapped.map((event) => { const date = new Date(event.createdAt); return [date.toLocaleDateString('pt-BR'), date.toLocaleTimeString('pt-BR'), event.actorName, event.actionLabel, event.affectedEmployeeName || '', event.resourceId || '', event.reason || '', event.status, event.hash]; });
    return new Response(`\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n')}`, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="auditoria-ponto-${new Date().toISOString().slice(0, 10)}.csv"` } });
  }

  const [chainValid] = await Promise.all([verifyAuditChain()]);
  return NextResponse.json({ chainValid, events: mapped, total: mapped.length, mode: process.env.UPSTASH_REDIS_REST_URL ? 'redis-plus-postgres' : 'postgres-plus-memory-rate-limit-fallback' });
}
