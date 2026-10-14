import { NextResponse } from 'next/server';
import { consumeRateLimit, getRequestKey, rateLimitResponse } from '@/lib/security-controls';
import { getCallEmployee, getEmployeeAssignments } from '@/lib/modulo3-call-server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { employee, status = 401, error } = await getCallEmployee();
  if (!employee) return NextResponse.json({ error }, { status });
  const rate = await consumeRateLimit(getRequestKey(request, 'employee-call-assignments', employee.id), 60, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);
  return NextResponse.json({
    assignments: getEmployeeAssignments(employee),
    professional: { id: employee.id, name: employee.name, jobTitle: employee.jobTitle },
    writeAllowed: process.env.VERCEL_ENV !== 'preview' || process.env.CHAMADA_PREVIEW_WRITE_ENABLED === 'true',
  });
}
