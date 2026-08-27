import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { normalizeCpf, validateAdminEmployee } from '@/lib/employee-validation';
import { appendAuditEvent, consumeRateLimit, getRequestKey, rateLimitResponse } from '@/lib/security-controls';

export const dynamic = 'force-dynamic';

async function requireManager() {
  const session = (await getServerSession(authOptions as any)) as any;
  const id = session?.user?.id as string | undefined;
  if (!id) return null;
  return prisma.user.findFirst({ where: { id, active: true, role: { in: ['ADMIN', 'MANAGER'] } }, select: { id: true, name: true } });
}

function normalizeNumber(value: unknown) {
  const normalized = String(value ?? '').replace(/\D/g, '').trim();
  return normalized || null;
}

export async function GET(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 401 });
  const rate = await consumeRateLimit(getRequestKey(request, 'admin-employees-read', manager.id), 60, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);
  const employees = await prisma.user.findMany({
    where: { role: 'EMPLOYEE' },
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
    select: { id: true, name: true, employeeNumber: true, cpf: true, jobTitle: true, workDays: true, scheduleStart: true, scheduleEnd: true, scheduleByDay: true, active: true, createdAt: true, updatedAt: true, _count: { select: { punches: true } } },
  });
  return NextResponse.json({ employees });
}

export async function POST(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 401 });
  const rate = await consumeRateLimit(getRequestKey(request, 'admin-employees-write', manager.id), 20, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);
  const body = await request.json().catch(() => null);
  const name = String(body?.name ?? '').trim();
  const employeeNumber = normalizeNumber(body?.employeeNumber) || '';
  const validation = validateAdminEmployee({ name, employeeNumber, cpf: String(body?.cpf ?? ''), jobTitle: String(body?.jobTitle ?? ''), workDays: String(body?.workDays ?? ''), scheduleStart: String(body?.scheduleStart ?? ''), scheduleEnd: String(body?.scheduleEnd ?? '') });
  if (Object.keys(validation).length) return NextResponse.json({ error: Object.values(validation)[0] }, { status: 400 });
  try {
    const employee = await prisma.user.create({ data: { id: crypto.randomUUID(), name, employeeNumber, cpf: body?.cpf ? normalizeCpf(String(body.cpf)) : null, jobTitle: body?.jobTitle ? String(body.jobTitle).trim() : null, workDays: body?.workDays ? String(body.workDays).trim().toUpperCase() : null, scheduleStart: body?.scheduleStart ? String(body.scheduleStart) : null, scheduleEnd: body?.scheduleEnd ? String(body?.scheduleEnd) : null, scheduleByDay: body?.scheduleByDay ? JSON.stringify(body.scheduleByDay) : null, email: `employee-${employeeNumber}@local.invalid`, role: 'EMPLOYEE', active: body?.active !== false }, select: { id: true, name: true, employeeNumber: true, cpf: true, jobTitle: true, workDays: true, scheduleStart: true, scheduleEnd: true, scheduleByDay: true, active: true } });
    await appendAuditEvent({ action: 'EMPLOYEE_CREATED', actorId: manager.id, resource: 'User', resourceId: employee.id, metadata: { employeeNumber: employee.employeeNumber } });
    return NextResponse.json({ employee }, { status: 201 });
  } catch (error: any) {
    if (error?.code === 'P2002') return NextResponse.json({ error: 'A matrícula ou CPF já está cadastrado.' }, { status: 409 });
    return NextResponse.json({ error: 'Não foi possível cadastrar o colaborador.' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 401 });
  const rate = await consumeRateLimit(getRequestKey(request, 'admin-employees-write', manager.id), 20, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);
  const body = await request.json().catch(() => null);
  const id = String(body?.id ?? '').trim();
  if (!id) return NextResponse.json({ error: 'Colaborador inválido.' }, { status: 400 });
  const current = await prisma.user.findFirst({ where: { id, role: 'EMPLOYEE' }, select: { name: true, employeeNumber: true, cpf: true, jobTitle: true, workDays: true, scheduleStart: true, scheduleEnd: true, scheduleByDay: true } });
  if (!current) return NextResponse.json({ error: 'Colaborador inválido.' }, { status: 404 });
  const candidate = { name: body.name !== undefined ? String(body.name) : current.name, employeeNumber: body.employeeNumber !== undefined ? String(body.employeeNumber) : current.employeeNumber || '', cpf: body.cpf !== undefined ? String(body.cpf) : current.cpf || '', jobTitle: body.jobTitle !== undefined ? String(body.jobTitle) : current.jobTitle || '', workDays: body.workDays !== undefined ? String(body.workDays) : current.workDays || '', scheduleStart: body.scheduleStart !== undefined ? String(body.scheduleStart) : current.scheduleStart || '', scheduleEnd: body.scheduleEnd !== undefined ? String(body.scheduleEnd) : current.scheduleEnd || '' };
  const validation = validateAdminEmployee(candidate);
  if (Object.keys(validation).length) return NextResponse.json({ error: Object.values(validation)[0] }, { status: 400 });
  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = String(body.name).trim();
  if (body.employeeNumber !== undefined) data.employeeNumber = normalizeNumber(body.employeeNumber);
  for (const key of ['cpf', 'jobTitle', 'workDays', 'scheduleStart', 'scheduleEnd', 'scheduleByDay']) if (body[key] !== undefined) data[key] = body[key] ? (key === 'cpf' ? normalizeCpf(String(body[key])) : String(body[key]).trim()) : null;
  if (body.active !== undefined) data.active = Boolean(body.active);
  try {
    const employee = await prisma.user.update({ where: { id }, data, select: { id: true, name: true, employeeNumber: true, cpf: true, jobTitle: true, workDays: true, scheduleStart: true, scheduleEnd: true, scheduleByDay: true, active: true } });
    await appendAuditEvent({ action: 'EMPLOYEE_UPDATED', actorId: manager.id, resource: 'User', resourceId: employee.id, metadata: { fields: Object.keys(data) } });
    return NextResponse.json({ employee });
  } catch (error: any) {
    if (error?.code === 'P2002') return NextResponse.json({ error: 'A matrícula ou CPF já está cadastrado.' }, { status: 409 });
    return NextResponse.json({ error: 'Não foi possível atualizar o colaborador.' }, { status: 500 });
  }
}
