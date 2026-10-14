export const CALL_PROGRAMS = [
  { value: 'CRESCER', label: 'Espaço Crescer', minAge: 10, maxAge: 14 },
  { value: 'JOVEM', label: 'Espaço Jovem', minAge: 15, maxAge: 17 },
] as const;

export const CALL_ACTIVITIES = [
  'Educação Física',
  'Capoeira',
  'Futsal',
  'Música',
  'Teatro',
  'Leitura',
  'Desenho',
  'Jiu-Jitsu',
  'Fonoaudiologia',
  'Acompanhamento psicológico',
] as const;

export const CALL_DAYS = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'] as const;
export const CALL_STATUSES = ['presente', 'falta', 'justificado', 'nao_compareceu'] as const;

export type CallProgram = (typeof CALL_PROGRAMS)[number]['value'];
export type CallActivity = (typeof CALL_ACTIVITIES)[number];
export type CallDay = (typeof CALL_DAYS)[number];
export type CallKind = 'GENERAL' | 'WORKSHOP';
export type CallShift = 'MANHA' | 'TARDE';
export type CallSlot = 1 | 2;
export type AttendanceMarkStatus = (typeof CALL_STATUSES)[number];

export type CallAssignment = {
  id: string;
  kind: CallKind;
  program: CallProgram;
  turmaId: string;
  turmaName?: string;
  activity: CallActivity | null;
  shift: CallShift;
  slot: CallSlot;
  days: CallDay[];
  startTime: string | null;
  endTime: string | null;
  active: boolean;
};

export type AttendanceSessionMeta = {
  assignmentId: string;
  date: string;
  program: CallProgram;
  kind: CallKind;
  activity: CallActivity | null;
  turmaId: string;
  turma: string;
  shift: CallShift;
  slot: CallSlot;
  startTime: string | null;
  endTime: string | null;
  professionalId: string;
  professionalName: string;
};

export type AttendanceSession = AttendanceSessionMeta & {
  marks: Record<string, AttendanceMarkStatus>;
};

const validTime = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const programValues = new Set<string>(CALL_PROGRAMS.map((item) => item.value));
const activityValues = new Set<string>(CALL_ACTIVITIES);
const dayValues = new Set<string>(CALL_DAYS);
const statusValues = new Set<string>(CALL_STATUSES);

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function parseProfileJson(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    return record(JSON.parse(value));
  } catch {
    return {};
  }
}

export function isCallAssignment(value: unknown): value is CallAssignment {
  const item = record(value);
  return typeof item.id === 'string'
    && (item.kind === 'GENERAL' || item.kind === 'WORKSHOP')
    && programValues.has(String(item.program))
    && typeof item.turmaId === 'string'
    && (item.activity === null || activityValues.has(String(item.activity)))
    && (item.shift === 'MANHA' || item.shift === 'TARDE')
    && (item.slot === 1 || item.slot === 2)
    && Array.isArray(item.days)
    && item.days.length > 0
    && item.days.every((day) => dayValues.has(String(day)))
    && (item.startTime === null || typeof item.startTime === 'string' && validTime.test(item.startTime))
    && (item.endTime === null || typeof item.endTime === 'string' && validTime.test(item.endTime))
    && typeof item.active === 'boolean'
    && (item.kind === 'GENERAL'
      ? item.program === 'CRESCER' && item.activity === null
      : activityValues.has(String(item.activity)));
}

export function readCallAssignments(profileJson: string | null | undefined): CallAssignment[] {
  const raw = parseProfileJson(profileJson).callAssignments;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isCallAssignment);
}

export function normalizeCallAssignments(value: unknown): { assignments?: CallAssignment[]; error?: string } {
  if (!Array.isArray(value) || value.length > 40) {
    return { error: 'Envie uma lista válida de até 40 vínculos.' };
  }
  const ids = new Set<string>();
  const normalized: CallAssignment[] = [];
  for (const raw of value) {
    const item = record(raw);
    const id = String(item.id ?? '').trim();
    const kind = item.kind;
    const program = item.program;
    const turmaId = String(item.turmaId ?? '').trim();
    const activity = item.activity === '' || item.activity == null ? null : String(item.activity);
    const shift = item.shift;
    const slot = Number(item.slot);
    const days = Array.isArray(item.days)
      ? [...new Set(item.days.map((day) => String(day).toUpperCase()))]
      : [];
    const startTime = item.startTime === '' || item.startTime == null ? null : String(item.startTime);
    const endTime = item.endTime === '' || item.endTime == null ? null : String(item.endTime);
    const active = item.active !== false;

    if (!id || id.length > 80 || ids.has(id)) return { error: 'Cada vínculo precisa de um identificador único.' };
    if (kind !== 'GENERAL' && kind !== 'WORKSHOP') return { error: 'Escolha chamada geral ou atividade/oficina.' };
    if (!programValues.has(String(program))) return { error: 'Escolha o Espaço Crescer ou o Espaço Jovem.' };
    if (!turmaId || turmaId.length > 120) return { error: 'Selecione uma turma cadastrada.' };
    if (shift !== 'MANHA' && shift !== 'TARDE') return { error: 'Escolha o turno da manhã ou da tarde.' };
    if (slot !== 1 && slot !== 2) return { error: 'Escolha o primeiro ou o segundo horário.' };
    if (!days.length || days.some((day) => !dayValues.has(day))) return { error: 'Selecione ao menos um dia da semana válido.' };
    if (startTime !== null && !validTime.test(startTime)) return { error: 'Informe o horário inicial no formato HH:MM.' };
    if (endTime !== null && !validTime.test(endTime)) return { error: 'Informe o horário final no formato HH:MM.' };
    if (startTime && endTime && startTime >= endTime) return { error: 'O horário final deve ser posterior ao inicial.' };
    if (kind === 'GENERAL' && activity !== null) return { error: 'Chamada geral não deve receber uma oficina.' };
    if (kind === 'GENERAL' && program !== 'CRESCER') return { error: 'A chamada geral na quadra é exclusiva do Espaço Crescer.' };
    if (kind === 'WORKSHOP' && (!activity || !activityValues.has(activity))) return { error: 'Selecione uma atividade da lista prevista.' };

    ids.add(id);
    normalized.push({
      id,
      kind,
      program: program as CallProgram,
      turmaId,
      activity: activity as CallActivity | null,
      shift,
      slot: slot as CallSlot,
      days: days as CallDay[],
      startTime,
      endTime,
      active,
    });
  }
  return { assignments: normalized };
}

