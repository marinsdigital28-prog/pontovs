import { NextResponse } from 'next/server';
import {
  findAttendanceList,
  createAttendanceList,
  updateAttendanceList,
  type PresencaStatus,
} from '@/lib/beneficiarios-source';
import {
  isAttendanceMarkStatus,
  mergeAttendanceParticipants,
  readSessionFromAttendanceRow,
  sessionKey,
  withAttendanceSession,
} from '@/lib/call-assignments';
import { consumeRateLimit, getRequestKey, rateLimitResponse } from '@/lib/security-controls';
import {
  callDateParts,
  getCallEmployee,
  getScheduledAssignments,
  getProgramRoster,
  isValidCallDate,
  makeAttendanceSessionMeta,
} from '@/lib/modulo3-call-server';

export const dynamic = 'force-dynamic';

function existingFilters(value: unknown) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function getAssignedCall(employeeId: string, assignmentId: string, date: string) {
  const { employee } = await getCallEmployee();
  if (!employee || employee.id !== employeeId) return null;
  return getScheduledAssignments(employee, date, assignmentId)[0] || null;
}

export async function GET(request: Request) {
  const { employee, status = 401, error } = await getCallEmployee();
  if (!employee) return NextResponse.json({ error }, { status });
  const rate = await consumeRateLimit(getRequestKey(request, 'employee-call-read', employee.id), 120, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);

  const url = new URL(request.url);
  const date = url.searchParams.get('date') || '';
  const assignmentId = url.searchParams.get('assignmentId') || '';
  if (!isValidCallDate(date) || !assignmentId) return NextResponse.json({ error: 'Selecione uma chamada e uma data válidas.' }, { status: 400 });
  const assignment = await getAssignedCall(employee.id, assignmentId, date);
  if (!assignment) return NextResponse.json({ error: 'Essa chamada não está atribuída ao seu perfil nessa data.' }, { status: 403 });

  try {
    const { participants, missingBirthDate } = await getProgramRoster(assignment, date);
    const turma = participants[0]?.turma || assignment.turmaName || 'Turma cadastrada';
    const { mes, ano } = callDateParts(date);
    const row = await findAttendanceList(mes, ano, assignment.turmaId);
    const meta = makeAttendanceSessionMeta(employee, assignment, date, turma);
    const session = readSessionFromAttendanceRow(row, meta);
    return NextResponse.json({
      date,
      assignment,
      session,
      participants,
      missingBirthDate,
      sourceAvailable: true,
    });
  } catch {
    return NextResponse.json({ error: 'A fonte de turmas e beneficiários não está disponível neste ambiente.' }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const { employee, status: authStatus = 401, error: authError } = await getCallEmployee();
  if (!employee) return NextResponse.json({ error: authError }, { status: authStatus });
  if (process.env.VERCEL_ENV === 'preview' && process.env.CHAMADA_PREVIEW_WRITE_ENABLED !== 'true') {
    return NextResponse.json({ error: 'Este Preview está somente para revisão. A gravação de presenças fica desabilitada até conectar uma fonte isolada.' }, { status: 409 });
  }
  const rate = await consumeRateLimit(getRequestKey(request, 'employee-call-write', employee.id), 180, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);

  const body = await request.json().catch(() => null);
  const date = String(body?.date || '');
  const assignmentId = String(body?.assignmentId || '');
  const beneficiaryId = String(body?.beneficiaryId || '');
  const markedStatus = body?.status as PresencaStatus;
  if (!isValidCallDate(date) || !assignmentId || !beneficiaryId || !isAttendanceMarkStatus(markedStatus)) {
    return NextResponse.json({ error: 'Chamada, data, beneficiário e situação são obrigatórios.' }, { status: 400 });
  }
  const assignment = await getAssignedCall(employee.id, assignmentId, date);
  if (!assignment) return NextResponse.json({ error: 'Essa chamada não está atribuída ao seu perfil nessa data.' }, { status: 403 });

  try {
    const { participants, missingBirthDate } = await getProgramRoster(assignment, date);
    const participant = participants.find((item) => item.id === beneficiaryId);
    if (!participant) return NextResponse.json({ error: 'O beneficiário não pertence à turma ativa deste programa.' }, { status: 403 });
    const turma = participant.turma || assignment.turmaName || 'Turma cadastrada';
    const meta = makeAttendanceSessionMeta(employee, assignment, date, turma);
    const { mes, ano } = callDateParts(date);
    let row = await findAttendanceList(mes, ano, assignment.turmaId);

    if (!row) {
      const key = sessionKey(meta);
      const filters = {
        origem: 'portalprogredir',
        data: date,
        __chamadaSessions: { [key]: meta },
      };
      const created = await createAttendanceList({
        mes,
        ano,
        projeto: assignment.program,
        turma_id: assignment.turmaId,
        turma,
        turno: assignment.shift,
        educador: employee.name,
        unidade: null,
        filtros: filters,
        participantes: participants,
        marcacoes: withAttendanceSession({}, meta, beneficiaryId, markedStatus),
        total_alunos: participants.length,
        autor: employee.name,
        dispositivo: 'PWA · Chamada do colaborador',
      });
      if (created?.id) {
        const session = readSessionFromAttendanceRow(created, meta);
        return NextResponse.json({ session, syncedAt: new Date().toISOString(), missingBirthDate }, { status: 201 });
      }
      row = await findAttendanceList(mes, ano, assignment.turmaId);
      if (!row?.id) throw new Error('Não foi possível confirmar a criação da lista.');
    }

    const currentFilters = existingFilters(row.filtros);
    const currentCallSessions = existingFilters(currentFilters.__chamadaSessions);
    const key = sessionKey(meta);
    const updated = await updateAttendanceList(String(row.id), {
      marcacoes: withAttendanceSession(row.marcacoes, meta, beneficiaryId, markedStatus),
      filtros: { ...currentFilters, origem: currentFilters.origem || 'portalprogredir', __chamadaSessions: { ...currentCallSessions, [key]: meta } },
      participantes: mergeAttendanceParticipants(row.participantes, participants),
      projeto: assignment.program,
      turma,
      turno: assignment.shift,
      educador: employee.name,
      total_alunos: participants.length,
      updated_at: new Date().toISOString(),
      autor: employee.name,
    });
    if (!updated) throw new Error('A gravação não retornou uma lista atualizada.');
    const session = readSessionFromAttendanceRow(updated, meta);
    return NextResponse.json({ session, syncedAt: new Date().toISOString(), missingBirthDate });
  } catch {
    return NextResponse.json({ error: 'Não foi possível sincronizar a presença na fonte do Módulo 3.' }, { status: 502 });
  }
}
