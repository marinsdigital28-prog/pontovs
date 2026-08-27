import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { INFERRED_SCHEDULES } from '../../../../lib/inferred-schedules';
import { mergeInferredSchedule } from '../../../../lib/schedule-application';
import { appendAuditEvent, consumeRateLimit, getRequestKey, rateLimitResponse } from '@/lib/security-controls';

export const dynamic = 'force-dynamic';

async function requireManager() {
  const session = (await getServerSession(authOptions as any)) as any;
  const id = session?.user?.id as string | undefined;
  if (!id) return null;
  return prisma.user.findFirst({ where: { id, active: true, role: { in: ['ADMIN', 'MANAGER'] } }, select: { id: true, name: true } });
}

export async function POST(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 401 });
  const rate = await consumeRateLimit(getRequestKey(request, 'admin-schedule-patterns', manager.id), 3, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);

  const body = await request.json().catch(() => ({}));
  const automatic = body?.mode === 'automatic';
  const result = await prisma.$transaction(async (tx) => {
    const employees = await tx.user.findMany({ where: { role: 'EMPLOYEE', employeeNumber: { in: Object.keys(INFERRED_SCHEDULES) } }, select: { id: true, employeeNumber: true, workDays: true, scheduleStart: true, scheduleEnd: true } });
    let updated = 0;
    let skipped = 0;
    for (const employee of employees) {
      const number = employee.employeeNumber || '';
      const schedule = INFERRED_SCHEDULES[number];
      if (!schedule) continue;
      const merged = mergeInferredSchedule(employee, schedule);
      if (automatic && !merged.applied) { skipped += 1; continue; }
      await tx.user.update({ where: { id: employee.id }, data: { workDays: merged.workDays, scheduleStart: merged.scheduleStart, scheduleEnd: merged.scheduleEnd } });
      updated += 1;
    }
    return { matched: employees.length, updated, skipped };
  });

  await appendAuditEvent({ action: automatic ? 'SCHEDULE_PATTERNS_AUTO_APPLIED' : 'SCHEDULE_PATTERNS_APPLIED', actorId: manager.id, resource: 'User', metadata: { source: 'PONTOS_ESP_PROGREDIR_2026_08.csv', automatic, ...result } });
  return NextResponse.json({ ok: true, ...result, totalPatterns: Object.keys(INFERRED_SCHEDULES).length });
}
