/**
 * Aviso de batida esquecida no momento de bater o ponto (totem/app).
 * Usa só as batidas ORIGINAIS do colaborador (o ajuste * do gestor não apaga o esquecimento).
 * Nunca bloqueia a marcação: é só um aviso com "Ciente" + comprovante.
 */
import prisma from './prisma';
import { brazilDateKey } from './brazil-time';
import { evaluateDay, hmOf, type ACPunch } from './auto-close';
import { label as typeLabel } from './day-guards';

export const LOOKBACK_DAYS = 7;
const WEEKDAY = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const lower = (t: string) => ({ ENTRADA: 'a entrada', INTERVALO: 'a saída para o intervalo', RETORNO: 'a volta do intervalo', SAIDA: 'a saída' } as Record<string, string>)[t] || typeLabel(t);

export function dayName(date: string, today: string) {
  const diff = Math.round((+new Date(`${today}T12:00:00Z`) - +new Date(`${date}T12:00:00Z`)) / 86_400_000);
  if (diff === 1) return 'ontem';
  return WEEKDAY[new Date(`${date}T12:00:00Z`).getUTCDay()];
}

export function isOriginal(p: { origin?: string | null; clientId?: string | null; hasPhoto: boolean }) {
  const cid = String(p.clientId || '');
  return !(cid.startsWith('manual-') || cid.startsWith('auto-') || (p.origin === 'ADJUSTED' && !p.hasPhoto));
}

type Emp = Parameters<typeof evaluateDay>[0]['employee'];
export type ComputedWarning = { issueDate: string; message: string; missing: { type: string; time: string | null }[] };

/** Pura: avisos para os dias anteriores (até 7) e para hoje (intervalo sem volta há mais de 3 h). */
export function computeWarnings({ employee, punches, certificates, requests, today, now }: { employee: Emp; punches: ACPunch[]; certificates: any[]; requests: any[]; today: string; now: Date }): ComputedWarning[] {
  const out: ComputedWarning[] = [];
  for (let i = LOOKBACK_DAYS; i >= 1; i -= 1) {
    const date = brazilDateKey(new Date(+new Date(`${today}T12:00:00-03:00`) - i * 86_400_000));
    const day = punches.filter((p) => isOriginal(p) && brazilDateKey(new Date(p.timestamp)) === date);
    const d = evaluateDay({ employee, date, punches: day, certificates, requests: [], phase: 'COMPLETO' });
    if (!d.forgotten) continue;
    // Se ele mesmo já avisou pelo app ("esqueci de bater") para este dia, não precisa avisar de novo.
    if (requests.some((r) => r.type === 'ESQUECI_PONTO' && brazilDateKey(new Date(r.startDate)) <= date && brazilDateKey(new Date(r.endDate)) >= date)) continue;
    const when = `${dayName(date, today)} (${ddmm(date)})`;
    let missing: ComputedWarning['missing'] = [];
    if (d.proposal) missing = [{ type: d.proposal.type, time: d.proposal.time }];
    else if (d.pendencia?.suggestion?.kind === 'INSERT_PUNCHES') missing = d.pendencia.suggestion.punches.map((p) => ({ type: p.type, time: p.time }));
    const message = missing.length
      ? `Você esqueceu ${missing.map((m) => `${lower(m.type)}${m.time ? ` (previsto ${m.time})` : ''}`).join(' e ')} de ${when}.`
      : d.pendencia?.kind === 'TIPO_ERRADO'
        ? `Seu ponto de ${when} ficou com batida no tipo errado (marcou: ${d.punchesText}).`
        : `Seu ponto de ${when} ficou incompleto (marcou: ${d.punchesText}).`;
    out.push({ issueDate: date, message, missing });
  }
  const todays = punches.filter((p) => isOriginal(p) && p.status === 'VALID' && brazilDateKey(new Date(p.timestamp)) === today).sort((a, b) => +new Date(a.timestamp) - +new Date(b.timestamp));
  const last = todays[todays.length - 1];
  if (last && last.type === 'INTERVALO' && !todays.some((p) => p.type === 'RETORNO') && +now - +new Date(last.timestamp) > 3 * 3600_000) {
    out.push({ issueDate: today, message: `Você não marcou a volta do intervalo de hoje (saída para o intervalo às ${hmOf(last.timestamp)}). Se está indo embora agora, marque Saída.`, missing: [{ type: 'RETORNO', time: null }] });
  }
  return out;
}

export async function loadAndComputeWarnings(employee: Emp & { id: string }, now = new Date()) {
  const today = brazilDateKey(now);
  const from = new Date(+new Date(`${today}T00:00:00-03:00`) - LOOKBACK_DAYS * 86_400_000);
  const noonFrom = new Date(`${brazilDateKey(from)}T12:00:00.000Z`);
  const [punches, photos, certificates, requests] = await Promise.all([
    prisma.punch.findMany({ where: { userId: employee.id, timestamp: { gte: from } }, select: { id: true, type: true, timestamp: true, status: true, origin: true, clientId: true } }),
    prisma.punch.findMany({ where: { userId: employee.id, timestamp: { gte: from }, photoData: { not: null } }, select: { id: true } }),
    prisma.medicalCertificate.findMany({ where: { userId: employee.id, endDate: { gte: noonFrom } }, select: { id: true, type: true, startDate: true, endDate: true, startTime: true, endTime: true, status: true } }),
    prisma.employeeRequest.findMany({ where: { employeeId: employee.id, endDate: { gte: from }, status: { in: ['PENDENTE', 'APROVADO'] } }, select: { type: true, startDate: true, endDate: true } }),
  ]);
  const ph = new Set(photos.map((p) => p.id));
  return computeWarnings({ employee, punches: punches.map((p) => ({ ...p, hasPhoto: ph.has(p.id) })), certificates, requests, today, now });
}

type HistoryEvent = { at: string; event: 'SHOWN' | 'ACK'; source: string };
export function appendHistory(raw: string | null | undefined, ev: HistoryEvent) {
  let list: HistoryEvent[] = [];
  try { list = raw ? JSON.parse(raw) : []; } catch { list = []; }
  list.push(ev);
  return JSON.stringify(list.slice(-50));
}
