/**
 * Pontinho — ações de escrita. O modelo só cria PROPOSTAS; a gravação acontece aqui,
 * depois do clique humano em "Confirmar", com as regras do sistema validadas no servidor:
 *  - atestado/declaração médica só com foto/documento anexado;
 *  - batida original nunca é alterada (só insere *, e só cancela batida criada por ajuste);
 *  - almoço (Intervalo/Retorno) sempre em horário redondo.
 */
import prisma from './prisma';
import { appendAuditEvent } from './security-controls';
import { isPeriodClosed, periodFromDate } from './period-closure';
import { label as typeLabel, roundLunchTime } from './day-guards';
import { insertAdjustedPunch } from './auto-close-server';
import { dateKeyOf, hmOf } from './auto-close';
import { isOriginal } from './punch-warnings';

export const MEDICAL_TYPES = new Set(['DIA_INTEGRAL', 'PERIODO_DIAS', 'HORAS', 'PERIODO_HORAS', 'CONSULTA_MEDICA', 'SAIDA_MEDICA']);
const HOURLY = new Set(['HORAS', 'PERIODO_HORAS', 'TRABALHO_EXTERNO_HORAS']);
export const ABSENCE_LABEL: Record<string, string> = { DIA_INTEGRAL: 'Atestado dia inteiro', PERIODO_DIAS: 'Atestado (período)', HORAS: 'Declaração por horas', TRABALHO_EXTERNO: 'Trabalho/Evento externo', TRABALHO_EXTERNO_HORAS: 'Trabalho externo (horas)', DIA_EXTRA: 'Dia extra (fora da escala)', OUTRO: 'Abono' };
const EXPIRES_MS = 15 * 60_000;
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const noonOf = (d: string) => new Date(`${d}T12:00:00.000Z`);

export type ProposalCard = { id: string; kind: string; title: string; employee: string; date: string; before: string[]; after: string[]; checks: { label: string; ok: boolean }[]; needsDocument: boolean };
type Created = { ok: true; card: ProposalCard } | { ok: false; error: string };

async function dayText(userId: string, date: string) {
  const from = new Date(`${date}T00:00:00-03:00`); const to = new Date(`${date}T23:59:59.999-03:00`);
  const [punches, certs] = await Promise.all([
    prisma.punch.findMany({ where: { userId, status: 'VALID', timestamp: { gte: from, lte: to } }, orderBy: { timestamp: 'asc' }, select: { type: true, timestamp: true, origin: true, clientId: true } }),
    prisma.medicalCertificate.findMany({ where: { userId, status: { in: ['ATIVO', 'APROVADO'] }, startDate: { lte: noonOf(date) }, endDate: { gte: noonOf(date) } }, select: { type: true, startTime: true, endTime: true } }),
  ]);
  const lines = punches.map((p) => `${hmOf(p.timestamp)} ${typeLabel(p.type)}${p.origin === 'ADJUSTED' && String(p.clientId || '').match(/^(manual|auto)-/) ? '*' : ''}`);
  const c = certs.map((x) => `${ABSENCE_LABEL[x.type] || x.type}${x.startTime ? ` ${x.startTime}–${x.endTime}` : ''}`);
  return { punches, lines: [lines.length ? lines.join(' · ') : 'sem batidas', ...(c.length ? [`Lançamentos: ${c.join(', ')}`] : [])] };
}

async function save(actorId: string, kind: string, payload: any, card: Omit<ProposalCard, 'id'>): Promise<Created> {
  const row = await prisma.assistantAction.create({ data: { actorId, kind, payloadJson: JSON.stringify(payload), summaryJson: JSON.stringify(card), expiresAt: new Date(Date.now() + EXPIRES_MS) } });
  await appendAuditEvent({ action: 'PONTINHO_PROPOSTA', actorId, resource: 'AssistantAction', resourceId: row.id, metadata: { kind, payload } });
  return { ok: true, card: { id: row.id, ...card } };
}

