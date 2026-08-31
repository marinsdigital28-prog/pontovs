import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '../../../../lib/auth';
import prisma from '../../../../lib/prisma';
import { appendAuditEvent } from '../../../../lib/security-controls';

export const dynamic = 'force-dynamic';

const allowedMimes = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
const certificateTypes = [
  'DIA_INTEGRAL',
  'PERIODO_DIAS',
  'HORAS',
  'PERIODO_HORAS',
  'CONSULTA_MEDICA',
  'SAIDA_MEDICA',
  'TRABALHO_EXTERNO',
  'TRABALHO_EXTERNO_HORAS',
  'OUTRO',
] as const;

const hourlyTypes = new Set(['HORAS', 'PERIODO_HORAS', 'TRABALHO_EXTERNO_HORAS']);

const bodySchema = z.object({
  userId: z.string().min(1),
  type: z.enum(certificateTypes).default('DIA_INTEGRAL'),
  startDate: z.string().regex(dateOnly),
  endDate: z.string().regex(dateOnly).optional().nullable(),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().nullable(),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().nullable(),
  observation: z.string().max(2000).optional().nullable(),
  documentName: z.string().max(180).optional().nullable(),
  documentMime: z.string().optional().nullable(),
  documentData: z.string().max(14_000_000).optional().nullable(),
});

function day(date: string) { return new Date(`${date}T12:00:00.000Z`); }
function inclusiveDays(start: Date, end: Date) { return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1; }
function minutesBetween(start?: string | null, end?: string | null) {
  if (!start && !end) return null;
  if (!start || !end) return -1;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}
type ManagerSession = { user: { id: string; role?: string | null } };
function isManager(session: { user?: { role?: string | null } } | null) {
  return ['ADMIN', 'MANAGER'].includes(String(session?.user?.role || 'ADMIN'));
}

async function actor(): Promise<ManagerSession | null> {
  const session = await getServerSession(authOptions) as { user?: { id?: string; role?: string | null } } | null;
  if (!session?.user?.id || !isManager(session)) return null;
  return { user: { id: session.user.id, role: session.user.role } };
}

export async function GET() {
  const session = await actor();
  if (!session) return NextResponse.json({ error: 'Acesso administrativo necessário.' }, { status: 401 });
  const certificates = await prisma.medicalCertificate.findMany({
    orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }], take: 500,
    select: {
      id: true, userId: true, type: true, startDate: true, endDate: true, startTime: true, endTime: true,
      hoursPerDayMinutes: true, daysCount: true, workDaysCount: true, documentName: true, documentMime: true,
      observation: true, status: true, canceledAt: true, cancelReason: true, createdAt: true,
      user: { select: { name: true, employeeNumber: true, cpf: true } },
    },
  });
  return NextResponse.json({ certificates });
}

export async function POST(request: Request) {
  const session = await actor();
  if (!session) return NextResponse.json({ error: 'Acesso administrativo necessário.' }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Dados do atestado inválidos.', details: parsed.error.flatten() }, { status: 400 });
  const input = parsed.data;
  const hourly = hourlyTypes.has(input.type);
  if (hourly && !input.startTime) return NextResponse.json({ error: 'Informe a hora inicial do abono por horas.' }, { status: 400 });
  if (hourly && !input.endTime) return NextResponse.json({ error: 'Informe a hora final do abono por horas.' }, { status: 400 });
  if (!hourly && !input.endDate) return NextResponse.json({ error: 'Informe a data final do abono por dias.' }, { status: 400 });
  const startDate = day(input.startDate);
  const endDate = day(hourly ? input.startDate : input.endDate!);
  if (endDate < startDate) return NextResponse.json({ error: 'A data final não pode ser anterior à data inicial.' }, { status: 400 });
  const hoursPerDayMinutes = hourly ? minutesBetween(input.startTime, input.endTime) : null;
  if (hoursPerDayMinutes === -1 || (hourly && hoursPerDayMinutes === null)) {
    return NextResponse.json({ error: 'Informe a hora inicial e a hora final.' }, { status: 400 });
  }
  if (hoursPerDayMinutes !== null && (hoursPerDayMinutes < 1 || hoursPerDayMinutes > 1_440)) {
    return NextResponse.json({ error: 'O horário final deve ser posterior ao horário inicial.' }, { status: 400 });
  }
  if (input.documentData && (!input.documentMime || !allowedMimes.has(input.documentMime))) {
    return NextResponse.json({ error: 'Documento deve ser PDF, JPG, JPEG ou PNG.' }, { status: 400 });
  }
  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, name: true, workDays: true } });
  if (!user) return NextResponse.json({ error: 'Colaborador não encontrado.' }, { status: 404 });

  const candidates = await prisma.medicalCertificate.findMany({
    where: {
      userId: input.userId,
      status: { not: 'CANCELADO' },
      startDate: { lte: endDate },
      endDate: { gte: startDate },
    },
    select: { id: true, type: true, startDate: true, endDate: true, startTime: true, endTime: true },
  });
  const startMinutes = minutesBetween(input.startTime, input.endTime) === null
    ? null
    : Number(input.startTime!.slice(0, 2)) * 60 + Number(input.startTime!.slice(3));
  const endMinutes = minutesBetween(input.startTime, input.endTime) === null
    ? null
    : Number(input.endTime!.slice(0, 2)) * 60 + Number(input.endTime!.slice(3));
  const overlap = candidates.find((item) => {
    const existingHourly = hourlyTypes.has(item.type as typeof certificateTypes[number]) && item.startTime && item.endTime;
    if (hourly && existingHourly && item.startDate.getTime() === startDate.getTime()) {
      const existingStart = Number(item.startTime!.slice(0, 2)) * 60 + Number(item.startTime!.slice(3));
      const existingEnd = Number(item.endTime!.slice(0, 2)) * 60 + Number(item.endTime!.slice(3));
      return startMinutes! < existingEnd && endMinutes! > existingStart;
    }
    if (hourly && !existingHourly) return true;
    if (!hourly && existingHourly) return true;
    return !hourly || !existingHourly;
  });
  if (overlap) {
    return NextResponse.json({
      error: hourly
        ? 'Existe sobreposição com outro lançamento neste horário.'
        : 'Já existe um abono/atestado cadastrado para parte deste período.',
    }, { status: 409 });
  }

  const created = await prisma.medicalCertificate.create({
    data: {
      userId: input.userId,
      createdById: session.user.id,
      type: input.type,
      startDate,
      endDate,
      startTime: hourly ? input.startTime : null,
      endTime: hourly ? input.endTime : null,
      hoursPerDayMinutes: hourly ? hoursPerDayMinutes : null,
      daysCount: hourly ? 0 : inclusiveDays(startDate, endDate),
      documentName: input.documentName || null,
      documentMime: input.documentMime || null,
      documentData: input.documentData || null,
      observation: input.observation || null,
      status: 'PENDENTE',
    },
    select: {
      id: true, type: true, startDate: true, endDate: true, startTime: true, endTime: true,
      hoursPerDayMinutes: true, status: true, daysCount: true,
    },
  });
  await appendAuditEvent({
    action: 'ATESTADO_CRIADO',
    actorId: session.user.id,
    resource: 'MedicalCertificate',
    resourceId: created.id,
    metadata: {
      userId: input.userId,
      type: input.type,
      startDate: input.startDate,
      endDate: input.endDate,
      startTime: input.startTime || null,
      endTime: input.endTime || null,
      hoursPerDayMinutes,
      daysCount: created.daysCount,
      status: 'PENDENTE',
    },
  });
  return NextResponse.json({ certificate: created }, { status: 201 });
}

