/** Lançar atestado rápido — leitura do dia, prévia com o motor real da folha e gravação auditada. */
import prisma from './prisma';
import { withEffectiveTypes, setInterpretation } from './punch-interpretation';
import { buildTimesheetRows, type RowsCertificate } from './timesheet-rows';
import { resolveDaySchedule } from './day-schedule';
import { isScheduledDay, parseWorkDays } from './timesheet-schedule';
import { manualClientId } from './manual-punch';
import { appendAuditEvent } from './security-controls';
import { proposeDay, QUICK_KINDS, toMinutes, type Proposal, type QuickKind } from './atestado-rapido';

const TZ = 'America/Sao_Paulo';
const clockOf = (d: Date) => d.toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const keyOf = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ });

export type QuickInput = { employeeId: string; date: string; kind: QuickKind; partial: boolean; docStart?: string | null; docEnd?: string | null; leave?: string | null; back?: string | null; mode?: 'GAP' | 'DOC' };
export type DayNumbers = { worked: number | null; credited: number | null; justified: number; expected: number | null; balance: number | null; situation: string; cells: (string | null)[] };

const EMP_SELECT = { id: true, name: true, employeeNumber: true, cpf: true, jobTitle: true, workDays: true, scheduleStart: true, scheduleEnd: true, scheduleByDay: true, profileJson: true, unitId: true } as const;

/** Pedido do app (ausência) desse dia, ainda não lançado — é vinculado ao atestado. */
function requestRange(details: string | null) {
  const m = String(details || '').match(/(\d{2}:\d{2})\s*[–-]\s*(\d{2}:\d{2})/);
  return m ? { start: m[1], end: m[2] } : null;
}

export async function loadQuickDay(input: QuickInput) {
  const employee = await prisma.user.findUnique({ where: { id: input.employeeId }, select: EMP_SELECT });
  if (!employee) throw new Error('Funcionário não encontrado.');
  const month = input.date.slice(0, 7);
  const [yy, mm] = month.split('-').map(Number);
  const next = mm === 12 ? `${yy + 1}-01` : `${yy}-${String(mm + 1).padStart(2, '0')}`;
  const from = new Date(`${month}-01T00:00:00-03:00`), to = new Date(`${next}-01T00:00:00-03:00`);
  const [punches, certificates, requests, linkable, openPend] = await Promise.all([
    prisma.punch.findMany({ where: { userId: employee.id, status: 'VALID', timestamp: { gte: from, lt: to } }, select: { id: true, type: true, timestamp: true, origin: true }, orderBy: { timestamp: 'asc' } }).then(withEffectiveTypes),
    prisma.medicalCertificate.findMany({ where: { userId: employee.id, status: { not: 'CANCELADO' }, startDate: { lt: to }, endDate: { gte: from } }, select: { id: true, type: true, startDate: true, endDate: true, startTime: true, endTime: true, hoursPerDayMinutes: true, status: true, origin: true } }),
    prisma.employeeRequest.findMany({ where: { employeeId: employee.id, status: 'APROVADO', launchedAt: { not: null }, startDate: { lt: to }, endDate: { gte: from } }, select: { type: true, startDate: true, endDate: true, status: true, reason: true, classification: true, details: true, returnExpected: true, launchedAt: true } }),
    prisma.employeeRequest.findMany({ where: { employeeId: employee.id, type: 'AUSENCIA', status: { in: ['APROVADO', 'PENDENTE'] }, launchedAt: null, startDate: { lte: new Date(`${input.date}T23:59:59Z`) }, endDate: { gte: new Date(`${input.date}T00:00:00Z`) } }, select: { id: true, status: true, reason: true, details: true, classification: true, reviewedAt: true, createdAt: true } }),
    prisma.pendencia.findMany({ where: { userId: employee.id, date: input.date, status: 'OPEN' }, select: { id: true, kind: true, title: true } }),
  ]);
  const dayPunches = punches.filter((p) => keyOf(p.timestamp) === input.date);
  const weekday = new Date(`${input.date}T12:00:00Z`).getUTCDay();
  const daySchedule = resolveDaySchedule(employee.scheduleByDay, employee.workDays, employee.scheduleStart, employee.scheduleEnd, weekday, employee.employeeNumber);
  const codes = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
  const scheduled = Boolean(daySchedule) && isScheduledDay(employee.workDays ? parseWorkDays(employee.workDays) : new Set(['SEG', 'TER', 'QUA', 'QUI', 'SEX']), codes[weekday]);
  const link = linkable.find((r) => r.status === 'APROVADO') || linkable[0] || null;
  const range = link ? requestRange(link.details) : null;
  const kind = QUICK_KINDS[input.kind];
  const proposal = proposeDay({
    punches: dayPunches.map((p) => ({ id: p.id, type: p.type, time: clockOf(p.timestamp), manual: p.origin === 'ADJUSTED' })),
    scheduleStart: daySchedule?.start || employee.scheduleStart, scheduleEnd: daySchedule?.end || employee.scheduleEnd,
    partial: input.partial, docStart: input.docStart, docEnd: input.docEnd, requestStart: range?.start, requestEnd: range?.end,
    leave: input.leave, back: input.back, docLabel: kind.docLabel, mode: input.mode,
  });
  return { employee, month, punches, certificates, requests, dayPunches, daySchedule, scheduled, link, range, openPend, proposal };
}