async function employee(id: string) {
  return prisma.user.findFirst({ where: { id, role: 'EMPLOYEE' }, select: { id: true, name: true, unitId: true } });
}

export async function proposeAddPunch(actorId: string, i: { colaboradorId: string; data: string; tipo: string; horario: string; motivo: string }): Promise<Created> {
  const emp = await employee(i.colaboradorId); if (!emp) return { ok: false, error: 'Colaborador não encontrado (use o id de buscarColaborador).' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.data) || !/^\d{2}:\d{2}$/.test(i.horario)) return { ok: false, error: 'Data (AAAA-MM-DD) ou horário (HH:MM) inválido.' };
  const time = ['INTERVALO', 'RETORNO'].includes(i.tipo) ? roundLunchTime(i.horario) : i.horario;
  const day = await dayText(emp.id, i.data);
  const exists = day.punches.some((p) => p.type === i.tipo);
  const closed = await isPeriodClosed(periodFromDate(new Date(`${i.data}T12:00:00-03:00`)));
  if (exists) return { ok: false, error: `Já existe ${typeLabel(i.tipo)} válida em ${ddmm(i.data)}. Batida original não é alterada; para trocar, use o Dia do colaborador.` };
  if (closed) return { ok: false, error: 'A competência está fechada.' };
  return save(actorId, 'ADD_PUNCH', { userId: emp.id, unitId: emp.unitId, date: i.data, type: i.tipo, time, reason: i.motivo }, {
    kind: 'ADD_PUNCH', title: `Ajuste de batida ${typeLabel(i.tipo)} ${time}*`, employee: emp.name, date: i.data,
    before: day.lines, after: [...day.lines.slice(0, 1).map((l) => `${l} + ${time} ${typeLabel(i.tipo)}*`), `Motivo: ${i.motivo}`],
    checks: [{ label: 'batidas originais intactas', ok: true }, { label: 'sem duplicata', ok: true }, ...(['INTERVALO', 'RETORNO'].includes(i.tipo) ? [{ label: `almoço redondo (${time})`, ok: true }] : [])],
    needsDocument: false,
  });
}

export async function proposeCancelAdjusted(actorId: string, i: { batidaId: string; motivo: string }): Promise<Created> {
  const p = await prisma.punch.findUnique({ where: { id: i.batidaId }, select: { id: true, userId: true, type: true, timestamp: true, status: true, origin: true, clientId: true, photoData: false } });
  if (!p || p.status !== 'VALID') return { ok: false, error: 'Batida não encontrada ou já cancelada.' };
  const hasPhoto = Boolean(await prisma.punch.findFirst({ where: { id: p.id, photoData: { not: null } }, select: { id: true } }));
  if (isOriginal({ ...p, hasPhoto })) return { ok: false, error: 'Essa é uma batida ORIGINAL do colaborador (Portaria 671): não pode ser cancelada pelo Pontinho.' };
  const emp = await employee(p.userId); const date = dateKeyOf(p.timestamp);
  const day = await dayText(p.userId, date);
  return save(actorId, 'CANCEL_ADJUSTED_PUNCH', { punchId: p.id, reason: i.motivo }, {
    kind: 'CANCEL_ADJUSTED_PUNCH', title: `Cancelar ajuste ${typeLabel(p.type)} ${hmOf(p.timestamp)}*`, employee: emp?.name || '—', date,
    before: day.lines, after: [`${typeLabel(p.type)} ${hmOf(p.timestamp)}* cancelada (registro guardado)`, `Motivo: ${i.motivo}`],
    checks: [{ label: 'só ajuste (*), nunca original', ok: true }], needsDocument: false,
  });
}

