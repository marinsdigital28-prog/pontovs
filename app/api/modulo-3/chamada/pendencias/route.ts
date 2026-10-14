import { NextResponse } from 'next/server';
import { findAttendanceList } from '@/lib/beneficiarios-source';
import { readSessionFromAttendanceRow } from '@/lib/call-assignments';
import { consumeRateLimit, getRequestKey, rateLimitResponse } from '@/lib/security-controls';
import {
  callDateParts,
  getCallEmployee,
  getScheduledAssignments,
  getProgramRoster,
  makeAttendanceSessionMeta,
  todayInCallTimeZone,
} from '@/lib/modulo3-call-server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { employee, status = 401, error } = await getCallEmployee();
  if (!employee) return NextResponse.json({ error }, { status });
  const rate = await consumeRateLimit(getRequestKey(request, 'employee-call-pending', employee.id), 60, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);

  const date = todayInCallTimeZone();
  const assignments = getScheduledAssignments(employee, date);
  if (!assignments.length) return NextResponse.json({ date, pending: false, pendingCount: 0 });

  try {
    const pending: string[] = [];
    const { mes, ano } = callDateParts(date);
    for (const assignment of assignments) {
      const { participants } = await getProgramRoster(assignment, date);
      if (!participants.length) continue;
      const row = await findAttendanceList(mes, ano, assignment.turmaId);
      const meta = makeAttendanceSessionMeta(employee, assignment, date, assignment.turmaName || assignment.turmaId);
      const session = readSessionFromAttendanceRow(row, meta);
      const complete = participants.every((participant) => Boolean(session?.marks?.[participant.id]));
      if (!complete) pending.push(assignment.id);
    }
    return NextResponse.json({ date, pending: pending.length > 0, pendingCount: pending.length });
  } catch {
    return NextResponse.json({ date, pending: false, pendingCount: 0, unavailable: true });
  }
}
