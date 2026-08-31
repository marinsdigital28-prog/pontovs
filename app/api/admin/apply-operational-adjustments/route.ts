import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { appendAuditEvent, consumeRateLimit, getRequestKey, rateLimitResponse } from '@/lib/security-controls';
import {
  DATA_MESA_BRASIL_ANA,
  DATA_VENDAVAL,
  HORA_SAIDA_VENDAVAL,
  MAT_ANA_MARIA,
  MAT_KAIO,
  lastFridayOfMonth,
} from '@/lib/operational-abonos';

export const dynamic = 'force-dynamic';

async function requireManager() {
  const session = (await getServerSession(authOptions as any)) as any;
  const id = session?.user?.id as string | undefined;
  if (!id) return null;
  return prisma.user.findFirst({
    where: { id, active: true, role: { in: ['ADMIN', 'MANAGER'] } },
    select: { id: true },
  });
}

function dayBounds(dateKey: string) {
  const start = new Date(`${dateKey}T00:00:00-03:00`);
  const end = new Date(`${dateKey}T23:59:59.999-03:00`);
  return { start, end };
}

function dayMid(dateKey: string) {
  return new Date(`${dateKey}T12:00:00.000Z`);
}

/**
 * Aplica ajustes pontuais:
 * 1) Ana Maria 25/08 — cancela marcações do dia + atestado dia integral (trabalho externo)
 * 2) 07/08 vendaval — ajusta SAÍDA para 15:00 quando houver marcação no dia
 * 3) Kaio — lança atestado na última sexta do mês (ago/2026 e mês corrente)
 *
 * NÃO altera matrícula, workDays nem horários cadastrados.
 */