export async function proposeAbsence(actorId: string, i: { colaboradorId: string; tipo: string; dataInicio: string; dataFim?: string | null; horaInicio?: string | null; horaFim?: string | null; observacao?: string | null }): Promise<Created> {
  const emp = await employee(i.colaboradorId); if (!emp) return { ok: false, error: 'Colaborador não encontrado (use o id de buscarColaborador).' };
  const hourly = HOURLY.has(i.tipo);
  const end = hourly ? i.dataInicio : (i.dataFim || i.dataInicio);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.dataInicio) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < i.dataInicio) return { ok: false, error: 'Datas inválidas.' };
  if (hourly && !(i.horaInicio && i.horaFim && i.horaFim > i.horaInicio)) return { ok: false, error: 'Informe hora inicial e final.' };
  const overlap = await prisma.medicalCertificate.findMany({ where: { userId: emp.id, status: { not: 'CANCELADO' }, startDate: { lte: noonOf(end) }, endDate: { gte: noonOf(i.dataInicio) } }, select: { id: true, type: true } });
  const day = await dayText(emp.id, i.dataInicio);
  const needsDocument = MEDICAL_TYPES.has(i.tipo);
  const period = i.dataInicio === end ? ddmm(i.dataInicio) : `${ddmm(i.dataInicio)} a ${ddmm(end)}`;
  return save(actorId, 'LANCAR_AUSENCIA', { userId: emp.id, type: i.tipo, startDate: i.dataInicio, endDate: end, startTime: hourly ? i.horaInicio : null, endTime: hourly ? i.horaFim : null, observation: i.observacao || null, overlapIds: overlap.map((o) => o.id) }, {
    kind: 'LANCAR_AUSENCIA', title: `${ABSENCE_LABEL[i.tipo] || i.tipo} · ${period}${hourly ? ` ${i.horaInicio}–${i.horaFim}` : ''}`, employee: emp.name, date: i.dataInicio,
    before: day.lines, after: [`${ABSENCE_LABEL[i.tipo] || i.tipo}${hourly ? ` ${i.horaInicio}–${i.horaFim}` : ' (dia abonado)'}`, ...(i.observacao ? [`Obs.: ${i.observacao}`] : [])],
    checks: [{ label: overlap.length ? `sobrepõe ${overlap.length} lançamento(s): use Substituir no Dia do colaborador` : 'sem sobreposição', ok: !overlap.length }, { label: 'batidas originais intactas', ok: true }, ...(needsDocument ? [{ label: 'anexar foto do atestado (obrigatório)', ok: false }] : [])],
    needsDocument,
  });
}

export async function proposeRemoveAbsence(actorId: string, i: { lancamentoId: string; motivo: string }): Promise<Created> {
  const c = await prisma.medicalCertificate.findUnique({ where: { id: i.lancamentoId }, select: { id: true, userId: true, type: true, startDate: true, endDate: true, startTime: true, endTime: true, status: true } });
  if (!c || c.status === 'CANCELADO') return { ok: false, error: 'Lançamento não encontrado ou já cancelado.' };
  const emp = await employee(c.userId); const date = c.startDate.toISOString().slice(0, 10);
  const day = await dayText(c.userId, date);
  return save(actorId, 'CANCEL_CERTIFICATE', { certificateId: c.id, reason: i.motivo }, {
    kind: 'CANCEL_CERTIFICATE', title: `Remover ${ABSENCE_LABEL[c.type] || c.type}`, employee: emp?.name || '—', date,
    before: day.lines, after: ['Lançamento cancelado (registro guardado)', `Motivo: ${i.motivo}`], checks: [{ label: 'histórico preservado', ok: true }], needsDocument: false,
  });
}

export async function proposeLaunchRequest(actorId: string, i: { pedidoId: string }): Promise<Created> {
  const r = await prisma.employeeRequest.findUnique({ where: { id: i.pedidoId }, select: { id: true, employeeId: true, status: true, launchedAt: true, reason: true, startDate: true, type: true } });
  if (!r) return { ok: false, error: 'Pedido não encontrado.' };
  if (r.status !== 'APROVADO') return { ok: false, error: 'Só pedido APROVADO pode ser lançado na folha. Aprove em Solicitações.' };
  if (r.launchedAt) return { ok: false, error: 'Este pedido já está lançado na folha.' };
  const emp = await employee(r.employeeId); const date = dateKeyOf(r.startDate);
  return save(actorId, 'LAUNCH_REQUEST', { requestId: r.id }, {
    kind: 'LAUNCH_REQUEST', title: `Lançar na folha: ${r.reason}`, employee: emp?.name || '—', date,
    before: ['Pedido aprovado, fora da folha'], after: ['Pedido passa a contar na folha'], checks: [{ label: 'pedido aprovado', ok: true }], needsDocument: false,
  });
}

