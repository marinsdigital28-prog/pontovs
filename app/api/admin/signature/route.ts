import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { appendAuditEvent, consumeRateLimit, getRequestKey, rateLimitResponse } from '@/lib/security-controls';

export const dynamic = 'force-dynamic';

const DEFAULT_UNIT_ID = 'unit-espaco-progredir';
const MAX_SIGNATURE_LENGTH = 2_500_000;
const DATA_URL_PATTERN = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\r\n]+$/;

async function requireManager() {
  const session = (await getServerSession(authOptions as any)) as any;
  const id = session?.user?.id as string | undefined;
  if (!id) return null;
  return prisma.user.findFirst({ where: { id, active: true, role: { in: ['ADMIN', 'MANAGER'] } }, select: { id: true, name: true } });
}

export async function GET(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 401 });
  const rate = await consumeRateLimit(getRequestKey(request, 'admin-signature-read', manager.id), 30, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);
  const settings = await prisma.unitSettings.findFirst({ select: { signatureData: true, latitude: true, longitude: true, geofenceRadiusMeters: true, requireLocation: true, allowOffline: true, maxOfflineHours: true } });
  return NextResponse.json({ signatureData: settings?.signatureData ?? null, location: settings ? { latitude: settings.latitude, longitude: settings.longitude, geofenceRadiusMeters: settings.geofenceRadiusMeters, requireLocation: settings.requireLocation, allowOffline: settings.allowOffline, maxOfflineHours: settings.maxOfflineHours } : null });
}

export async function POST(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 401 });
  const rate = await consumeRateLimit(getRequestKey(request, 'admin-signature-write', manager.id), 10, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);
  const body = await request.json().catch(() => null);
  const hasSignatureUpdate = Object.prototype.hasOwnProperty.call(body || {}, 'signatureData');
  const signatureData = body?.signatureData === null ? null : String(body?.signatureData ?? '').trim();
  const location = body?.location && typeof body.location === 'object' ? body.location : null;
  const hasLocationUpdate = Boolean(location);
  const latitude = location?.latitude === null || location?.latitude === undefined || location?.latitude === '' ? null : Number(location.latitude);
  const longitude = location?.longitude === null || location?.longitude === undefined || location?.longitude === '' ? null : Number(location.longitude);
  const geofenceRadiusMeters = location?.geofenceRadiusMeters === undefined ? undefined : Number(location.geofenceRadiusMeters);
  const requireLocation = location?.requireLocation === undefined ? undefined : Boolean(location.requireLocation);
  const allowOffline = location?.allowOffline === undefined ? undefined : Boolean(location.allowOffline);
  const maxOfflineHours = location?.maxOfflineHours === undefined ? undefined : Number(location.maxOfflineHours);
  if (hasSignatureUpdate && signatureData && (signatureData.length > MAX_SIGNATURE_LENGTH || !DATA_URL_PATTERN.test(signatureData))) {
    return NextResponse.json({ error: 'Envie uma assinatura PNG, JPG ou WebP válida, com até 2 MB.' }, { status: 400 });
  }
  if (hasLocationUpdate && ((latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) || (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) || (geofenceRadiusMeters !== undefined && (!Number.isInteger(geofenceRadiusMeters) || geofenceRadiusMeters < 1 || geofenceRadiusMeters > 10000)) || (maxOfflineHours !== undefined && (!Number.isInteger(maxOfflineHours) || maxOfflineHours < 1 || maxOfflineHours > 720)))) return NextResponse.json({ error: 'Configuração de localização ou offline inválida.' }, { status: 400 });

  const settings = await prisma.$transaction(async (tx) => {
    const unit = await tx.unit.upsert({ where: { id: DEFAULT_UNIT_ID }, update: {}, create: { id: DEFAULT_UNIT_ID, name: 'Espaço Progredir', active: true } });
    const existing = await tx.unitSettings.findUnique({ where: { unitId: unit.id } });
    const updateData: Record<string, unknown> = {};
    if (hasSignatureUpdate) updateData.signatureData = signatureData;
    if (hasLocationUpdate) { updateData.latitude = latitude; updateData.longitude = longitude; if (geofenceRadiusMeters !== undefined) updateData.geofenceRadiusMeters = geofenceRadiusMeters; if (requireLocation !== undefined) updateData.requireLocation = requireLocation; if (allowOffline !== undefined) updateData.allowOffline = allowOffline; if (maxOfflineHours !== undefined) updateData.maxOfflineHours = maxOfflineHours; }
    return existing ? tx.unitSettings.update({ where: { unitId: unit.id }, data: updateData }) : tx.unitSettings.create({ data: { id: crypto.randomUUID(), unitId: unit.id, signatureData: hasSignatureUpdate ? signatureData : null, latitude, longitude, geofenceRadiusMeters: geofenceRadiusMeters ?? 150, requireLocation: requireLocation ?? true, allowOffline: allowOffline ?? true, maxOfflineHours: maxOfflineHours ?? 24 } });
  });
  if (hasSignatureUpdate) await appendAuditEvent({ action: signatureData ? 'INSTITUTION_SIGNATURE_UPDATED' : 'INSTITUTION_SIGNATURE_REMOVED', actorId: manager.id, resource: 'UnitSettings', resourceId: settings.id, metadata: { bytes: signatureData?.length ?? 0 } });
  if (hasLocationUpdate) await appendAuditEvent({ action: 'WORK_LOCATION_SETTINGS_UPDATED', actorId: manager.id, resource: 'UnitSettings', resourceId: settings.id, metadata: { latitude, longitude, geofenceRadiusMeters: settings.geofenceRadiusMeters, requireLocation: settings.requireLocation, allowOffline: settings.allowOffline, maxOfflineHours: settings.maxOfflineHours } });
  return NextResponse.json({ ok: true, configured: Boolean(settings.signatureData), location: { latitude: settings.latitude, longitude: settings.longitude, geofenceRadiusMeters: settings.geofenceRadiusMeters, requireLocation: settings.requireLocation, allowOffline: settings.allowOffline, maxOfflineHours: settings.maxOfflineHours } });
}
