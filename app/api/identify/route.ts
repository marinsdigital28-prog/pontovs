import { NextResponse } from 'next/server';
import prisma from '../../../lib/prisma';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const employeeNumber = String(body?.employeeNumber ?? '').trim();

    if (!employeeNumber) {
      return NextResponse.json({ error: 'Matrícula obrigatória' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { employeeNumber },
      select: {
        id: true,
        name: true,
        employeeNumber: true,
        email: true,
        role: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    return NextResponse.json(user, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: 'Erro ao localizar usuário' }, { status: 500 });
  }
}