/** Executa a proposta (clique humano em Confirmar). */
export async function confirmAction(id: string, actorId: string, doc?: { name: string; mime: string; data: string } | null) {
  const a = await prisma.assistantAction.findUnique({ where: { id } });
  if (!a || a.actorId !== actorId) throw new Error('Proposta não encontrada.');
  if (a.status !== 'PROPOSTA') throw new Error('Esta proposta já foi decidida.');
  if (a.expiresAt < new Date()) { await prisma.assistantAction.update({ where: { id }, data: { status: 'EXPIRADA', decidedAt: new Date() } }); throw new Error('Proposta expirada (15 min). Peça de novo ao Pontinho.'); }
  const p = JSON.parse(a.payloadJson);
  let result: any = {};
  try {
    if (a.kind === 'ADD_PUNCH') {
      const time = ['INTERVALO', 'RETORNO'].includes(p.type) ? roundLunchTime(p.time) : p.time;
      const r = await insertAdjustedPunch({ userId: p.userId, unitId: p.unitId, date: p.date, punch: { type: p.type, time }, actorId, reason: `${p.reason} (Pontinho, confirmado pelo gestor)`, track: false });
      result = { punchId: r.punch.id };
    } else if (a.kind === 'CANCEL_ADJUSTED_PUNCH') {
      const punch = await prisma.punch.findUnique({ where: { id: p.punchId }, select: { id: true, status: true, origin: true, clientId: true, timestamp: true, type: true } });
      if (!punch || punch.status !== 'VALID') throw new Error('Batida já cancelada.');
      const hasPhoto = Boolean(await prisma.punch.findFirst({ where: { id: punch.id, photoData: { not: null } }, select: { id: true } }));
      if (isOriginal({ ...punch, hasPhoto })) throw new Error('Batida original não pode ser cancelada.');
      if (await isPeriodClosed(periodFromDate(punch.timestamp))) throw new Error('Competência fechada.');
      await prisma.$transaction([
        prisma.punch.update({ where: { id: punch.id }, data: { status: 'REJECTED' } }),
        prisma.punchAudit.create({ data: { id: crypto.randomUUID(), punchId: punch.id, changedById: actorId, field: 'status', oldValue: 'VALID', newValue: 'REJECTED', reason: `${p.reason} (Pontinho)` } }),
      ]);
      await prisma.autoAdjustment.updateMany({ where: { punchId: punch.id, status: 'ACTIVE' }, data: { status: 'UNDONE', undoneAt: new Date(), undoneById: actorId, undoReason: p.reason } });
      result = { punchId: punch.id };
    } else if (a.kind === 'LANCAR_AUSENCIA') {
      if (MEDICAL_TYPES.has(p.type)) {
        if (!doc?.data || !['image/jpeg', 'image/png', 'application/pdf'].includes(doc.mime)) throw new Error('Atestado só com a foto/documento anexado (JPG, PNG ou PDF).');
        if (doc.data.length > 14_000_000) throw new Error('Arquivo muito grande.');
      }
      const startDate = noonOf(p.startDate); const endDate = noonOf(p.endDate);
      const overlap = await prisma.medicalCertificate.count({ where: { userId: p.userId, status: { not: 'CANCELADO' }, startDate: { lte: endDate }, endDate: { gte: startDate } } });
      if (overlap) throw new Error('Já existe abono/atestado neste período. Use "Substituir" no Dia do colaborador.');
      const hourly = HOURLY.has(p.type);
      const [sh, sm] = String(p.startTime || '0:0').split(':').map(Number); const [eh, em] = String(p.endTime || '0:0').split(':').map(Number);
      const cert = await prisma.medicalCertificate.create({ data: {
        userId: p.userId, createdById: actorId, type: p.type, startDate, endDate, startTime: hourly ? p.startTime : null, endTime: hourly ? p.endTime : null,
        hoursPerDayMinutes: hourly ? (eh * 60 + em) - (sh * 60 + sm) : null, daysCount: hourly ? 0 : Math.floor((+endDate - +startDate) / 86_400_000) + 1,
        documentName: doc?.name?.slice(0, 180) || null, documentMime: doc?.mime || null, documentData: doc?.data || null, observation: p.observation ? `${p.observation} (Pontinho)` : 'Lançado pelo Pontinho', status: 'ATIVO',
      }, select: { id: true } });
      await appendAuditEvent({ action: 'CERTIFICATE_CREATED', actorId, resource: 'MedicalCertificate', resourceId: cert.id, metadata: { type: p.type, userId: p.userId, startDate: p.startDate, endDate: p.endDate, via: 'pontinho', hasDocument: Boolean(doc?.data) } });
      result = { certificateId: cert.id };
    } else if (a.kind === 'CANCEL_CERTIFICATE') {
      const c = await prisma.medicalCertificate.findUnique({ where: { id: p.certificateId }, select: { id: true, status: true } });
      if (!c || c.status === 'CANCELADO') throw new Error('Lançamento já cancelado.');
      await prisma.medicalCertificate.update({ where: { id: c.id }, data: { status: 'CANCELADO', canceledAt: new Date(), canceledById: actorId, cancelReason: `${p.reason} (Pontinho)` } });
      await appendAuditEvent({ action: 'CERTIFICATE_CANCELED', actorId, resource: 'MedicalCertificate', resourceId: c.id, metadata: { reason: p.reason, via: 'pontinho' } });
      result = { certificateId: c.id };
    } else if (a.kind === 'LAUNCH_REQUEST') {
      const r = await prisma.employeeRequest.findUnique({ where: { id: p.requestId } });
      if (!r || r.status !== 'APROVADO') throw new Error('Pedido não está aprovado.');
      if (!r.launchedAt) await prisma.employeeRequest.update({ where: { id: r.id }, data: { launchedAt: new Date(), launchedById: actorId } });
      await appendAuditEvent({ action: 'SOLICITACAO_LANCADA_NA_FOLHA', actorId, resource: 'EmployeeRequest', resourceId: r.id, metadata: { via: 'pontinho' } });
      result = { requestId: r.id };
    } else throw new Error('Tipo de proposta desconhecido.');
  } catch (error) {
    await prisma.assistantAction.update({ where: { id }, data: { status: 'ERRO', decidedAt: new Date(), resultJson: JSON.stringify({ error: (error as Error).message }) } });
    await appendAuditEvent({ action: 'PONTINHO_ERRO', actorId, resource: 'AssistantAction', resourceId: id, metadata: { kind: a.kind, error: (error as Error).message } });
    throw error;
  }
  await prisma.assistantAction.update({ where: { id }, data: { status: 'CONFIRMADA', decidedAt: new Date(), resultJson: JSON.stringify(result) } });
  await appendAuditEvent({ action: 'PONTINHO_CONFIRMADO', actorId, resource: 'AssistantAction', resourceId: id, metadata: { kind: a.kind, payload: { ...p }, result } });
  return result;
}

export async function cancelAction(id: string, actorId: string) {
  const a = await prisma.assistantAction.findUnique({ where: { id } });
  if (!a || a.actorId !== actorId || a.status !== 'PROPOSTA') throw new Error('Proposta não encontrada.');
  await prisma.assistantAction.update({ where: { id }, data: { status: 'CANCELADA', decidedAt: new Date() } });
  await appendAuditEvent({ action: 'PONTINHO_CANCELADO', actorId, resource: 'AssistantAction', resourceId: id, metadata: { kind: a.kind } });
}