export function sessionKey(meta: Pick<AttendanceSessionMeta, 'program' | 'kind' | 'activity' | 'turmaId' | 'shift' | 'slot' | 'date'>) {
  return [meta.program, meta.kind, meta.activity ?? 'geral', meta.turmaId, meta.shift, meta.slot, meta.date]
    .map((part) => encodeURIComponent(String(part)))
    .join('::');
}

export function getAgeOnDate(birthDate: string | null | undefined, date: string): number | null {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const birth = new Date(`${birthDate}T00:00:00Z`);
  const at = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(birth.getTime()) || !Number.isFinite(at.getTime()) || birth > at) return null;
  let age = at.getUTCFullYear() - birth.getUTCFullYear();
  if (at.getUTCMonth() < birth.getUTCMonth() || at.getUTCMonth() === birth.getUTCMonth() && at.getUTCDate() < birth.getUTCDate()) age -= 1;
  return age;
}

export function participantMatchesProgram(birthDate: string | null | undefined, program: CallProgram, date: string) {
  const age = getAgeOnDate(birthDate, date);
  const definition = CALL_PROGRAMS.find((item) => item.value === program);
  return age !== null && Boolean(definition && age >= definition.minAge && age <= definition.maxAge);
}

export function getDateDayCode(date: string, timeZone = 'America/Sao_Paulo'): CallDay | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(new Date(`${date}T12:00:00Z`));
  const map: Record<string, CallDay> = { Mon: 'SEG', Tue: 'TER', Wed: 'QUA', Thu: 'QUI', Fri: 'SEX', Sat: 'SAB', Sun: 'DOM' };
  return map[weekday] ?? null;
}

export function isAttendanceMarkStatus(value: unknown): value is AttendanceMarkStatus {
  return typeof value === 'string' && statusValues.has(value);
}

export function readAttendanceSessions(marcacoes: unknown): AttendanceSession[] {
  const sessions = record(record(marcacoes).__sessions);
  return Object.values(sessions).filter((value): value is AttendanceSession => {
    const item = record(value);
    const marks = record(item.marks);
    return typeof item.assignmentId === 'string'
      && typeof item.date === 'string'
      && programValues.has(String(item.program))
      && (item.kind === 'GENERAL' || item.kind === 'WORKSHOP')
      && typeof item.turmaId === 'string'
      && typeof item.turma === 'string'
      && (item.shift === 'MANHA' || item.shift === 'TARDE')
      && (item.slot === 1 || item.slot === 2)
      && typeof item.professionalId === 'string'
      && typeof item.professionalName === 'string'
      && Object.values(marks).every(isAttendanceMarkStatus);
  }).map((value) => ({
    ...(value as AttendanceSession),
    marks: Object.fromEntries(Object.entries(record((value as AttendanceSession).marks)).filter(([, status]) => isAttendanceMarkStatus(status))) as Record<string, AttendanceMarkStatus>,
  }));
}

export function toAttendanceSession(meta: AttendanceSessionMeta, marks: Record<string, AttendanceMarkStatus> = {}): AttendanceSession {
  return { ...meta, marks };
}

export function mergeAttendanceParticipants(existing: unknown, current: Array<{ id: string; nome: string; codigo?: string | number | null; turma?: string }>) {
  const byId = new Map<string, Record<string, unknown>>();
  if (Array.isArray(existing)) {
    for (const item of existing) {
      const participant = record(item);
      if (typeof participant.id === 'string') byId.set(participant.id, participant);
    }
  }
  for (const item of current) byId.set(item.id, { ...item });
  return [...byId.values()];
}

export function withAttendanceSession(marcacoesValue: unknown, meta: AttendanceSessionMeta, beneficiaryId: string, status: AttendanceMarkStatus) {
  const current = record(marcacoesValue);
  const sessions = record(current.__sessions);
  const key = sessionKey(meta);
  const previous = record(sessions[key]);
  const marks = { ...record(previous.marks), [beneficiaryId]: status };
  return {
    ...current,
    __sessions: {
      ...sessions,
      [key]: { ...previous, ...meta, marks },
    },
  };
}

export function readSessionFromAttendanceRow(row: Record<string, unknown> | null | undefined, meta: Pick<AttendanceSessionMeta, 'program' | 'kind' | 'activity' | 'turmaId' | 'shift' | 'slot' | 'date'>): AttendanceSession | null {
  if (!row) return null;
  const key = sessionKey(meta);
  const session = record(record(record(row.marcacoes).__sessions)[key]);
  if (!session.assignmentId || !session.date) return null;
  return readAttendanceSessions({ __sessions: { [key]: session } })[0] ?? null;
}
