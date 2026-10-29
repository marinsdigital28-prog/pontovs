import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { appendAuditEvent } from '@/lib/security-controls';

/**
 * Checklist de atestados — estado de verificação + registro de auditoria.
 * Sem tabela nova: cada ação vira um evento na trilha encadeada (SecurityAuditEvent, hash SHA-256),
 * com resource = 'ChecklistAtestados' e resourceId = mês (AAAA-MM). Nada aqui altera marcações.
 */
export const dynamic = 'force-dynamic';
const RESOURCE = 'ChecklistAtestados';
const ACTIONS = new Set(['CHECKLIST_VERIFIED', 'CHECKLIST_UNVERIFIED', 'CHECKLIST_CHARGED', 'CHECKLIST_CROSSED', 'CHECKLIST_CLOSED', 'CHECKLIST_REOPENED']);

async function requireManager() {
  const session = (await getServerSession(authOptions as any)) as any;
  const id = session?.user?.id as string | undefined;
  if (!id) return null;
  return prisma.user.findFirst({ where: { id, active: true, role: { in: ['ADMIN', 'MANAGER'] } }, select: { id: true, name: true } });
}

export async function GET(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor.' }, { status: 401 });
  const month = new URL(request.url).searchParams.get('month') || '';
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: 'Mês inválido.' }, { status: 400 });
  const rows = await prisma.securityAuditEvent.findMany({ where: { resource: RESOURCE, resourceId: month }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 5000, include: { actor: { select: { name: true } } } });
  const events = rows.map((r) => { let m: any = {}; try { m = r.metadataJson ? JSON.parse(r.metadataJson) : {}; } catch { /* */ } return { id: r.id, action: r.action, key: m.key, note: m.note, count: m.count, actorName: r.actor?.name || 'Sistema', createdAt: r.createdAt.toISOString(), hash: r.hash }; });
  return NextResponse.json({ month, events });
}

export async function POST(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor.' }, { status: 401 });
  const body = await request.json().catch(() => null) as any;
  const month = String(body?.month || ''); const action = String(body?.action || '');
  if (!/^\d{4}-\d{2}$/.test(month) || !ACTIONS.has(action)) return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
  const keys: string[] = Array.isArray(body?.keys) ? body.keys.filter((k: unknown) => typeof k === 'string' && k.length < 300).slice(0, 500) : [];
  const note = typeof body?.note === 'string' ? body.note.slice(0, 500) : undefined;
  const employeeId = typeof body?.employeeId === 'string' ? body.employeeId : undefined;
  if (['CHECKLIST_VERIFIED', 'CHECKLIST_UNVERIFIED', 'CHECKLIST_CHARGED'].includes(action) && !keys.length) return NextResponse.json({ error: 'Nenhuma ocorrência informada.' }, { status: 400 });
  if (keys.length) for (const key of keys) await appendAuditEvent({ action, actorId: manager.id, resource: RESOURCE, resourceId: month, metadata: { key, note, employeeId: key.split('|')[0] } });
  else await appendAuditEvent({ action, actorId: manager.id, resource: RESOURCE, resourceId: month, metadata: { note, count: body?.count, employeeId } });
  return NextResponse.json({ ok: true });
}
