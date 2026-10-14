import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { appendAuditEvent, consumeRateLimit, getRequestKey, rateLimitResponse } from '@/lib/security-controls';
import { CALL_DAYS, normalizeCallAssignments, parseProfileJson, readCallAssignments } from '@/lib/call-assignments';
import { getCallManager } from '@/lib/modulo3-call-server';
import { listTurmas } from '@/lib/beneficiarios-source';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { manager, status = 401, error } = await getCallManager();
  if (!manager) return NextResponse.json({ error }, { status });
  const rate = await consumeRateLimit(getRequestKey(request, 'admin-call-assignments-read', manager.id), 60, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);

  try {
    const [employees, classesResult] = await Promise.all([
      prisma.user.findMany({
        where: { role: 'EMPLOYEE', active: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, employeeNumber: true, jobTitle: true, profileJson: true },
      }),
      listTurmas().then((turmas) => ({ turmas, available: true as const })).catch(() => ({ turmas: [], available: false as const })),
    ]);
    return NextResponse.json({
      employees: employees.map((employee) => ({
        id: employee.id,
        name: employee.name,
        employeeNumber: employee.employeeNumber,
        jobTitle: employee.jobTitle,
        assignments: readCallAssignments(employee.profileJson),
      })),
      turmas: classesResult.turmas,
      sourceAvailable: classesResult.available,
      sourceMessage: classesResult.available ? '' : 'Não foi possível consultar as turmas cadastradas nesta fonte.',
      writeAllowed: process.env.VERCEL_ENV !== 'preview' || process.env.CHAMADA_PREVIEW_WRITE_ENABLED === 'true',
      days: CALL_DAYS,
    });
  } catch {
    return NextResponse.json({ error: 'Não foi possível carregar os vínculos de chamada.' }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  const { manager, status = 401, error } = await getCallManager();
  if (!manager) return NextResponse.json({ error }, { status });
  if (process.env.VERCEL_ENV === 'preview' && process.env.CHAMADA_PREVIEW_WRITE_ENABLED !== 'true') {
    return NextResponse.json({ error: 'Este Preview está somente para revisão. As gravações ficam desabilitadas até conectar um banco de Preview isolado.' }, { status: 409 });
  }
  const rate = await consumeRateLimit(getRequestKey(request, 'admin-call-assignments-write', manager.id), 20, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);

  const body = await request.json().catch(() => null);
  const employeeId = String(body?.employeeId || '').trim();
  if (!employeeId) return NextResponse.json({ error: 'Selecione um colaborador cadastrado.' }, { status: 400 });
  const parsed = normalizeCallAssignments(body?.assignments);
  if (!parsed.assignments) return NextResponse.json({ error: parsed.error || 'Vínculos inválidos.' }, { status: 400 });
  if (parsed.assignments.some((assignment) => assignment.kind === 'WORKSHOP')) {
    return NextResponse.json({ error: 'O catálogo real de atividades não está disponível para verificação neste momento. Não vou inventar vínculos de oficina; chamadas gerais com turmas cadastradas continuam disponíveis.' }, { status: 409 });
  }

  try {
    const [employee, turmas] = await Promise.all([
      prisma.user.findFirst({ where: { id: employeeId, role: 'EMPLOYEE', active: true }, select: { id: true, name: true, profileJson: true } }),
      listTurmas(),
    ]);
    if (!employee) return NextResponse.json({ error: 'O colaborador selecionado não está ativo ou não existe.' }, { status: 404 });
    const turmaById = new Map(turmas.map((turma) => [turma.id, turma]));
    const assignments = parsed.assignments.map((assignment) => {
      const turma = turmaById.get(assignment.turmaId);
      if (!turma) return null;
      if (assignment.kind === 'WORKSHOP' && !turma.oficina_id) return null;
      return { ...assignment, turmaName: turma.nome };
    });
    if (assignments.some((assignment) => assignment === null)) {
      return NextResponse.json({ error: 'Cada vínculo precisa usar uma turma cadastrada; oficinas exigem uma turma já vinculada a uma oficina existente.' }, { status: 400 });
    }

    const actual = assignments as NonNullable<(typeof assignments)[number]>[];
    const seen = new Map<string, Set<string>>();
    for (const assignment of actual) {
      const signature = [assignment.program, assignment.kind, assignment.activity || '', assignment.turmaId, assignment.shift, assignment.slot].join('|');
      const days = seen.get(signature) || new Set<string>();
      if (assignment.days.some((day) => days.has(day))) {
        return NextResponse.json({ error: 'Há vínculos repetidos para a mesma turma, atividade, programa e horário.' }, { status: 409 });
      }
      assignment.days.forEach((day) => days.add(day));
      seen.set(signature, days);
    }

    const currentProfile = parseProfileJson(employee.profileJson);
    const profileJson = JSON.stringify({ ...currentProfile, callAssignments: actual });
    await prisma.user.update({ where: { id: employee.id }, data: { profileJson } });
    await appendAuditEvent({
      action: 'MODULO3_CALL_ASSIGNMENTS_UPDATED',
      actorId: manager.id,
      resource: 'User',
      resourceId: employee.id,
      metadata: { assignmentCount: actual.length },
    });
    return NextResponse.json({ employeeId: employee.id, assignments: actual, saved: true });
  } catch {
    return NextResponse.json({ error: 'Não foi possível salvar os vínculos. Confirme a fonte de turmas e tente novamente.' }, { status: 503 });
  }
}
