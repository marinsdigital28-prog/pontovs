import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '../../../../lib/auth';
import prisma from '../../../../lib/prisma';
import { appendAuditEvent } from '../../../../lib/security-controls';

export const dynamic = 'force-dynamic';
function manager(session: any) { return Boolean(session?.user?.id && ['ADMIN', 'MANAGER'].includes(String(session?.user?.role || 'ADMIN'))); }

export async function GET() {
  const session = await getServerSession(authOptions as any) as any;
  if (!manager(session)) return NextResponse.json({ error: 'Acesso administrativo necessário.' }, { status: 401 });
  const requests = await prisma.employeeRequest.findMany({ orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], take: 500, select: { id: true, type: true, status: true, startDate: true, endDate: true, reason: true, details: true, medicalSpecialty: true, classification: true, returnExpected: true, documentName: true, documentMime: true, reviewNote: true, reviewedAt: true, createdAt: true, employee: { select: { id: true, name: true, employeeNumber: true, jobTitle: true } }, reviewer: { select: { name: true } } } });
  return NextResponse.json({ requests });
}

export async function PATCH(request: Request) {
  const session = await getServerSession(authOptions as any) as any;
  if (!manager(session)) return NextResponse.json({ error: 'Acesso administrativo necessário.' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const parsed = z.object({ id: z.string().min(1), decision: z.enum(['APROVAR', 'REJEITAR']), reviewNote: z.string().trim().max(1000).optional().nullable() }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Decisão inválida.' }, { status: 400 });
  const existing = await prisma.employeeRequest.findUnique({ where: { id: parsed.data.id }, select: { id: true, employeeId: true, type: true, status: true, startDate: true, endDate: true } });
  if (!existing) return NextResponse.json({ error: 'Solicitação não encontrada.' }, { status: 404 });
  if (existing.status !== 'PENDENTE') return NextResponse.json({ error: 'Esta solicitação já foi decidida.' }, { status: 409 });
  const status = parsed.data.decision === 'APROVAR' ? 'APROVADO' : 'REJEITADO';
  const updated = await prisma.employeeRequest.update({ where: { id: existing.id }, data: { status, reviewerId: session.user.id, reviewedAt: new Date(), reviewNote: parsed.data.reviewNote?.trim() || null }, select: { id: true, status: true, reviewNote: true, reviewedAt: true } });
  await appendAuditEvent({ action: `SOLICITACAO_${status}`, actorId: session.user.id, resource: 'EmployeeRequest', resourceId: existing.id, metadata: { employeeId: existing.employeeId, type: existing.type, startDate: existing.startDate.toISOString().slice(0, 10), endDate: existing.endDate.toISOString().slice(0, 10), reviewNote: updated.reviewNote } });
  return NextResponse.json({ request: updated });
}
