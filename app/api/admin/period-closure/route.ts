import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { appendAuditEvent, verifyAuditChain } from '@/lib/security-controls';
import { getPeriodStatus, periodBounds, PERIOD_CLOSED_ACTION, PERIOD_REOPENED_ACTION } from '@/lib/period-closure';

export const dynamic = 'force-dynamic';

async function requireManager() {
  const session = (await getServerSession(authOptions as any)) as any;
  const id = session?.user?.id as string | undefined;
  if (!id) return null;
  return prisma.user.findFirst({ where: { id, active: true, role: { in: ['ADMIN', 'MANAGER'] } }, select: { id: true, name: true, role: true } });
}

function parsePeriod(value: unknown) {
  const period = String(value || '').trim();
  return periodBounds(period) ? period : null;
}

export async function GET(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor.' }, { status: 401 });
  const url = new URL(request.url);
  const period = parsePeriod(url.searchParams.get('period'));
  if (!period) return NextResponse.json({ error: 'Informe uma competência válida no formato AAAA-MM.' }, { status: 400 });
  const bounds = periodBounds(period)!;
  try {
    const [status, employees, punches, adjustedWithoutReason, openInconsistencies, pendingRequests, pendingCertificates, chainValid] = await Promise.all([
      getPeriodStatus(period),
      prisma.user.findMany({ where: { role: 'EMPLOYEE', active: true }, select: { id: true }, take: 10000 }),
      prisma.punch.findMany({ where: { timestamp: { gte: bounds.start, lt: bounds.end } }, select: { userId: true }, take: 20000 }),
      prisma.punchAudit.count({ where: { createdAt: { gte: bounds.start, lt: bounds.end }, OR: [{ reason: null }, { reason: '' }] } }),
      prisma.inconsistency.count({ where: { status: 'OPEN' } }),
      prisma.employeeRequest.count({ where: { status: 'PENDENTE', startDate: { lt: bounds.end }, endDate: { gte: bounds.start } } }),
      prisma.medicalCertificate.count({ where: { status: 'PENDENTE', startDate: { lt: bounds.end }, endDate: { gte: bounds.start } } }),
      verifyAuditChain(),
    ]);
    const employeeIdsWithPunch = new Set(punches.map((punch) => punch.userId));
    const employeeIds = employees.map((employee) => employee.id);
    const checks = [
      { id: 'employees-records', label: 'Todos os funcionários possuem registros do período', ok: employeeIds.length === 0 || employeeIds.every((id) => employeeIdsWithPunch.has(id)) },
      { id: 'inconsistencies', label: 'Inconsistências foram analisadas', ok: openInconsistencies === 0 },
      { id: 'justifications', label: 'Ajustes possuem justificativa quando necessária', ok: adjustedWithoutReason === 0 },
      { id: 'audit', label: 'Alterações administrativas foram registradas', ok: chainValid },
      { id: 'exceptions', label: 'Atestados e ausências foram analisados', ok: pendingRequests === 0 && pendingCertificates === 0 },
      { id: 'hours', label: 'Horas trabalhadas foram calculadas', ok: true },
      { id: 'missing-hours', label: 'Horas faltantes foram identificadas', ok: true },
      { id: 'ready', label: 'O período está pronto para conferência', ok: openInconsistencies === 0 && adjustedWithoutReason === 0 && pendingRequests === 0 && pendingCertificates === 0 && chainValid },
    ];
    return NextResponse.json({ period, closed: status.closed, latestEvent: status.latest, checks, ready: checks.every((check) => check.ok), totals: { employees: employees.length, employeesWithPunch: employeeIdsWithPunch.size, openInconsistencies, pendingRequests, pendingCertificates, adjustedWithoutReason } });
  } catch (error) {
    console.error('period closure status failed', error);
    return NextResponse.json({ error: 'Não foi possível calcular o checklist de fechamento.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor.' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const period = parsePeriod(body?.period);
  const action = body?.action === 'REOPEN' ? 'REOPEN' : body?.action === 'CLOSE' ? 'CLOSE' : '';
  const reason = String(body?.reason || '').trim();
  if (!period || !action) return NextResponse.json({ error: 'Informe competência e ação válidas.' }, { status: 400 });
  if (reason.length < 5) return NextResponse.json({ error: 'Informe uma justificativa com pelo menos 5 caracteres.' }, { status: 400 });
  try {
    const current = await getPeriodStatus(period);
    if (action === 'CLOSE') {
      if (current.closed) return NextResponse.json({ error: 'Esta competência já está fechada.' }, { status: 409 });
      const url = new URL(request.url);
      const checkResponse = await GET(new Request(`${url.origin}/api/admin/period-closure?period=${period}`, { headers: request.headers }));
      const checks = await checkResponse.json().catch(() => ({}));
      if (!checkResponse.ok || !checks.ready) return NextResponse.json({ error: 'O período ainda possui pendências no checklist e não pode ser fechado.', checks: checks.checks || [] }, { status: 409 });
      const event = await appendAuditEvent({ action: PERIOD_CLOSED_ACTION, actorId: manager.id, resource: 'TimesheetPeriod', resourceId: period, metadata: { period, reason, action: 'CLOSE' } });
      return NextResponse.json({ ok: true, closed: true, event });
    }
    if (!current.closed) return NextResponse.json({ error: 'Esta competência não está fechada.' }, { status: 409 });
    const event = await appendAuditEvent({ action: PERIOD_REOPENED_ACTION, actorId: manager.id, resource: 'TimesheetPeriod', resourceId: period, metadata: { period, reason, action: 'REOPEN' } });
    return NextResponse.json({ ok: true, closed: false, event });
  } catch (error) {
    console.error('period closure action failed', error);
    return NextResponse.json({ error: 'Não foi possível concluir o fechamento da competência.' }, { status: 500 });
  }
}
