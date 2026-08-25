import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

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

export async function GET() {
  if (!(await requireManager())) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 401 });
  const employees = await prisma.user.findMany({
    where: { role: 'EMPLOYEE' },
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
    select: { id: true, name: true, employeeNumber: true, cpf: true, jobTitle: true, workDays: true, scheduleStart: true, scheduleEnd: true, active: true, createdAt: true, updatedAt: true, _count: { select: { punches: true } } },
  });
  return NextResponse.json({ employees });
}

export async function POST(request: Request) {
  if (!(await requireManager())) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const name = String(body?.name ?? '').trim();
  const employeeNumber = normalizeNumber(body?.employeeNumber);
  if (!name || !employeeNumber) return NextResponse.json({ error: 'Nome e matrícula são obrigatórios.' }, { status: 400 });
  try {
    const employee = await prisma.user.create({ data: { id: crypto.randomUUID(), name, employeeNumber, cpf: body?.cpf ? String(body.cpf).trim() : null, jobTitle: body?.jobTitle ? String(body.jobTitle).trim() : null, workDays: body?.workDays ? String(body.workDays) : null, scheduleStart: body?.scheduleStart ? String(body.scheduleStart) : null, scheduleEnd: body?.scheduleEnd ? String(body.scheduleEnd) : null, email: `employee-${employeeNumber}@local.invalid`, role: 'EMPLOYEE', active: body?.active !== false }, select: { id: true, name: true, employeeNumber: true, cpf: true, jobTitle: true, workDays: true, scheduleStart: true, scheduleEnd: true, active: true } });
    return NextResponse.json({ employee }, { status: 201 });
  } catch (error: any) {
    if (error?.code === 'P2002') return NextResponse.json({ error: 'A matrícula ou CPF já está cadastrado.' }, { status: 409 });
    return NextResponse.json({ error: 'Não foi possível cadastrar o colaborador.' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  if (!(await requireManager())) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const id = String(body?.id ?? '').trim();
  if (!id) return NextResponse.json({ error: 'Colaborador inválido.' }, { status: 400 });
  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = String(body.name).trim();
  if (body.employeeNumber !== undefined) data.employeeNumber = normalizeNumber(body.employeeNumber);
  for (const key of ['cpf', 'jobTitle', 'workDays', 'scheduleStart', 'scheduleEnd']) if (body[key] !== undefined) data[key] = body[key] ? String(body[key]).trim() : null;
  if (body.active !== undefined) data.active = Boolean(body.active);
  try {
    const employee = await prisma.user.update({ where: { id }, data, select: { id: true, name: true, employeeNumber: true, cpf: true, jobTitle: true, workDays: true, scheduleStart: true, scheduleEnd: true, active: true } });
    return NextResponse.json({ employee });
  } catch (error: any) {
    if (error?.code === 'P2002') return NextResponse.json({ error: 'A matrícula ou CPF já está cadastrado.' }, { status: 409 });
    return NextResponse.json({ error: 'Não foi possível atualizar o colaborador.' }, { status: 500 });
  }
}
