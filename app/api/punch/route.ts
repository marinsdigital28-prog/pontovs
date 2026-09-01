import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '../../../lib/prisma';
import { brazilDayRange } from '../../../lib/brazil-time';
import { resolveDaySchedule } from '../../../lib/day-schedule';
import { databaseUnavailableResponse, isDatabaseQuotaExceeded } from '../../../lib/database-errors';
import { isExitOverrideActive } from '../../../lib/exit-override';
import { consumeRateLimit, getRequestKey, rateLimitResponse } from '../../../lib/security-controls';
import { sendPunchReceiptEmail } from '../../../lib/punch-receipt';
import { isAllowedPunchType, resolveSmartPunchSuggestion, type PunchType } from '../../../lib/smart-punch-type';

export const dynamic = 'force-dynamic';
const Input = z.object({
  employeeNumber: z.string().trim().min(1).optional(),
  clientTimestamp: z.string().datetime().optional(),
  clientId: z.string().trim().min(1).max(120).optional(),
  type: z.enum(['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA']).optional(),
  photo: z
    .string()
    .regex(/^data:image\/(jpeg|jpg|png|webp);base64,/i, 'Foto inválida')
    .max(4_000_000)
    .nullable()
    .optional(),
  location: z
    .object({
      lat: z.number().finite(),
      lng: z.number().finite(),
      accuracy: z.number().finite().nonnegative().optional(),
    })
    .nullable()
    .optional(),
});

export async function POST(req: Request) {
  const rate = await consumeRateLimit(getRequestKey(req, 'punch-write'), 120, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);
  try {
    const input = Input.parse(await req.json());
    const session = (await getServerSession(authOptions as any)) as any;
    const sessionId = session?.user?.id as string | undefined;
    const result = await prisma.$transaction(
      async (tx) => {
        const normalizedEmployeeNumber = input.employeeNumber
          ? input.employeeNumber.replace(/\D/g, '').padStart(4, '0')
          : null;
        let user = normalizedEmployeeNumber
          ? await tx.user.findUnique({ where: { employeeNumber: normalizedEmployeeNumber } })
          : null;
        if (!user && sessionId) user = await tx.user.findUnique({ where: { id: sessionId } });
        if (!user || !user.active || user.role !== 'EMPLOYEE') {
          throw new HttpError('Colaborador não identificado ou inativo', 401);
        }
        if (input.clientId) {
          const old = await tx.punch.findUnique({ where: { clientId: input.clientId } });
          if (old) return { punch: old, user, duplicate: true };
        }
        const now = new Date();
        const { start, end } = brazilDayRange(now);
        const punchesToday = await tx.punch.findMany({
          where: { userId: user.id, status: 'VALID', timestamp: { gte: start, lt: end } },
          orderBy: { timestamp: 'asc' },
          select: { type: true, timestamp: true },
        });
        const schedule = resolveDaySchedule(
          user.scheduleByDay,
          user.workDays,
          user.scheduleStart,
          user.scheduleEnd,
          now.getDay(),
        );
        const mode = schedule?.mode === 'HALF' ? 'HALF' : 'FULL';
        const smart = resolveSmartPunchSuggestion({
          punchesToday,
          mode,
          scheduleEnd: schedule?.end ?? user.scheduleEnd?.slice(0, 5),
          now,
        });

        if (smart.journeyClosed || (!smart.suggestedType && !smart.sequentialType)) {
          throw new HttpError('A jornada de hoje já foi encerrada', 409);
        }

        let type: PunchType;
        if (isExitOverrideActive(now)) {
          type = 'SAIDA';
        } else if (input.type) {
          if (!isAllowedPunchType(input.type, smart.allowedTypes)) {
            throw new HttpError(
              `Tipo ${input.type} não permitido agora. Opções: ${smart.allowedTypes.join(', ') || 'nenhuma'}.`,
              400,
            );
          }
          type = input.type;
        } else {
          type = (smart.suggestedType || smart.sequentialType)!;
        }

        const punch = await tx.punch.create({
          data: {
            userId: user.id,
            unitId: user.unitId || null,
            type,
            timestamp: now,
            clientTimestamp: input.clientTimestamp ? new Date(input.clientTimestamp) : null,
            latitude: input.location?.lat ?? null,
            longitude: input.location?.lng ?? null,
            accuracy: input.location?.accuracy ?? null,
            locationValid: Boolean(input.location),
            origin: 'WEB',
            clientId: input.clientId ?? null,
            photoData: input.photo ?? null,
          },
        });
        await tx.punchAudit.create({
          data: {
            punchId: punch.id,
            changedById: user.id,
            field: 'created',
            newValue: JSON.stringify({
              type: punch.type,
              timestamp: punch.timestamp.toISOString(),
              clientId: punch.clientId,
              origin: punch.origin,
              suggestedType: smart.suggestedType,
              chosenType: type,
            }),
            reason: input.type && input.type !== smart.suggestedType
              ? `Registro via app (colaborador escolheu ${type}; sugerido ${smart.suggestedType})`
              : 'Registro inicial via app',
          },
        });
        return { punch, user, duplicate: false };
      },
      { isolationLevel: 'Serializable' },
    );
    let receiptEmail: { status: string; id?: string } = { status: 'not_available' };
    if (!result.duplicate && result.user.email) {
      try {
        const sent = await sendPunchReceiptEmail({
          to: result.user.email,
          employeeName: result.user.name,
          employeeNumber: result.user.employeeNumber,
          type: result.punch.type,
          timestamp: result.punch.timestamp,
          photoData: result.punch.photoData,
        });
        receiptEmail =
          sent.status === 'sent' ? { status: sent.status, id: sent.id } : { status: sent.status };
      } catch {
        receiptEmail = { status: 'failed' };
      }
    }
    const { photoData: _photoData, ...safePunch } = result.punch;
    return NextResponse.json(
      {
        ...safePunch,
        userName: result.user.name,
        employeeNumber: result.user.employeeNumber,
        hasPhoto: Boolean(result.punch.photoData),
        receiptEmail,
      },
      { status: result.duplicate ? 200 : 201 },
    );
  } catch (error) {
    if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (isConflict(error)) {
      return NextResponse.json(
        { error: 'Esta batida já foi registrada ou houve concorrência. Atualize e tente novamente.' },
        { status: 409 },
      );
    }
    if (isDatabaseQuotaExceeded(error)) {
      return NextResponse.json(databaseUnavailableResponse(), { status: 503 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Não foi possível registrar a batida' },
      { status: 400 },
    );
  }
}
class HttpError extends Error {
  constructor(
    public message: string,
    public status: number,
  ) {
    super(message);
  }
}
function isConflict(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    ((error as any).code === 'P2002' || (error as any).code === 'P2034')
  );
}
