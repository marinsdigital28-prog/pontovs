import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '../../../../lib/auth';
import prisma from '../../../../lib/prisma';
import { appendAuditEvent } from '../../../../lib/security-controls';

export const dynamic = 'force-dynamic';
function manager(session: any) {
  return Boolean(session?.user?.id && ['ADMIN', 'MANAGER'].includes(String(session?.user?.role || 'ADMIN')));
}

export async function GET() {
  const session = await getServerSession(authOptions as any) as any;
  if (!manager(session)) return NextResponse.json({ error: 'Acesso administrativo necessário.' }, { status: 401 });
  const requests = await prisma.employeeRequest.findMany({
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 500,
    select: {
      id: true, employeeId: true, type: true, status: true, startDate: true, endDate: true,
      reason: true, details: true, medicalSpecialty: true, classification: true, returnExpected: true,
      documentName: true, documentMime: true, reviewNote: true, reviewedAt: true, createdAt: true,
      employee: { select: { id: true, name: true, employeeNumber: true, jobTitle: true } },
      reviewer: { select: { name: true } },
    },
  });
  return NextResponse.json({ requests });
}

export async function PATCH(request: Request) {
  const session = await getServerSession(authOptions as any) as any;
  if (!manager(session)) return NextResponse.json({ error: 'Acesso administrativo necessário.' }, { status: 401 });
  const body = await request.json().catch(() => null);

  const reschedule = z.object({
    id: z.string().min(1),
    action: z.literal('RESCHEDULE'),
    startDate: z.string().min(8),
    endDate: z.string().min(8).optional(),
  }).safeParse(body);

  if (reschedule.success) {
    const existing = await prisma.employeeRequest.findUnique({
      where: { id: reschedule.data.id },
      select: { id: true, employeeId: true, type: true, status: true, startDate: true, endDate: true },
    });
    if (!existing) return NextResponse.json({ error: 'Solicitação não encontrada.' }, { status: 404 });
    if (!['AUSENCIA', 'PASSEIO', 'EVENTO_EXTERNO'].includes(existing.type)) {
      return NextResponse.json({ error: 'Só ausências podem ser reagendadas no calendário.' }, { status: 400 });
    }
    const start = new Date(`${reschedule.data.startDate.slice(0, 10)}T12:00:00.000Z`);
    const endRaw = (reschedule.data.endDate || reschedule.data.startDate).slice(0, 10);
    const end = new Date(`${endRaw}T12:00:00.000Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
      return NextResponse.json({ error: 'Período inválido.' }, { status: 400 });
    }
    const updated = await prisma.employeeRequest.update({
      where: { id: existing.id },
      data: { startDate: start, endDate: end },
      select: { id: true, startDate: true, endDate: true, status: true },
    });
    await appendAuditEvent({
      action: 'SOLICITACAO_REAGENDADA',
      actorId: session.user.id,
      resource: 'EmployeeRequest',
      resourceId: existing.id,
      metadata: {
        employeeId: existing.employeeId,
        from: existing.startDate.toISOString().slice(0, 10),
        to: start.toISOString().slice(0, 10),
        end: end.toISOString().slice(0, 10),
      },
    });
    return NextResponse.json({ request: updated });
  }

  const cancel = z.object({
    id: z.string().min(1),
    action: z.literal('CANCELAR'),
    reviewNote: z.string().trim().max(1000).optional().nullable(),
  }).safeParse(body);

  if (cancel.success) {
    const existing = await prisma.employeeRequest.findUnique({
      where: { id: cancel.data.id },
      select: { id: true, employeeId: true, type: true, status: true },
    });
    if (!existing) return NextResponse.json({ error: 'Solicitação não encontrada.' }, { status: 404 });
    if (existing.status === 'CANCELADO' || existing.status === 'REJEITADO') {
      return NextResponse.json({ error: 'Solicitação já está cancelada.' }, { status: 409 });
    }
    const updated = await prisma.employeeRequest.update({
      where: { id: existing.id },
      data: {
        status: existing.status === 'PENDENTE' ? 'REJEITADO' : 'CANCELADO',
        reviewerId: session.user.id,
        reviewedAt: new Date(),
        reviewNote: cancel.data.reviewNote?.trim() || 'Removido pelo calendário administrativo',
      },
      select: { id: true, status: true },
    });
    await appendAuditEvent({
      action: 'SOLICITACAO_CANCELADA',
      actorId: session.user.id,
      resource: 'EmployeeRequest',
      resourceId: existing.id,
      metadata: { employeeId: existing.employeeId, type: existing.type },
    });
    return NextResponse.json({ request: updated });
  }

  const parsed = z.object({
    id: z.string().min(1),
    decision: z.enum(['APROVAR', 'REJEITAR']),
    reviewNote: z.string().trim().max(1000).optional().nullable(),
  }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Decisão inválida.' }, { status: 400 });
  const existing = await prisma.employeeRequest.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, employeeId: true, type: true, status: true, startDate: true, endDate: true },
  });
  if (!existing) return NextResponse.json({ error: 'Solicitação não encontrada.' }, { status: 404 });
  if (existing.status !== 'PENDENTE') return NextResponse.json({ error: 'Esta solicitação já foi decidida.' }, { status: 409 });
  const status = parsed.data.decision === 'APROVAR' ? 'APROVADO' : 'REJEITADO';
  const updated = await prisma.employeeRequest.update({
    where: { id: existing.id },
    data: {
      status,
      reviewerId: session.user.id,
      reviewedAt: new Date(),
      reviewNote: parsed.data.reviewNote?.trim() || null,
    },
    select: { id: true, status: true, reviewNote: true, reviewedAt: true },
  });
  await appendAuditEvent({
    action: `SOLICITACAO_${status}`,
    actorId: session.user.id,
    resource: 'EmployeeRequest',
    resourceId: existing.id,
    metadata: {
      employeeId: existing.employeeId,
      type: existing.type,
      startDate: existing.startDate.toISOString().slice(0, 10),
      endDate: existing.endDate.toISOString().slice(0, 10),
      reviewNote: updated.reviewNote,
    },
  });
  return NextResponse.json({ request: updated });
}
