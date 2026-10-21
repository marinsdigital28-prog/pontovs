import { NextResponse } from 'next/server';
import { loadHolidayOverrides } from '@/lib/holiday-store';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { appendAuditEvent } from '@/lib/security-controls';
import { detectInconsistencies, extractAutoKey } from '@/lib/inconsistency-detector';
import { resolveDaySchedule } from '@/lib/day-schedule';
import { brazilDateKey } from '@/lib/brazil-time';
import { isPeriodClosed } from '@/lib/period-closure';
import { createManualInclusion } from '@/lib/punch-correction';
import { parseManualTimestamp } from '@/lib/manual-punch';
import { brazilDayKey, brazilMinutes, clockToMinutes, historySamples, overallConfidence, parseInformedTime, suggestMissingTime, type PunchKind } from '@/lib/forgotten-suggestion';
import { CONFIRM_TYPE, parseConfirmDetails, resolveAutoKey } from '@/lib/forgotten-resolve';

export const dynamic = 'force-dynamic';
const ORDER: PunchKind[] = ['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA'];
const TYPE_LABEL: Record<string, string> = { ENTRADA: 'Entrada', INTERVALO: 'Saída intervalo', RETORNO: 'Retorno intervalo', SAIDA: 'Saída' };

async function requireManager() {
  const session = await getServerSession(authOptions as any) as any;
  const id = session?.user?.id as string | undefined;
  if (!id || !['ADMIN', 'MANAGER'].includes(String(session?.user?.role))) return null;
  return prisma.user.findFirst({ where: { id, active: true, role: { in: ['ADMIN', 'MANAGER'] } }, select: { id: true, name: true } });
}
function shiftDay(key: string, days: number) { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
function phoneOf(profileJson: string | null | undefined) { try { return String(JSON.parse(profileJson || '{}')?.phone || '') || null; } catch { return null; } }

export async function GET(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso administrativo necessário.' }, { status: 401 });
  const url = new URL(request.url);
  const today = brazilDateKey();
  const yesterday = shiftDay(today, -1);
  const fromKey = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('from') || '') ? url.searchParams.get('from')! : `${yesterday.slice(0, 7)}-01`;
  const toKey = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('to') || '') ? url.searchParams.get('to')! : yesterday;
  const from = new Date(`${fromKey}T00:00:00-03:00`);
  const to = new Date(`${toKey}T23:59:59.999-03:00`);
  const historyFrom = new Date(`${shiftDay(fromKey, -21)}T00:00:00-03:00`);
  const todayEnd = new Date(`${today}T23:59:59.999-03:00`);

  const employees = await prisma.user.findMany({ where: { role: 'EMPLOYEE', active: true }, select: { id: true, name: true, employeeNumber: true, jobTitle: true, workDays: true, scheduleStart: true, scheduleEnd: true, scheduleByDay: true, profileJson: true }, orderBy: { name: 'asc' }, take: 1000 });
  const ids = employees.map((e) => e.id);
  const [punches, certificates, approved, resolved, forgotRequests, confirmRequests] = await Promise.all([
    prisma.punch.findMany({ where: { userId: { in: ids }, timestamp: { gte: historyFrom, lte: todayEnd } }, select: { id: true, userId: true, type: true, timestamp: true, status: true, origin: true }, orderBy: { timestamp: 'asc' }, take: 50000 }),
    prisma.medicalCertificate.findMany({ where: { userId: { in: ids }, startDate: { lte: todayEnd }, endDate: { gte: from }, status: { in: ['APROVADO', 'ATIVO'] } }, select: { userId: true, startDate: true, endDate: true, status: true, type: true }, take: 5000 }),
    prisma.employeeRequest.findMany({ where: { employeeId: { in: ids }, startDate: { lte: todayEnd }, endDate: { gte: from }, status: 'APROVADO', type: { in: ['AUSENCIA', 'TROCA_DIA'] } }, select: { employeeId: true, startDate: true, endDate: true, status: true, type: true }, take: 5000 }),
    prisma.inconsistency.findMany({ where: { status: 'RESOLVED', userId: { in: ids } }, select: { description: true }, take: 20000 }),
    prisma.employeeRequest.findMany({ where: { employeeId: { in: ids }, type: 'ESQUECI_PONTO', status: 'PENDENTE' }, select: { id: true, employeeId: true, startDate: true, classification: true, details: true, reason: true, createdAt: true }, take: 2000 }),
    prisma.employeeRequest.findMany({ where: { employeeId: { in: ids }, type: CONFIRM_TYPE, status: { in: ['PENDENTE', 'CONTESTADO'] } }, select: { id: true, employeeId: true, startDate: true, status: true, details: true, createdAt: true }, take: 2000 }),
  ]);
  const resolvedKeys = new Set(resolved.map((r) => extractAutoKey(r.description || '')).filter(Boolean) as string[]);
  const valid = punches.filter((p) => p.status !== 'REJECTED');
  const byUser = new Map<string, typeof valid>();
  for (const p of valid) { const list = byUser.get(p.userId) || []; list.push(p); byUser.set(p.userId, list); }
  await loadHolidayOverrides();
  const detected = detectInconsistencies({ employees: employees as any, punches: valid.filter((p) => p.timestamp >= from && p.timestamp <= to) as any, exceptions: [...certificates, ...approved].map((i: any) => ({ userId: i.userId || i.employeeId, startDate: i.startDate, endDate: i.endDate, status: i.status, type: i.type })) as any, from: fromKey, to: toKey });

  type Item = any;
  const items = new Map<string, Item>();
  const empById = new Map(employees.map((e) => [e.id, e]));
  const dayKeyOf = (d: Date) => brazilDayKey(d);
  const scheduleFor = (emp: any, date: string) => resolveDaySchedule(emp.scheduleByDay, emp.workDays, emp.scheduleStart, emp.scheduleEnd, new Date(`${date}T12:00:00Z`).getUTCDay(), emp.employeeNumber);

  function build(emp: any, date: string, missing: string[], kind: string, key: string, informed: Record<string, string | null> = {}) {
    const history = (byUser.get(emp.id) || []).map((p) => ({ type: p.type, timestamp: p.timestamp }));
    const schedule = scheduleFor(emp, date);
    const actual = (byUser.get(emp.id) || []).filter((p) => dayKeyOf(p.timestamp) === date).map((p) => ({ id: p.id, type: p.type, time: `${String(Math.floor(brazilMinutes(p.timestamp) / 60)).padStart(2, '0')}:${String(brazilMinutes(p.timestamp) % 60).padStart(2, '0')}`, manual: p.origin === 'ADJUSTED' }));
    const sortedMissing = ORDER.filter((t) => missing.includes(t));
    const suggestions = sortedMissing.map((type) => ({ type, label: TYPE_LABEL[type], ...(suggestMissingTime({ type, date, informedTime: informed[type] || null, history, schedule: schedule as any }) || { time: '', confidence: 'BAIXA', source: 'JORNADA', detail: 'Sem base para sugerir' }) }));
    const context = ORDER.map((type) => { const s = historySamples(history, type, date); return { type, samples: s.length, times: s.slice(0, 10).map((m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`) }; });
    let confidence = overallConfidence(suggestions.map((s) => (s.time ? (s as any) : null)));
    // Sanidade cronológica: se a sugestão ficar fora de ordem com as batidas reais, rebaixa.
    const all = [...actual.map((a) => ({ type: a.type, minutes: clockToMinutes(a.time)! })), ...suggestions.filter((s) => s.time).map((s) => ({ type: s.type, minutes: clockToMinutes(s.time)! }))];
    const ordered = [...all].sort((a, b) => ORDER.indexOf(a.type as any) - ORDER.indexOf(b.type as any)).every((p, i, arr) => i === 0 || p.minutes > arr[i - 1].minutes);
    if (!ordered) confidence = 'BAIXA';
    return { key, kind, userId: emp.id, date, weekday: new Date(`${date}T12:00:00Z`).getUTCDay(), user: { id: emp.id, name: emp.name, employeeNumber: emp.employeeNumber, jobTitle: emp.jobTitle, hasPhone: Boolean(phoneOf(emp.profileJson)) }, schedule, actualPunches: actual, missing: suggestions, confidence, ordered, context, requestIds: [] as string[], informedNote: null as string | null, awaiting: null as any };
  }

  for (const issue of detected) {
    if (!issue.missingTypes?.length || resolvedKeys.has(issue.key)) continue;
    const emp = empById.get(issue.userId); if (!emp) continue;
    const isAbsence = String(issue.type).includes('ABSENCE');
    const built = build(emp, issue.date, issue.missingTypes, isAbsence ? 'AUSENCIA' : 'INCONSISTENCIA', issue.key);
    // Dia sem nenhuma batida: nunca é "confiança alta" (não entra no lote) — pode ser falta ou atestado.
    if (isAbsence) built.confidence = 'BAIXA';
    items.set(`${issue.userId}|${issue.date}`, built);
  }
  // Pedidos ESQUECI_PONTO pendentes: o colaborador informou o horário.
  for (const req of forgotRequests) {
    const emp = empById.get(req.employeeId); if (!emp) continue;
    const date = brazilDateKey(req.startDate);
    const type = String(req.classification || '').toUpperCase();
    if (!ORDER.includes(type as PunchKind)) continue;
    const slot = `${emp.id}|${date}`;
    const current = items.get(slot);
    const informed: Record<string, string | null> = { ...(current?._informed || {}), [type]: parseInformedTime(req.details) };
    const missing = Array.from(new Set([...(current?.missing.map((m: any) => m.type) || []), type]));
    const item = build(emp, date, missing, 'PEDIDO', current?.key || `${emp.id}|${date}|MISSING_PUNCHES`, informed);
    item.kind = current ? current.kind : 'PEDIDO';
    item.requestIds = [...(current?.requestIds || []), req.id];
    item.informedNote = req.reason || null;
    (item as any)._informed = informed;
    items.set(slot, item);
  }
  // Saídas pendentes de hoje (passou 30 min do fim da jornada).
  const nowMinutes = brazilMinutes(new Date());
  for (const emp of employees) {
    const schedule = scheduleFor(emp, today) as any;
    const end = clockToMinutes(schedule?.end);
    if (end === null || nowMinutes < end + 30) continue;
    const day = (byUser.get(emp.id) || []).filter((p) => dayKeyOf(p.timestamp) === today);
    if (!day.length || day.some((p) => p.type === 'SAIDA')) continue;
    const slot = `${emp.id}|${today}`;
    if (items.has(slot)) continue;
    const key = `${emp.id}|${today}|MISSING_PUNCHES`;
    if (resolvedKeys.has(key)) continue;
    items.set(slot, build(emp, today, ['SAIDA'], 'SAIDA_PENDENTE', key));
  }
  // Pedidos de confirmação já enviados ao colaborador.
  for (const c of confirmRequests) {
    const slot = `${c.employeeId}|${brazilDateKey(c.startDate)}`;
    const item = items.get(slot); if (!item) continue;
    const details = parseConfirmDetails(c.details);
    item.awaiting = { requestId: c.id, status: c.status, sentAt: c.createdAt, correction: details?.correction || null, correctionNote: details?.correctionNote || null };
    if (c.status === 'CONTESTADO' && details?.correction?.length) {
      for (const m of item.missing) {
        const fix = details.correction.find((x) => x.type === m.type);
        if (fix) Object.assign(m, { time: fix.time, confidence: 'ALTA', source: 'COLABORADOR', detail: 'Corrigido pelo colaborador no app' });
      }
      item.confidence = overallConfidence(item.missing);
    }
  }
  const rank: Record<string, number> = { ALTA: 0, MEDIA: 1, BAIXA: 2 };
  const list = [...items.values()].map(({ _informed, ...rest }: any) => rest).sort((a, b) => (a.awaiting?.status === 'PENDENTE' ? 1 : 0) - (b.awaiting?.status === 'PENDENTE' ? 1 : 0) || (a.requestIds.length ? 0 : 1) - (b.requestIds.length ? 0 : 1) || rank[a.confidence] - rank[b.confidence] || a.date.localeCompare(b.date) || a.user.name.localeCompare(b.user.name, 'pt-BR'));
  return NextResponse.json({ from: fromKey, to: toKey, today, items: list, summary: { total: list.length, alta: list.filter((i) => i.confidence === 'ALTA' && !i.awaiting).length, aguardando: list.filter((i) => i.awaiting?.status === 'PENDENTE').length } });
}

const itemSchema = z.object({ key: z.string().min(3).max(300), userId: z.string().min(1), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), requestIds: z.array(z.string()).max(10).optional(), confirmRequestId: z.string().optional().nullable(), punches: z.array(z.object({ type: z.enum(['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA']), time: z.string().regex(/^\d{2}:\d{2}$/) })).max(4) });
const bodySchema = z.object({ action: z.enum(['ACCEPT', 'ABSENCE', 'CONFIRM']), reason: z.string().trim().min(5).max(500), sendWhatsapp: z.boolean().optional(), items: z.array(itemSchema).min(1).max(200) });

export async function POST(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso administrativo necessário.' }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Dados inválidos. Informe a justificativa (mínimo 5 caracteres).' }, { status: 400 });
  const { action, reason, items } = parsed.data;
  for (const p of Array.from(new Set(items.map((i) => i.date.slice(0, 7))))) if (await isPeriodClosed(p)) return NextResponse.json({ error: `O período ${p} está fechado. Reabra o fechamento para ajustar.` }, { status: 409 });
  if (action === 'ACCEPT' && items.some((i) => !i.punches.length)) return NextResponse.json({ error: 'Informe ao menos um horário por item.' }, { status: 400 });

  if (action === 'CONFIRM') {
    const created: any[] = [];
    await prisma.$transaction(async (tx) => {
      for (const item of items) {
        await tx.employeeRequest.updateMany({ where: { employeeId: item.userId, type: CONFIRM_TYPE, status: { in: ['PENDENTE', 'CONTESTADO'] }, startDate: new Date(`${item.date}T12:00:00.000Z`) }, data: { status: 'SUBSTITUIDO', reviewedAt: new Date(), reviewNote: 'Substituído por novo pedido de confirmação' } });
        const req = await tx.employeeRequest.create({ data: { id: crypto.randomUUID(), employeeId: item.userId, type: CONFIRM_TYPE, status: 'PENDENTE', startDate: new Date(`${item.date}T12:00:00.000Z`), endDate: new Date(`${item.date}T12:00:00.000Z`), reason, details: JSON.stringify({ punches: item.punches, issueKey: item.key, requestIds: item.requestIds || [] }), reviewerId: manager.id } as any, select: { id: true, employeeId: true } });
        created.push({ ...req, date: item.date, punches: item.punches });
      }
    });
    const users = await prisma.user.findMany({ where: { id: { in: created.map((c) => c.employeeId) } }, select: { id: true, name: true, profileJson: true } });
    const links = created.map((c) => { const u = users.find((x) => x.id === c.employeeId); const digits = (phoneOf(u?.profileJson) || '').replace(/\D/g, ''); const phone = digits.length >= 10 && digits.length <= 11 ? `55${digits}` : digits; const [y, m, d] = c.date.split('-'); const times = c.punches.map((p: any) => `${TYPE_LABEL[p.type]} ${p.time}`).join(', '); return { requestId: c.id, whatsapp: phone ? `https://wa.me/${phone}?text=${encodeURIComponent(`Olá ${(u?.name || '').split(' ')[0]}, aqui é da Administração do Espaço Progredir. Pode confirmar no app do ponto (Minhas solicitações) o horário de ${d}/${m}/${y}: ${times}?`)}` : null }; });
    for (const c of created) await appendAuditEvent({ action: 'CONFIRMACAO_HORARIO_SOLICITADA', actorId: manager.id, resource: 'EmployeeRequest', resourceId: c.id, metadata: { employeeId: c.employeeId, date: c.date, punches: c.punches, reason } } as any);
    return NextResponse.json({ ok: true, created: created.length, links });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const out: any[] = [];
      for (const item of items) {
        const user = await tx.user.findUnique({ where: { id: item.userId }, select: { id: true, unitId: true } as any }) as any;
        if (!user) throw new Error('USER_NOT_FOUND');
        const createdIds: string[] = [];
        if (action === 'ACCEPT') {
          for (const p of item.punches) {
            const created = await createManualInclusion(tx, { userId: item.userId, unitId: user.unitId ?? null, type: p.type, timestamp: parseManualTimestamp(item.date, p.time)!, managerId: manager.id, reason, source: item.requestIds?.length ? 'pedido_colaborador' : 'fila_esquecidas' });
            if (created) createdIds.push(created.id);
          }
        }
        await resolveAutoKey(tx, item.key, action === 'ABSENCE' ? `Falta confirmada: ${reason}` : reason, manager.id);
        if (item.requestIds?.length) await tx.employeeRequest.updateMany({ where: { id: { in: item.requestIds }, status: 'PENDENTE' }, data: action === 'ACCEPT' ? { status: 'APROVADO', reviewerId: manager.id, reviewedAt: new Date(), reviewNote: reason } : { status: 'REJEITADO', reviewerId: manager.id, reviewedAt: new Date(), reviewNote: `Falta confirmada: ${reason}` } });
        if (item.confirmRequestId) await tx.employeeRequest.updateMany({ where: { id: item.confirmRequestId, status: { in: ['PENDENTE', 'CONTESTADO'] } }, data: { status: 'SUBSTITUIDO', reviewedAt: new Date(), reviewNote: 'Resolvido pelo gestor na fila' } });
        out.push({ key: item.key, userId: item.userId, date: item.date, createdIds });
      }
      return out;
    });
    for (const r of result) await appendAuditEvent({ action: action === 'ACCEPT' ? 'MARCACAO_ESQUECIDA_INCLUIDA' : 'FALTA_CONFIRMADA', actorId: manager.id, resource: 'Punch', resourceId: r.createdIds[0] || r.key, metadata: { ...r, reason, bulk: items.length > 1 } } as any);
    return NextResponse.json({ ok: true, resolved: result.length, created: result.reduce((n, r) => n + r.createdIds.length, 0) });
  } catch (error) {
    console.error('forgotten queue resolve failed', error);
    return NextResponse.json({ error: 'Não foi possível resolver. Nada foi gravado.' }, { status: 500 });
  }
}
