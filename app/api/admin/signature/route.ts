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
  const settings = await prisma.unitSettings.findFirst({ select: { signatureData: true } });
  return NextResponse.json({ signatureData: settings?.signatureData ?? null });
}

export async function POST(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 401 });
  const rate = await consumeRateLimit(getRequestKey(request, 'admin-signature-write', manager.id), 10, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);
  const body = await request.json().catch(() => null);
  const signatureData = body?.signatureData === null ? null : String(body?.signatureData ?? '').trim();
  if (signatureData && (signatureData.length > MAX_SIGNATURE_LENGTH || !DATA_URL_PATTERN.test(signatureData))) {
    return NextResponse.json({ error: 'Envie uma assinatura PNG, JPG ou WebP válida, com até 2 MB.' }, { status: 400 });
  }

  const settings = await prisma.$transaction(async (tx) => {
    const unit = await tx.unit.upsert({ where: { id: DEFAULT_UNIT_ID }, update: {}, create: { id: DEFAULT_UNIT_ID, name: 'Espaço Progredir', active: true } });
    return tx.unitSettings.upsert({ where: { unitId: unit.id }, update: { signatureData }, create: { id: crypto.randomUUID(), unitId: unit.id, signatureData } });
  });
  await appendAuditEvent({ action: signatureData ? 'INSTITUTION_SIGNATURE_UPDATED' : 'INSTITUTION_SIGNATURE_REMOVED', actorId: manager.id, resource: 'UnitSettings', resourceId: settings.id, metadata: { bytes: signatureData?.length ?? 0 } });
  return NextResponse.json({ ok: true, configured: Boolean(signatureData) });
}