export async function PATCH(request: Request) {
  const session = await actor();
  if (!session) return NextResponse.json({ error: 'Acesso administrativo necessário.' }, { status: 401 });
  const body = await request.json().catch(() => null) as { id?: string; action?: string; reason?: string; observation?: string } | null;
  if (!body?.id) return NextResponse.json({ error: 'Atestado obrigatório.' }, { status: 400 });
  const existing = await prisma.medicalCertificate.findUnique({
    where: { id: body.id },
    select: { id: true, userId: true, status: true, startDate: true, endDate: true },
  });
  if (!existing) return NextResponse.json({ error: 'Atestado não encontrado.' }, { status: 404 });
  if (body.action === 'approve' || body.action === 'reject') {
    if (!['PENDENTE', 'ATIVO'].includes(existing.status)) {
      return NextResponse.json({ error: 'Somente atestados pendentes podem ser revisados.' }, { status: 409 });
    }
    const nextStatus = body.action === 'approve' ? 'APROVADO' : 'REJEITADO';
    const updated = await prisma.medicalCertificate.update({
      where: { id: body.id },
      data: { status: nextStatus },
      select: { id: true, status: true },
    });
    await appendAuditEvent({
      action: body.action === 'approve' ? 'ATESTADO_APROVADO' : 'ATESTADO_REJEITADO',
      actorId: session.user.id,
      resource: 'MedicalCertificate',
      resourceId: existing.id,
      metadata: { userId: existing.userId, reason: body.reason?.trim() || null },
    });
    return NextResponse.json({ certificate: updated });
  }
  if (body.action === 'cancel') {
    if (existing.status === 'CANCELADO') return NextResponse.json({ error: 'Atestado já cancelado.' }, { status: 409 });
    const updated = await prisma.medicalCertificate.update({
      where: { id: body.id },
      data: {
        status: 'CANCELADO',
        canceledAt: new Date(),
        canceledById: session.user.id,
        cancelReason: body.reason?.trim() || 'Cancelamento administrativo',
      },
      select: { id: true, status: true, canceledAt: true, cancelReason: true },
    });
    await appendAuditEvent({
      action: 'ATESTADO_CANCELADO',
      actorId: session.user.id,
      resource: 'MedicalCertificate',
      resourceId: existing.id,
      metadata: { userId: existing.userId, reason: updated.cancelReason },
    });
    return NextResponse.json({ certificate: updated });
  }
  const updated = await prisma.medicalCertificate.update({
    where: { id: body.id },
    data: { observation: body.observation?.trim() || null },
    select: { id: true, observation: true, status: true },
  });
  await appendAuditEvent({
    action: 'ATESTADO_ALTERADO',
    actorId: session.user.id,
    resource: 'MedicalCertificate',
    resourceId: existing.id,
    metadata: { userId: existing.userId, observationChanged: true },
  });
  return NextResponse.json({ certificate: updated });
}