function pickDay(rows: ReturnType<typeof buildTimesheetRows>['rows'], date: string): DayNumbers {
  const r = rows.find((x) => x.date === date)!;
  const c = (x: { time: string; manual: boolean } | null) => (x ? `${x.time}${x.manual ? '*' : ''}` : null);
  return { worked: r.worked, credited: r.credited, justified: r.justified, expected: r.expected, balance: r.balance, situation: r.situation, cells: [c(r.entrada), c(r.intervalo), c(r.retorno), c(r.saida)] };
}

export function certFor(input: QuickInput, proposal: Proposal) {
  const k = QUICK_KINDS[input.kind];
  return {
    type: input.partial ? k.partialType : k.fullType,
    startDate: new Date(`${input.date}T12:00:00.000Z`), endDate: new Date(`${input.date}T12:00:00.000Z`),
    startTime: input.partial ? proposal.abonoStart : null, endTime: input.partial ? proposal.abonoEnd : null,
    hoursPerDayMinutes: input.partial && proposal.abonoStart && proposal.abonoEnd ? (toMinutes(proposal.abonoEnd)! - toMinutes(proposal.abonoStart)!) : null,
    status: 'ATIVO', origin: 'TELA_RAPIDA',
  };
}

/** Prévia: dia e mês antes × depois, calculados pelo motor real (buildTimesheetRows) em memória. */
export async function previewQuick(input: QuickInput, today?: string) {
  const d = await loadQuickDay(input);
  const emp = d.employee;
  const before = buildTimesheetRows({ employee: emp, punches: d.punches, certificates: d.certificates as RowsCertificate[], requests: d.requests, month: d.month, today });
  const relabel = new Map(d.proposal.steps.filter((s) => s.kind === 'RELABEL').map((s) => [(s as any).punchId, (s as any).to]));
  const adds = d.proposal.steps.filter((s) => s.kind === 'ADD').map((s: any) => ({ id: `sim-${s.time}`, type: s.type, timestamp: new Date(`${input.date}T${s.time}:00-03:00`), origin: 'ADJUSTED' }));
  const simPunches = d.punches.map((p) => (relabel.has(p.id) ? { ...p, type: relabel.get(p.id)! } : p)).concat(adds as any).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const ok = d.proposal.steps.some((s) => s.kind === 'CERT') && (!input.partial || Boolean(d.proposal.abonoStart));
  const after = ok ? buildTimesheetRows({ employee: emp, punches: simPunches, certificates: [...d.certificates as RowsCertificate[], certFor(input, d.proposal)], requests: d.requests, month: d.month, today }) : before;
  return {
    ...d,
    before: { day: pickDay(before.rows, input.date), month: before.totals },
    after: { day: pickDay(after.rows, input.date), month: after.totals },
    ready: ok,
  };
}

