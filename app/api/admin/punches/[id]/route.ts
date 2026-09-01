import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { appendAuditEvent, consumeRateLimit, getRequestKey, rateLimitResponse } from '../../../../../lib/security-controls';
import { isPeriodClosed, periodFromDate } from '../../../../../lib/period-closure';
import { evaluateLocation } from '../../../../../lib/punch-integrity';

export const dynamic = 'force-dynamic';
const allowedTypes = new Set(['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA']);

async function requireManager() {
  const session = (await getServerSession(authOptions as any)) as any;
  const id = session?.user?.id as string | undefined;
  if (!id) return null;
  return prisma.user.findFirst({ where: { id, active: true, role: { in: ['ADMIN', 'MANAGER'] } }, select: { id: true, name: true } });
}

function parseTimestamp(value: unknown) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 401 });
  const { id: rawId } = await context.params;
  const id = String(rawId || '').trim();
  const punch = await prisma.punch.findUnique({ where: { id }, select: { id: true, userId: true, type: true, timestamp: true, clientTimestamp: true, syncedAt: true, syncStatus: true, syncAttempts: true, syncError: true, origin: true, connectivity: true, deviceId: true, deviceOs: true, appVersion: true, latitude: true, longitude: true, accuracy: true, locationCapturedAt: true, locationValid: true, photoData: true, createdAt: true, updatedAt: true, status: true, unit: { select: { settings: { select: { latitude: true, longitude: true, geofenceRadiusMeters: true } } } }, user: { select: { id: true, name: true, employeeNumber: true, jobTitle: true } }, audits: { orderBy: { createdAt: 'asc' }, select: { id: true, field: true, oldValue: true, newValue: true, reason: true, createdAt: true, changedBy: { select: { id: true, name: true, employeeNumber: true } } } } } });
  if (!punch) return NextResponse.json({ error: 'Marcação não encontrada.' }, { status: 404 });
  const reference = punch.photoData ? null : await prisma.punch.findFirst({ where: { userId: punch.userId, id: { not: punch.id }, photoData: { not: null } }, orderBy: { timestamp: 'desc' }, select: { id: true, type: true, timestamp: true, createdAt: true } });
  const settings = punch.unit?.settings;
  const location = evaluateLocation({ latitude: punch.latitude, longitude: punch.longitude, accuracy: punch.accuracy, companyLatitude: settings?.latitude ?? null, companyLongitude: settings?.longitude ?? null, radiusMeters: settings?.geofenceRadiusMeters ?? 150 });
  return NextResponse.json({ punch: { ...punch, photoData: undefined, hasPhoto: Boolean(punch.photoData), locationStatus: location.status, distanceMeters: location.distanceMeters, companyLocation: settings?.latitude !== null && settings?.latitude !== undefined && settings?.longitude !== null && settings?.longitude !== undefined ? { latitude: settings.latitude, longitude: settings.longitude, radiusMeters: settings.geofenceRadiusMeters } : null, referencePhoto: reference ? { ...reference, warning: 'Esta foto pertence a outra marcação e não é evidência do registro atual.' } : null } });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 401 });
  const rate = await consumeRateLimit(getRequestKey(request, 'admin-punch-write', manager.id), 20, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);
  const { id: rawId } = await context.params;
  const id = String(rawId || '').trim();
  const body = await request.json().catch(() => null);
  const reason = String(body?.reason ?? '').trim();
  if (reason.length < 5) return NextResponse.json({ error: 'Informe um motivo com pelo menos 5 caracteres.' }, { status: 400 });
  const existing = await prisma.punch.findUnique({ where: { id }, select: { id: true, type: true, timestamp: true, status: true, userId: true } });
  if (!existing) return NextResponse.json({ error: 'Marcação não encontrada.' }, { status: 404 });
  if (existing.status === 'REJECTED') return NextResponse.json({ error: 'Uma marcação cancelada não pode ser editada.' }, { status: 409 });
  if (await isPeriodClosed(periodFromDate(existing.timestamp))) return NextResponse.json({ error: 'A competência desta marcação está fechada. Reabra o período com autorização e justificativa antes de editar.' }, { status: 423 });

  const nextType = body?.type === undefined ? existing.type : String(body.type).trim().toUpperCase();
  const nextTimestamp = body?.timestamp === undefined ? existing.timestamp : parseTimestamp(body.timestamp);
  if (!allowedTypes.has(nextType) || !nextTimestamp) return NextResponse.json({ error: 'Tipo ou data/hora inválidos.' }, { status: 400 });
  const changes: Array<{ field: string; oldValue: string; newValue: string }> = [];
  if (nextType !== existing.type) changes.push({ field: 'type', oldValue: existing.type, newValue: nextType });
  if (nextTimestamp.getTime() !== existing.timestamp.getTime()) changes.push({ field: 'timestamp', oldValue: existing.timestamp.toISOString(), newValue: nextTimestamp.toISOString() });
  if (!changes.length) return NextResponse.json({ error: 'Nenhuma alteração foi informada.' }, { status: 400 });

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const punch = await tx.punch.update({ where: { id }, data: { type: nextType, timestamp: nextTimestamp, origin: 'ADJUSTED' }, select: { id: true, type: true, timestamp: true, status: true, origin: true } });
      for (const change of changes) await tx.punchAudit.create({ data: { id: crypto.randomUUID(), punchId: id, changedById: manager.id, field: change.field, oldValue: change.oldValue, newValue: change.newValue, reason } });
      return punch;
    });
    await appendAuditEvent({ action: 'PUNCH_EDITED', actorId: manager.id, resource: 'Punch', resourceId: id, metadata: { reason, changes } });
    return NextResponse.json({ punch: updated });
  } catch {
    return NextResponse.json({ error: 'Não foi possível editar a marcação.' }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 401 });
  const rate = await consumeRateLimit(getRequestKey(request, 'admin-punch-write', manager.id), 20, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);
  const { id: rawId } = await context.params;
  const id = String(rawId || '').trim();
  const body = await request.json().catch(() => null);
  const reason = String(body?.reason ?? '').trim();
  if (reason.length < 5) return NextResponse.json({ error: 'Informe um motivo com pelo menos 5 caracteres.' }, { status: 400 });
  const existing = await prisma.punch.findUnique({ where: { id }, select: { id: true, type: true, timestamp: true, status: true } });
  if (!existing) return NextResponse.json({ error: 'Marcação não encontrada.' }, { status: 404 });
  if (existing.status === 'REJECTED') return NextResponse.json({ error: 'A marcação já está cancelada.' }, { status: 409 });
  if (await isPeriodClosed(periodFromDate(existing.timestamp))) return NextResponse.json({ error: 'A competência desta marcação está fechada. Reabra o período com autorização e justificativa antes de cancelar.' }, { status: 423 });
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const punch = await tx.punch.update({ where: { id }, data: { status: 'REJECTED', origin: 'ADJUSTED' }, select: { id: true, type: true, timestamp: true, status: true, origin: true } });
      await tx.punchAudit.create({ data: { id: crypto.randomUUID(), punchId: id, changedById: manager.id, field: 'status', oldValue: existing.status, newValue: 'REJECTED', reason } });
      return punch;
    });
    await appendAuditEvent({ action: 'PUNCH_CANCELLED', actorId: manager.id, resource: 'Punch', resourceId: id, metadata: { reason, type: existing.type, timestamp: existing.timestamp.toISOString() } });
    return NextResponse.json({ punch: updated });
  } catch {
    return NextResponse.json({ error: 'Não foi possível cancelar a marcação.' }, { status: 500 });
  }
}
