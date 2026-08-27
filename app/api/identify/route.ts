import { NextResponse } from 'next/server';
import prisma from '../../../lib/prisma';
import { brazilDayRange } from '../../../lib/brazil-time';
import { resolveDaySchedule } from '../../../lib/day-schedule';

const ORDER = ['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA'] as const;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const employeeNumber = String(body?.employeeNumber ?? '').replace(/\D/g, '').padStart(4, '0');
    if (!employeeNumber) return NextResponse.json({ error: 'Matrícula obrigatória' }, { status: 400 });

    const { start, end } = brazilDayRange();
    const user = await prisma.user.findUnique({
      where: { employeeNumber },
      select: {
        id: true, name: true, employeeNumber: true, email: true, role: true,
        jobTitle: true, workDays: true, scheduleStart: true, scheduleEnd: true, scheduleByDay: true, active: true,
        punches: { where: { status: 'VALID', timestamp: { gte: start, lt: end } }, orderBy: { timestamp: 'desc' }, take: 1, select: { type: true, timestamp: true } },
      },
    });
    if (!user || !user.active || user.role !== 'EMPLOYEE') return NextResponse.json({ error: 'Colaborador não encontrado ou inativo' }, { status: 404 });

    const last = user.punches[0];
    const schedule = resolveDaySchedule(user.scheduleByDay, user.workDays, user.scheduleStart, user.scheduleEnd, new Date().getDay());
    const order = schedule?.mode === 'HALF' ? ['ENTRADA', 'SAIDA'] as const : ORDER;
    const index = last ? (order as readonly string[]).indexOf(last.type) : -1;
    const nextType = index >= 0 && index < order.length - 1 ? order[index + 1] : index === order.length - 1 ? null : 'ENTRADA';
    return NextResponse.json({ ...user, punches: undefined, lastPunch: last ?? null, nextType }, { status: 200 });
  } catch {
    return NextResponse.json({ error: 'Erro ao localizar usuário' }, { status: 500 });
  }
}
