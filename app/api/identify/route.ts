import { NextResponse } from 'next/server';
import prisma from '../../../lib/prisma';
import { brazilDayRange } from '../../../lib/brazil-time';

const ORDER = ['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA'] as const;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const employeeNumber = String(body?.employeeNumber ?? '').trim();
    if (!employeeNumber) return NextResponse.json({ error: 'Matrícula obrigatória' }, { status: 400 });

    const { start, end } = brazilDayRange();
    const user = await prisma.user.findUnique({
      where: { employeeNumber },
      select: {
        id: true, name: true, employeeNumber: true, email: true, role: true,
        jobTitle: true, workDays: true, scheduleStart: true, scheduleEnd: true, active: true,
        punches: { where: { status: 'VALID', timestamp: { gte: start, lt: end } }, orderBy: { timestamp: 'desc' }, take: 1, select: { type: true, timestamp: true } },
      },
    });
    if (!user || !user.active || user.role !== 'EMPLOYEE') return NextResponse.json({ error: 'Colaborador não encontrado ou inativo' }, { status: 404 });

    const last = user.punches[0];
    const index = last ? ORDER.indexOf(last.type as (typeof ORDER)[number]) : -1;
    const nextType = index >= 0 && index < ORDER.length - 1 ? ORDER[index + 1] : index === ORDER.length - 1 ? null : 'ENTRADA';
    return NextResponse.json({ ...user, punches: undefined, lastPunch: last ?? null, nextType }, { status: 200 });
  } catch {
    return NextResponse.json({ error: 'Erro ao localizar usuário' }, { status: 500 });
  }
}
