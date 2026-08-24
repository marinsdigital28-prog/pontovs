import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '../../../lib/prisma';

const PunchSchema = z.object({
  type: z.enum(['ENTRADA', 'SAIDA', 'INTERVALO', 'RETORNO']),
  employeeNumber: z.string().optional(),
  timestamp: z.string().refine((s) => !Number.isNaN(Date.parse(s)), { message: 'Invalid date' }),
  clientTimestamp: z.string().optional(),
  clientId: z.string().optional(),
  photo: z.string().nullable().optional(),
  location: z
    .object({ lat: z.number(), lng: z.number(), accuracy: z.number().optional() })
    .nullable()
});

export async function POST(req: Request) {
  try {
    const session = (await getServerSession(authOptions as any)) as any;
    const body = await req.json();
    const parsed = PunchSchema.parse(body);

    let user = null;
    if (parsed.employeeNumber) {
      user = await prisma.user.findUnique({ where: { employeeNumber: parsed.employeeNumber } });
    }

    if (!user && session?.user) {
      user = await prisma.user.findUnique({ where: { id: (session.user as any).id } });
    }

    if (!user) {
      return NextResponse.json({ error: 'Usuário não identificado' }, { status: 401 });
    }

    const userId = user.id;
    const ts = new Date(parsed.timestamp);
    const startOfDay = new Date(ts);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    const lastToday = await prisma.punch.findFirst({
      where: { userId, timestamp: { gte: startOfDay, lt: endOfDay } },
      orderBy: { timestamp: 'desc' },
    });

    const finalType = parsed.type || (lastToday ? (lastToday.type === 'ENTRADA' ? 'SAIDA' : 'ENTRADA') : 'ENTRADA');

    const created = await prisma.punch.create({
      data: {
        userId,
        unitId: user.unitId || null,
        type: finalType,
        timestamp: ts,
        clientTimestamp: parsed.clientTimestamp ? new Date(parsed.clientTimestamp) : null,
        latitude: parsed.location?.lat ?? null,
        longitude: parsed.location?.lng ?? null,
        accuracy: parsed.location?.accuracy ?? null,
        locationValid: parsed.location ? true : false,
        origin: 'WEB',
        clientId: parsed.clientId ?? null,
      },
    });

    try {
      await prisma.punchAudit.create({
        data: {
          punchId: created.id,
          changedById: userId,
          field: 'created',
          oldValue: null,
          newValue: JSON.stringify({
            type: created.type,
            timestamp: created.timestamp,
            clientId: created.clientId,
            origin: created.origin,
            photo: parsed.photo ? 'captured' : null,
          }),
          reason: 'Registro inicial via app',
        },
      });
    } catch (auditErr) {
      console.error('Failed to create punch audit', auditErr);
    }

    return NextResponse.json({ ...created, userName: user.name, employeeNumber: user.employeeNumber }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Invalid' }, { status: 400 });
  }
}
