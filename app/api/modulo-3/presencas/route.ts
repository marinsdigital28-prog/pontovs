import { NextResponse } from 'next/server';
import { listAttendanceHistory } from '@/lib/beneficiarios-source';
import { isAttendanceMarkStatus, readAttendanceSessions, type AttendanceMarkStatus } from '@/lib/call-assignments';
import { consumeRateLimit, getRequestKey, rateLimitResponse } from '@/lib/security-controls';
import { getCallManager } from '@/lib/modulo3-call-server';

export const dynamic = 'force-dynamic';

type HistoryParticipant = { id: string; nome: string; codigo: string | null; status: AttendanceMarkStatus | null };
type HistoryRecord = {
  id: string;
  date: string;
  program: string | null;
  kind: string;
  activity: string | null;
  turmaId: string;
  turma: string;
  shift: string;
  slot: number | null;
  startTime: string | null;
  endTime: string | null;
  professionalId: string | null;
  professionalName: string;
  marks: Record<string, unknown>;
  participants: HistoryParticipant[];
  legacy: boolean;
};

function currentMonthYear() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { mes: Number(values.month), ano: Number(values.year) };
}

export async function GET(request: Request) {
  const { manager, status = 401, error } = await getCallManager();
  if (!manager) return NextResponse.json({ error }, { status });
  const rate = await consumeRateLimit(getRequestKey(request, 'module3-attendance-history', manager.id), 60, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);

  const url = new URL(request.url);
  const current = currentMonthYear();
  const mes = Number(url.searchParams.get('mes') || current.mes);
  const ano = Number(url.searchParams.get('ano') || current.ano);
  const turmaId = url.searchParams.get('turmaId') || undefined;
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 200), 1), 500);
  const offset = Math.max(Number(url.searchParams.get('offset') || 0), 0);
  if (!Number.isInteger(mes) || mes < 1 || mes > 12 || !Number.isInteger(ano) || ano < 2020 || ano > 2100 || turmaId && turmaId.length > 120) {
    return NextResponse.json({ error: 'Filtros de período ou turma inválidos.' }, { status: 400 });
  }

  try {
    const rows = await listAttendanceHistory({ mes, ano, turmaId, limit, offset });
    const records: HistoryRecord[] = [];
    for (const row of rows) {
      const participants = Array.isArray(row.participantes)
        ? row.participantes.map((value) => value && typeof value === 'object' ? value as Record<string, unknown> : {}).filter((item) => typeof item.id === 'string')
        : [];
      const sessions = readAttendanceSessions(row.marcacoes);
      if (sessions.length) {
        for (const session of sessions) {
          records.push({
            id: `${String(row.id)}:${session.date}:${session.turmaId}:${session.program}:${session.kind}:${session.activity || ''}:${session.shift}:${session.slot}`,
            date: session.date,
            program: session.program,
            kind: session.kind,
            activity: session.activity,
            turmaId: session.turmaId,
            turma: session.turma,
            shift: session.shift,
            slot: session.slot,
            startTime: session.startTime,
            endTime: session.endTime,
            professionalId: session.professionalId,
            professionalName: session.professionalName,
            marks: {},
            participants: participants.map((participant) => ({
              id: String(participant.id),
              nome: String(participant.nome || 'Beneficiário'),
              codigo: participant.codigo == null ? null : String(participant.codigo),
              status: isAttendanceMarkStatus(session.marks[String(participant.id)]) ? session.marks[String(participant.id)] : null,
            })),
            legacy: false,
          });
        }
        continue;
      }

      const filters = row.filtros && typeof row.filtros === 'object' ? row.filtros as Record<string, unknown> : {};
      const marks = row.marcacoes && typeof row.marcacoes === 'object' ? row.marcacoes as Record<string, unknown> : {};
      const hasLegacyMarks = Object.keys(marks).some((key) => key !== '__sessions');
      if (!hasLegacyMarks) continue;
      const date = typeof filters.data === 'string' ? filters.data : row.created_at instanceof Date ? row.created_at.toISOString().slice(0, 10) : String(row.created_at || '').slice(0, 10);
      records.push({
        id: `${String(row.id)}:legado:${date}`,
        date,
        program: null,
        kind: 'GENERAL',
        activity: null,
        turmaId: String(row.turma_id || ''),
        turma: String(row.turma || 'Turma não informada'),
        shift: String(row.turno || ''),
        slot: null,
        startTime: null,
        endTime: null,
        professionalId: null,
        professionalName: String(row.educador || row.autor || 'Profissional não informado'),
        marks: {},
        participants: [],
        legacy: true,
      });
    }
    return NextResponse.json({ records, mes, ano, limit, offset, hasMore: rows.length === limit });
  } catch {
    return NextResponse.json({ error: 'Não foi possível carregar o histórico da fonte de presenças.' }, { status: 502 });
  }
}