export async function POST(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 401 });
  const rate = await consumeRateLimit(getRequestKey(request, 'admin-ops-adjust', manager.id), 5, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);

  const summary = {
    anaMariaPunchesCancelled: 0,
    anaMariaCertificate: false,
    vendavalSaidasAdjusted: 0,
    kaioCertificates: 0,
  };

  const ana = await prisma.user.findFirst({
    where: { employeeNumber: MAT_ANA_MARIA, role: 'EMPLOYEE' },
    select: { id: true, name: true },
  });
  if (ana) {
    const { start, end } = dayBounds(DATA_MESA_BRASIL_ANA);
    const punches = await prisma.punch.findMany({
      where: { userId: ana.id, status: 'VALID', timestamp: { gte: start, lte: end } },
      select: { id: true, type: true, status: true, timestamp: true },
    });
    for (const punch of punches) {
      await prisma.$transaction(async (tx) => {
        await tx.punch.update({
          where: { id: punch.id },
          data: { status: 'REJECTED', origin: 'ADJUSTED' },
        });
        await tx.punchAudit.create({
          data: {
            id: crypto.randomUUID(),
            punchId: punch.id,
            changedById: manager.id,
            field: 'status',
            oldValue: punch.status,
            newValue: 'REJECTED',
            reason: 'Trabalho externo Mesa Brasil — dia abonado sem registro de ponto',
          },
        });
      });
      summary.anaMariaPunchesCancelled += 1;
    }

    const existingCert = await prisma.medicalCertificate.findFirst({
      where: {
        userId: ana.id,
        status: { not: 'CANCELADO' },
        startDate: { lte: dayMid(DATA_MESA_BRASIL_ANA) },
        endDate: { gte: dayMid(DATA_MESA_BRASIL_ANA) },
        observation: { contains: 'Mesa Brasil' },
      },
    });
    if (!existingCert) {
      await prisma.medicalCertificate.create({
        data: {
          userId: ana.id,
          createdById: manager.id,
          type: 'OUTRO',
          startDate: dayMid(DATA_MESA_BRASIL_ANA),
          endDate: dayMid(DATA_MESA_BRASIL_ANA),
          daysCount: 1,
          observation: 'Trabalho externo — reunião Mesa Brasil (dia abonado)',
          status: 'APROVADO',
        },
      });
      summary.anaMariaCertificate = true;
    }
  }

  const { start: vStart, end: vEnd } = dayBounds(DATA_VENDAVAL);
  const [hh, mm] = HORA_SAIDA_VENDAVAL.split(':').map(Number);
  const targetSaida = new Date(`${DATA_VENDAVAL}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00-03:00`);

  const dayPunches = await prisma.punch.findMany({
    where: { status: 'VALID', timestamp: { gte: vStart, lte: vEnd } },
    select: { id: true, userId: true, type: true, timestamp: true, status: true },
    orderBy: { timestamp: 'asc' },
  });
  const byUser = new Map<string, typeof dayPunches>();
  for (const p of dayPunches) {
    const list = byUser.get(p.userId) || [];
    list.push(p);
    byUser.set(p.userId, list);
  }
  for (const [, list] of byUser) {
    const saidas = list.filter((p) => p.type === 'SAIDA');
    if (saidas.length) {
      const last = saidas[saidas.length - 1];
      if (last.timestamp.getTime() !== targetSaida.getTime()) {
        await prisma.$transaction(async (tx) => {
          await tx.punch.update({
            where: { id: last.id },
            data: { timestamp: targetSaida, origin: 'ADJUSTED' },
          });
          await tx.punchAudit.create({
            data: {
              id: crypto.randomUUID(),
              punchId: last.id,
              changedById: manager.id,
              field: 'timestamp',
              oldValue: last.timestamp.toISOString(),
              newValue: targetSaida.toISOString(),
              reason: 'Saída antecipada por vendaval — liberação às 15h',
            },
          });
        });
        summary.vendavalSaidasAdjusted += 1;
      }
    } else if (list.some((p) => p.type === 'ENTRADA')) {
      const userId = list[0].userId;
      await prisma.$transaction(async (tx) => {
        const punch = await tx.punch.create({
          data: {
            id: crypto.randomUUID(),
            userId,
            type: 'SAIDA',
            timestamp: targetSaida,
            clientTimestamp: targetSaida,
            status: 'VALID',
            origin: 'ADJUSTED',
            locationValid: false,
            clientId: `vendaval-${userId}-${DATA_VENDAVAL}-SAIDA`,
          },
          select: { id: true },
        });
        await tx.punchAudit.create({
          data: {
            id: crypto.randomUUID(),
            punchId: punch.id,
            changedById: manager.id,
            field: 'manual_create',
            oldValue: null,
            newValue: `SAIDA ${targetSaida.toISOString()}`,
            reason: 'Saída antecipada por vendaval — liberação às 15h',
          },
        });
      });
      summary.vendavalSaidasAdjusted += 1;
    }
  }

  const kaio = await prisma.user.findFirst({
    where: { employeeNumber: MAT_KAIO, role: 'EMPLOYEE' },
    select: { id: true },
  });
  if (kaio) {
    const now = new Date();
    const keys = new Set<string>([
      lastFridayOfMonth(2026, 8),
      lastFridayOfMonth(now.getFullYear(), now.getMonth() + 1),
    ]);
    for (const key of keys) {
      const mid = dayMid(key);
      const exists = await prisma.medicalCertificate.findFirst({
        where: {
          userId: kaio.id,
          status: { not: 'CANCELADO' },
          startDate: { lte: mid },
          endDate: { gte: mid },
          observation: { contains: 'jovem aprendiz' },
        },
      });
      if (!exists) {
        await prisma.medicalCertificate.create({
          data: {
            userId: kaio.id,
            createdById: manager.id,
            type: 'OUTRO',
            startDate: mid,
            endDate: mid,
            daysCount: 1,
            observation: 'Curso jovem aprendiz (última sexta do mês) — dia abonado',
            status: 'APROVADO',
          },
        });
        summary.kaioCertificates += 1;
      }
    }
  }

  await appendAuditEvent({
    action: 'OPERATIONAL_ADJUSTMENTS_APPLIED',
    actorId: manager.id,
    resource: 'OperationalRules',
    metadata: summary,
  });

  return NextResponse.json({ ok: true, summary });
}
