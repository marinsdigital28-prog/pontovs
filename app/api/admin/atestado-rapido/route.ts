import { NextResponse } from 'next/server';
import { requireManager } from '@/lib/admin-guard';
import { consumeRateLimit, getRequestKey, rateLimitResponse } from '@/lib/security-controls';
import { isPeriodClosed, periodFromDate } from '@/lib/period-closure';
import { applyQuick, previewQuick, type QuickInput } from '@/lib/atestado-rapido-server';
import { isQuickKind, punchLabel } from '@/lib/atestado-rapido';

export const dynamic = 'force-dynamic';
const DATE = /^\d{4}-\d{2}-\d{2}$/; const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const okTime = (v: unknown) => (typeof v === 'string' && HM.test(v) ? v : null);

function parse(src: Record<string, unknown>): QuickInput | string {
  const employeeId = String(src.employeeId || '').trim(); const date = String(src.date || '').trim(); const kind = String(src.kind || 'ATESTADO_MEDICO');
  if (!employeeId) return 'Escolha o funcionário.';
  if (!DATE.test(date)) return 'Data inválida.';
  if (!isQuickKind(kind)) return 'Tipo de documento inválido.';
  const partial = String(src.partial ?? 'true') !== 'false';
  return { employeeId, date, kind, partial, docStart: okTime(src.docStart), docEnd: okTime(src.docEnd), leave: okTime(src.leave), back: okTime(src.back), mode: src.mode === 'DOC' ? 'DOC' : 'GAP' };
}
function view(p: Awaited<ReturnType<typeof previewQuick>>) {
  const TZ = 'America/Sao_Paulo';
  return {
    employee: { id: p.employee.id, name: p.employee.name, employeeNumber: p.employee.employeeNumber, jobTitle: p.employee.jobTitle },
    schedule: p.daySchedule ? `${p.daySchedule.start}–${p.daySchedule.end}` : null, scheduled: p.scheduled,
    punches: p.dayPunches.map((x: any) => ({ id: x.id, time: x.timestamp.toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }), type: x.type, label: punchLabel(x.type), originalType: x.originalType || x.type, manual: x.origin === 'ADJUSTED' })),
    link: p.link ? { id: p.link.id, status: p.link.status, reason: p.link.reason, details: p.link.details, reviewedAt: p.link.reviewedAt } : null,
    openPendencias: p.openPend, proposal: p.proposal, before: p.before, after: p.after, ready: p.ready,
  };
}

export async function GET(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 401 });
  const q = Object.fromEntries(new URL(request.url).searchParams.entries());
  const input = parse(q);
  if (typeof input === 'string') return NextResponse.json({ error: input }, { status: 400 });
  try { return NextResponse.json(view(await previewQuick(input))); }
  catch (e) { return NextResponse.json({ error: (e as Error).message || 'Não foi possível ler o dia.' }, { status: 400 }); }
}

export async function POST(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 401 });
  const rate = await consumeRateLimit(getRequestKey(request, 'admin-atestado-rapido', manager.id), 20, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 });
  const input = parse(body);
  if (typeof input === 'string') return NextResponse.json({ error: input }, { status: 400 });
  if (await isPeriodClosed(periodFromDate(new Date(`${input.date}T12:00:00-03:00`)))) return NextResponse.json({ error: 'A competência desta data está fechada.' }, { status: 423 });
  const doc = typeof body.documentData === 'string' && body.documentData.length <= 14_000_000 ? body.documentData : null;
  const mime = typeof body.documentMime === 'string' && ['application/pdf', 'image/jpeg', 'image/png'].includes(body.documentMime) ? body.documentMime : null;
  try {
    const result = await applyQuick({ ...input, observation: typeof body.observation === 'string' ? body.observation.slice(0, 500) : null, documentName: doc && mime ? String(body.documentName || 'documento').slice(0, 180) : null, documentMime: doc && mime ? mime : null, documentData: doc && mime ? doc : null }, manager.id);
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || 'Não foi possível lançar.' }, { status: 400 });
  }
}
