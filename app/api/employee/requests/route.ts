import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '../../../../lib/auth';
import prisma from '../../../../lib/prisma';
import { appendAuditEvent } from '../../../../lib/security-controls';
import { CONFIRM_TYPE, parseConfirmDetails, resolveAutoKey } from '../../../../lib/forgotten-resolve';
import { createManualInclusion } from '../../../../lib/punch-correction';
import { parseManualTimestamp } from '../../../../lib/manual-punch';
import { brazilDateKey } from '../../../../lib/brazil-time';
import { isPeriodClosed } from '../../../../lib/period-closure';

export const dynamic = 'force-dynamic';
const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
const requestSchema = z.object({
  type: z.enum(['AUSENCIA', 'TROCA_DIA', 'ESQUECI_PONTO', 'AVISO_ATRASO']),
  startDate: z.string().regex(dateOnly),
  endDate: z.string().regex(dateOnly),
  reason: z.string().trim().min(3).max(500),
  details: z.string().trim().max(2000).optional().nullable(),
  medicalSpecialty: z.string().trim().max(120).optional().nullable(),
  classification: z.string().trim().max(80).optional().nullable(),
  returnExpected: z.boolean().optional().nullable(),
  documentName: z.string().trim().max(180).optional().nullable(),
  documentMime: z.enum(['application/pdf', 'image/jpeg', 'image/png']).optional().nullable(),
  documentData: z.string().max(5_000_000).optional().nullable(),
});
function day(value: string) { return new Date(`${value}T12:00:00.000Z`); }
function sessionRole(session: any) { return String(session?.user?.role || ''); }

export async function GET() {
  const session = await getServerSession(authOptions as any) as any;
  const employeeId = session?.user?.id as string | undefined;
  if (!employeeId || sessionRole(session) !== 'EMPLOYEE') return NextResponse.json({ error: 'Sessão de colaborador necessária.' }, { status: 401 });
  const requests = await prisma.employeeRequest.findMany({ where: { employeeId }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, type: true, status: true, startDate: true, endDate: true, reason: true, details: true, medicalSpecialty: true, classification: true, returnExpected: true, documentName: true, documentMime: true, reviewNote: true, reviewedAt: true, createdAt: true } });
  return NextResponse.json({ requests });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions as any) as any;
  const employeeId = session?.user?.id as string | undefined;
  if (!employeeId || sessionRole(session) !== 'EMPLOYEE') return NextResponse.json({ error: 'Sessão de colaborador necessária.' }, { status: 401 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Dados da solicitação inválidos.' }, { status: 400 });
  const input = parsed.data; const startDate = day(input.startDate); const endDate = day(input.endDate);
  if (endDate < startDate) return NextResponse.json({ error: 'A data final não pode ser anterior à inicial.' }, { status: 400 });
  const duplicate = await prisma.employeeRequest.findFirst({ where: { employeeId, type: input.type, status: 'PENDENTE', startDate, endDate }, select: { id: true } });
  if (duplicate) return NextResponse.json({ error: 'Já existe uma solicitação pendente para este período.' }, { status: 409 });
  const created = await prisma.employeeRequest.create({ data: { employeeId, type: input.type, startDate, endDate, reason: input.reason, details: input.details || null, medicalSpecialty: input.medicalSpecialty || null, classification: input.classification || null, returnExpected: input.returnExpected ?? null, documentName: input.documentName || null, documentMime: input.documentMime || null, documentData: input.documentData || null }, select: { id: true, type: true, status: true, startDate: true, endDate: true, createdAt: true } });
  await appendAuditEvent({ action: 'SOLICITACAO_CRIADA', actorId: employeeId, resource: 'EmployeeRequest', resourceId: created.id, metadata: { type: created.type, startDate: input.startDate, endDate: input.endDate, classification: input.classification || null, hasDocument: Boolean(input.documentData) } });
  return NextResponse.json({ request: created }, { status: 201 });
}

export async function PATCH(request: Request) {
  const session = await getServerSession(authOptions as any) as any;
  const employeeId = session?.user?.id as string | undefined;
  if (!employeeId || sessionRole(session) !== 'EMPLOYEE') {
    return NextResponse.json({ error: 'Sessão de colaborador necessária.' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (body && (body.action === 'CONFIRMAR' || body.action === 'CORRIGIR')) return confirmHorario(employeeId, body);
  const parsed = z.object({
    id: z.string().min(1),
    action: z.literal('CANCELAR'),
  }).safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
  }

  const existing = await prisma.employeeRequest.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, employeeId: true, type: true, status: true, reason: true },
  });

  if (!existing) {
    return NextResponse.json({ error: 'Solicitação não encontrada.' }, { status: 404 });
  }
  if (existing.employeeId !== employeeId) {
    return NextResponse.json({ error: 'Solicitação não pertence a este colaborador.' }, { status: 403 });
  }
  if (existing.status === 'CANCELADO' || existing.status === 'REJEITADO') {
    return NextResponse.json({ error: 'Solicitação já está desmarcada ou rejeitada.' }, { status: 409 });
  }
  if (existing.status !== 'PENDENTE' && existing.status !== 'APROVADO') {
    return NextResponse.json({ error: 'Só é possível desmarcar solicitações pendentes ou aprovadas.' }, { status: 409 });
  }

  const updated = await prisma.employeeRequest.update({
    where: { id: existing.id },
    data: {
      status: existing.status === 'PENDENTE' ? 'REJEITADO' : 'CANCELADO',
      reviewedAt: new Date(),
      reviewNote: existing.status === 'PENDENTE'
        ? 'Desmarcado pelo colaborador antes da análise'
        : 'Desmarcado pelo colaborador',
    },
    select: { id: true, status: true },
  });

  await appendAuditEvent({
    action: 'SOLICITACAO_CANCELADA',
    actorId: employeeId,
    resource: 'EmployeeRequest',
    resourceId: existing.id,
    metadata: { type: existing.type, by: 'employee', previousStatus: existing.status },
  });

  return NextResponse.json({ request: updated });
}

