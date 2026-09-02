import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '../../../../lib/auth';
import prisma from '../../../../lib/prisma';
import { appendAuditEvent } from '../../../../lib/security-controls';

export const dynamic = 'force-dynamic';
const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
const requestSchema = z.object({
  type: z.enum(['AUSENCIA', 'TROCA_DIA', 'ESQUECI_PONTO']),
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
