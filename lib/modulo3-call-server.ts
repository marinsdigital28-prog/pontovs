import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import {
  getDateDayCode,
  participantMatchesProgram,
  readCallAssignments,
  type AttendanceSessionMeta,
  type CallAssignment,
} from '@/lib/call-assignments';
import { listAtivosParaChamadaDetalhada } from '@/lib/beneficiarios-source';

export const CALL_TIME_ZONE = 'America/Sao_Paulo';

export type CallEmployee = {
  id: string;
  name: string;
  employeeNumber: string | null;
  jobTitle: string | null;
  role: string;
  active: boolean;
  profileJson: string | null;
};

export type CallManager = { id: string; name: string; role: string };

export async function getCallEmployee(): Promise<{ employee: CallEmployee | null; status?: number; error?: string }> {
  const session = (await getServerSession(authOptions as any)) as any;
  const id = String(session?.user?.id || '');
  if (!id) return { employee: null, status: 401, error: 'Faça login como colaborador para acessar a chamada.' };
  try {
    const employee = await prisma.user.findFirst({
      where: { id, active: true, role: 'EMPLOYEE' },
      select: { id: true, name: true, employeeNumber: true, jobTitle: true, role: true, active: true, profileJson: true },
    });
    if (!employee) return { employee: null, status: 403, error: 'O perfil ativo de colaborador não foi encontrado.' };
    return { employee };
  } catch {
    return { employee: null, status: 503, error: 'Não foi possível validar o perfil neste momento.' };
  }
}

export async function getCallManager(): Promise<{ manager: CallManager | null; status?: number; error?: string }> {
  const session = (await getServerSession(authOptions as any)) as any;
  const id = String(session?.user?.id || '');
  if (!id) return { manager: null, status: 401, error: 'Faça login para continuar.' };
  try {
    const manager = await prisma.user.findFirst({
      where: { id, active: true, role: { in: ['ADMIN', 'MANAGER'] } },
      select: { id: true, name: true, role: true },
    });
    if (!manager) return { manager: null, status: 403, error: 'Acesso restrito à administração.' };
    return { manager };
  } catch {
    return { manager: null, status: 503, error: 'Não foi possível validar a permissão administrativa.' };
  }
}

export function isValidCallDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function todayInCallTimeZone(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CALL_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function callDateParts(date: string) {
  const [ano, mes] = date.split('-').map(Number);
  return { ano, mes };
}

export function getEmployeeAssignments(employee: CallEmployee): CallAssignment[] {
  return readCallAssignments(employee.profileJson).filter((assignment) => assignment.active);
}

export function getScheduledAssignments(employee: CallEmployee, date: string, assignmentId?: string | null): CallAssignment[] {
  if (!isValidCallDate(date)) return [];
  const weekday = getDateDayCode(date, CALL_TIME_ZONE);
  if (!weekday) return [];
  return getEmployeeAssignments(employee).filter((assignment) =>
    assignment.days.includes(weekday) && (!assignmentId || assignment.id === assignmentId),
  );
}

export async function getProgramRoster(assignment: CallAssignment, date: string) {
  const all = await listAtivosParaChamadaDetalhada(assignment.turmaId);
  const missingBirthDate = all.filter((item) => !item.data_nascimento).length;
  const participants = all
    .filter((item) => participantMatchesProgram(item.data_nascimento, assignment.program, date))
    .map(({ data_nascimento: _birthDate, ...item }) => item);
  return { participants, missingBirthDate };
}

export function makeAttendanceSessionMeta(
  employee: CallEmployee,
  assignment: CallAssignment,
  date: string,
  turma: string,
): AttendanceSessionMeta {
  return {
    assignmentId: assignment.id,
    date,
    program: assignment.program,
    kind: assignment.kind,
    activity: assignment.activity,
    turmaId: assignment.turmaId,
    turma,
    shift: assignment.shift,
    slot: assignment.slot,
    startTime: assignment.startTime,
    endTime: assignment.endTime,
    professionalId: employee.id,
    professionalName: employee.name,
  };
}

export function assignmentMatchesSession(assignment: CallAssignment, meta: AttendanceSessionMeta): boolean {
  return assignment.program === meta.program
    && assignment.kind === meta.kind
    && assignment.activity === meta.activity
    && assignment.turmaId === meta.turmaId
    && assignment.shift === meta.shift
    && assignment.slot === meta.slot;
}