const confirmSchema = z.object({
  id: z.string().min(1),
  action: z.enum(['CONFIRMAR', 'CORRIGIR']),
  punches: z.array(z.object({ type: z.enum(['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA']), time: z.string().regex(/^\d{2}:\d{2}$/) })).max(4).optional(),
  note: z.string().trim().max(500).optional().nullable(),
});

/** Colaborador confirma (cria as batidas) ou corrige (volta para o gestor) um pedido CONFIRMAR_HORARIO. */
async function confirmHorario(employeeId: string, body: unknown) {
  const parsed = confirmSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
  const existing = await prisma.employeeRequest.findUnique({ where: { id: parsed.data.id }, select: { id: true, employeeId: true, type: true, status: true, startDate: true, details: true, reason: true, reviewerId: true } });
  if (!existing || existing.type !== CONFIRM_TYPE) return NextResponse.json({ error: 'Solicitação não encontrada.' }, { status: 404 });
  if (existing.employeeId !== employeeId) return NextResponse.json({ error: 'Solicitação não pertence a este colaborador.' }, { status: 403 });
  if (existing.status !== 'PENDENTE') return NextResponse.json({ error: 'Esta confirmação já foi respondida.' }, { status: 409 });
  const details = parseConfirmDetails(existing.details);
  if (!details) return NextResponse.json({ error: 'Pedido sem horários.' }, { status: 400 });
  const date = brazilDateKey(existing.startDate);

  if (parsed.data.action === 'CORRIGIR') {
    const correction = parsed.data.punches?.length ? parsed.data.punches : null;
    if (!correction && !parsed.data.note) return NextResponse.json({ error: 'Informe o horário correto ou uma observação.' }, { status: 400 });
    const updated = await prisma.employeeRequest.update({ where: { id: existing.id }, data: { status: 'CONTESTADO', details: JSON.stringify({ ...details, correction, correctionNote: parsed.data.note || null }), reviewNote: 'Colaborador corrigiu o horário; aguardando o gestor' }, select: { id: true, status: true } });
    await appendAuditEvent({ action: 'CONFIRMACAO_HORARIO_CORRIGIDA', actorId: employeeId, resource: 'EmployeeRequest', resourceId: existing.id, metadata: { date, proposed: details.punches, correction, note: parsed.data.note || null } });
    return NextResponse.json({ request: updated });
  }

  if (await isPeriodClosed(date.slice(0, 7))) return NextResponse.json({ error: 'O período já foi fechado. Fale com a administração.' }, { status: 409 });
  const managerId = existing.reviewerId || employeeId;
  const reason = `Confirmado pelo colaborador no app. Motivo do gestor: ${existing.reason}`;
  const user = await prisma.user.findUnique({ where: { id: employeeId }, select: { unitId: true } });
  const created = await prisma.$transaction(async (tx) => {
    const ids: string[] = [];
    for (const p of details.punches) {
      const punch = await createManualInclusion(tx, { userId: employeeId, unitId: user?.unitId ?? null, type: p.type, timestamp: parseManualTimestamp(date, p.time)!, managerId, reason, source: 'confirmado_colaborador' });
      if (punch) ids.push(punch.id);
    }
    if (details.issueKey) await resolveAutoKey(tx, details.issueKey, reason, managerId);
    const requestIds = Array.isArray((details as any).requestIds) ? (details as any).requestIds : [];
    if (requestIds.length) await tx.employeeRequest.updateMany({ where: { id: { in: requestIds }, employeeId, status: 'PENDENTE' }, data: { status: 'APROVADO', reviewerId: managerId, reviewedAt: new Date(), reviewNote: 'Confirmado pelo colaborador' } });
    await tx.employeeRequest.update({ where: { id: existing.id }, data: { status: 'APROVADO', reviewedAt: new Date(), reviewNote: 'Confirmado pelo colaborador' } });
    return ids;
  });
  await appendAuditEvent({ action: 'CONFIRMACAO_HORARIO_CONFIRMADA', actorId: employeeId, resource: 'EmployeeRequest', resourceId: existing.id, metadata: { date, punches: details.punches, createdPunchIds: created, managerId } });
  return NextResponse.json({ request: { id: existing.id, status: 'APROVADO' }, created: created.length });
}