export async function applyQuick(input: QuickInput & { observation?: string | null; documentName?: string | null; documentMime?: string | null; documentData?: string | null }, actorId: string, via = 'tela Lançar atestado') {
  const p = await previewQuick(input);
  if (!p.ready) throw new Error(p.proposal.warnings[0] || 'Proposta incompleta.');
  const k = QUICK_KINDS[input.kind];
  const docRange = input.partial && input.docStart && input.docEnd ? ` · documento ${input.docStart}–${input.docEnd}` : '';
  const reason = `Lançar atestado: ${k.docLabel}${docRange}`;
  const created: { punches: string[]; relabeled: string[]; certificateId: string | null; linkedRequestId: string | null; resolvedPendencias: string[] } = { punches: [], relabeled: [], certificateId: null, linkedRequestId: null, resolvedPendencias: [] };
  const cert = certFor(input, p.proposal);
  const observation = [k.docLabel + docRange, p.link ? `pedido do app ${p.link.id} vinculado` : null, input.observation || null].filter(Boolean).join(' · ');
  await prisma.$transaction(async (tx) => {
    // 1) lançamento do gestor (*) — nova marcação; nenhuma batida original é alterada
    for (const s of p.proposal.steps) {
      if (s.kind !== 'ADD') continue;
      const ts = new Date(`${input.date}T${s.time}:00-03:00`);
      const clientId = manualClientId(p.employee.id, input.date, s.time, s.type);
      const dup = await tx.punch.findFirst({ where: { OR: [{ clientId }, { userId: p.employee.id, status: 'VALID', timestamp: ts }] }, select: { id: true } });
      if (dup) throw new Error(`Já existe uma marcação às ${s.time} neste dia.`);
      const punch = await tx.punch.create({ data: { id: crypto.randomUUID(), userId: p.employee.id, unitId: p.employee.unitId, type: s.type, timestamp: ts, clientTimestamp: ts, status: 'VALID', origin: 'ADJUSTED', locationValid: false, clientId }, select: { id: true } });
      await tx.punchAudit.create({ data: { id: crypto.randomUUID(), punchId: punch.id, changedById: actorId, field: 'manual_create', oldValue: null, newValue: `${s.type} ${ts.toISOString()}`, reason } });
      created.punches.push(punch.id);
    }
    // 2) atestado (não rejeita nem esconde batidas)
    const c = await tx.medicalCertificate.create({ data: { userId: p.employee.id, createdById: actorId, type: cert.type, startDate: cert.startDate, endDate: cert.endDate, startTime: cert.startTime, endTime: cert.endTime, hoursPerDayMinutes: cert.hoursPerDayMinutes, daysCount: input.partial ? 0 : 1, documentName: input.documentName || null, documentMime: input.documentMime || null, documentData: input.documentData || null, observation, status: 'ATIVO', origin: 'TELA_RAPIDA' }, select: { id: true } });
    created.certificateId = c.id;
    // 3) pedido do app vinculado: conta como lançado (o atestado prevalece no cálculo; não abona em dobro)
    if (p.link && p.link.status === 'APROVADO') {
      await tx.employeeRequest.update({ where: { id: p.link.id }, data: { launchedAt: new Date(), launchedById: actorId } });
      created.linkedRequestId = p.link.id;
    }
    // 4) pendências abertas do dia ficam resolvidas pelo lançamento
    for (const pd of p.openPend) {
      await tx.pendencia.update({ where: { id: pd.id }, data: { status: 'RESOLVED', resolution: `Atestado lançado: ${k.docLabel} ${cert.startTime ? `${cert.startTime}–${cert.endTime}` : 'dia inteiro'}`, resolvedAt: new Date() } });
      created.resolvedPendencias.push(pd.id);
    }
  });
  // 5) reinterpretação das batidas originais (tipo efetivo; original preservado + PunchAudit)
  for (const s of p.proposal.steps) {
    if (s.kind !== 'RELABEL') continue;
    await setInterpretation({ punchId: s.punchId, type: s.to, source: 'GESTOR', actorId, reason });
    created.relabeled.push(s.punchId);
  }
  const event = await appendAuditEvent({
    action: 'ATESTADO_RAPIDO_LANCADO', actorId, resource: 'MedicalCertificate', resourceId: created.certificateId || undefined,
    metadata: { via, userId: p.employee.id, employeeNumber: p.employee.employeeNumber, date: input.date, kind: input.kind, partial: input.partial, docStart: input.docStart || null, docEnd: input.docEnd || null, abono: cert.startTime ? `${cert.startTime}–${cert.endTime}` : 'dia', steps: p.proposal.steps.map((s) => s.text), ...created, before: p.before.day, after: p.after.day },
  });
  return { ...created, auditId: event.id, before: p.before, after: p.after };
}
