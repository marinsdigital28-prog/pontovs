import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '../../../../lib/auth';
import prisma from '../../../../lib/prisma';
import { appendAuditEvent } from '../../../../lib/security-controls';
import { manualClientId, manualPunchTypes, parseManualTimestamp } from '../../../../lib/manual-punch';
import { isPeriodClosed, periodFromDate } from '../../../../lib/period-closure';

export const dynamic = 'force-dynamic';
function manager(session: any) {
  return Boolean(session?.user?.id && ['ADMIN', 'MANAGER'].includes(String(session?.user?.role || 'ADMIN')));
}

/** Extrai horário HH:MM do campo details do aviso de ponto esquecido. */
function extractForgotTime(details: string | null | undefined): string | null {
  if (!details) return null;
  const m =
    details.match(/Horário aproximado:\s*(\d{1,2}:\d{2})/i) ||
    details.match(/(?:às|as)\s*(\d{1,2}:\d{2})/i) ||
    details.match(/\b(\d{1,2}:\d{2})\b/);
  if (!m) return null;
  const [h, min] = m[1].split(':').map(Number);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
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
    select: {
      id: true,
      employeeId: true,
      type: true,
      status: true,
      startDate: true,
      endDate: true,
      classification: true,
      details: true,
      reason: true,
    },
  });
  if (!existing) return NextResponse.json({ error: 'Solicitação não encontrada.' }, { status: 404 });
  if (existing.status !== 'PENDENTE') return NextResponse.json({ error: 'Esta solicitação já foi decidida.' }, { status: 409 });
  const status = parsed.data.decision === 'APROVAR' ? 'APROVADO' : 'REJEITADO';

  let punchCreated: { id: string; type: string; timestamp: string } | null = null;
  let punchNote: string | null = null;

  // Ao aprovar "Esqueci de marcar", gera automaticamente a batida com o horário e tipo informados.
  if (status === 'APROVADO' && existing.type === 'ESQUECI_PONTO') {
    const punchType = String(existing.classification || '').trim().toUpperCase();
    const dateKey = existing.startDate.toISOString().slice(0, 10);
    const timeKey = extractForgotTime(existing.details);

    if (!manualPunchTypes.includes(punchType as (typeof manualPunchTypes)[number])) {
      punchNote = 'Aprovado, mas tipo de batida inválido — marque manualmente no painel de pontos.';
    } else if (!timeKey) {
      punchNote = 'Aprovado, mas horário não encontrado nos detalhes — marque manualmente no painel de pontos.';
    } else {
      const timestamp = parseManualTimestamp(dateKey, timeKey);
      if (!timestamp) {
        punchNote = 'Aprovado, mas data/horário inválidos — marque manualmente.';
      } else if (await isPeriodClosed(periodFromDate(timestamp))) {
        punchNote = 'Aprovado, porém a competência está fechada. Reabra o período para lançar a batida.';
      } else {
        const employee = await prisma.user.findFirst({
          where: { id: existing.employeeId, role: 'EMPLOYEE' },
          select: { id: true, unitId: true, name: true, employeeNumber: true },
        });
        if (!employee) {
          punchNote = 'Aprovado, mas colaborador não encontrado para gerar a batida.';
        } else {
          const clientId = manualClientId(employee.id, dateKey, timeKey, punchType);
          try {
            const result = await prisma.$transaction(async (tx) => {
              const already = await tx.punch.findUnique({ where: { clientId }, select: { id: true, type: true, timestamp: true } });
              if (already) {
                return { duplicate: true as const, punch: already };
              }
              const punch = await tx.punch.create({
                data: {
                  id: crypto.randomUUID(),
                  userId: employee.id,
                  unitId: employee.unitId,
                  type: punchType,
                  timestamp,
                  clientTimestamp: timestamp,
                  status: 'VALID',
                  origin: 'ADJUSTED',
                  locationValid: false,
                  clientId,
                },
                select: { id: true, type: true, timestamp: true },
              });
              await tx.punchAudit.create({
                data: {
                  id: crypto.randomUUID(),
                  punchId: punch.id,
                  changedById: session.user.id,
                  field: 'forgot_approve',
                  oldValue: null,
                  newValue: `${punchType} ${timestamp.toISOString()}`,
                  reason: `Aprovação de ESQUECI_PONTO: ${existing.reason || 'ponto esquecido'}`,
                },
              });
              return { duplicate: false as const, punch };
            });

            punchCreated = {
              id: result.punch.id,
              type: result.punch.type,
              timestamp: result.punch.timestamp.toISOString(),
            };
            punchNote = result.duplicate
              ? `Batida já existia (${punchType} ${timeKey}). Solicitação aprovada.`
              : `Batida gerada automaticamente: ${punchType} às ${timeKey}.`;

            await appendAuditEvent({
              action: result.duplicate ? 'PUNCH_ALREADY_EXISTS_FROM_FORGOT' : 'PUNCH_CREATED_FROM_FORGOT',
              actorId: session.user.id,
              resource: 'Punch',
              resourceId: result.punch.id,
              metadata: {
                requestId: existing.id,
                employeeId: employee.id,
                employeeNumber: employee.employeeNumber,
                type: punchType,
                date: dateKey,
                time: timeKey,
                reason: existing.reason,
              },
            });
          } catch {
            punchNote = 'Aprovado, mas falhou ao criar a batida automaticamente. Lance manualmente.';
          }
        }
      }
    }
  }

  const finalReviewNote = [
    parsed.data.reviewNote?.trim() || null,
    punchNote,
  ]
    .filter(Boolean)
    .join(' · ') || null;

  const updated = await prisma.employeeRequest.update({
    where: { id: existing.id },
    data: {
      status,
      reviewerId: session.user.id,
      reviewedAt: new Date(),
      reviewNote: finalReviewNote,
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
      punchCreated: punchCreated || undefined,
    },
  });

  return NextResponse.json({
    request: updated,
    punch: punchCreated,
    message: punchNote || (status === 'APROVADO' ? 'Solicitação aprovada.' : 'Solicitação rejeitada.'),
  });
}
