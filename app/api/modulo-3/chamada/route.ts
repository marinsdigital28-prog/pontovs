import { NextResponse } from 'next/server';
import { createAttendanceList, findAttendanceList, listAtivosParaChamada, listTurmas, updateAttendanceList, type PresencaStatus } from '@/lib/beneficiarios-source';

export const dynamic = 'force-dynamic';
const validStatuses = new Set<PresencaStatus>(['presente', 'falta', 'justificado', 'nao_compareceu']);
function dateParts(value: string) { const [year, month, day] = value.split('-').map(Number); return { year, month, day }; }
function listPayload(body: any, participants: any[], markings: Record<string, string>) {
  const { year, month } = dateParts(String(body.date));
  return { mes: month, ano: year, projeto: body.projeto || null, turma_id: body.turmaId || null, turma: body.turma || null, turno: body.turno || null, educador: String(body.teacher || 'Professor').slice(0, 120), unidade: body.unidade || null, filtros: { origem: 'portalprogredir', data: body.date }, participantes: participants, marcacoes: markings, total_alunos: participants.length, autor: String(body.teacher || 'Professor').slice(0, 120), dispositivo: String(body.device || 'PWA').slice(0, 180) };
}

export async function GET(request: Request) {
  const url = new URL(request.url); const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10); const turmaId = url.searchParams.get('turmaId') || undefined;
  try {
    const [participants, turmas, existing] = await Promise.all([listAtivosParaChamada(turmaId), listTurmas(), findAttendanceList(dateParts(date).month, dateParts(date).year, turmaId)]);
    return NextResponse.json({ participants, turmas, existing, date });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Não foi possível carregar a chamada.' }, { status: 502 }); }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null); const date = String(body?.date || ''); const participants = Array.isArray(body?.participants) ? body.participants : [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !participants.length) return NextResponse.json({ error: 'Data e participantes são obrigatórios.' }, { status: 400 });
  try { const existing = await findAttendanceList(dateParts(date).month, dateParts(date).year, body.turmaId || null); if (existing?.id) return NextResponse.json({ list: existing }); const markings = body.markings && typeof body.markings === 'object' ? body.markings : {}; const list = await createAttendanceList(listPayload(body, participants, markings)); return NextResponse.json({ list }, { status: 201 }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Não foi possível criar a lista.' }, { status: 502 }); }
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null); const id = String(body?.listId || ''); const beneficiaryId = String(body?.beneficiaryId || ''); const status = String(body?.status || '');
  if (!id || !beneficiaryId || !validStatuses.has(status as PresencaStatus)) return NextResponse.json({ error: 'Lista, beneficiário e status são obrigatórios.' }, { status: 400 });
  try { const current = await findAttendanceList(Number(body.month), Number(body.year), body.turmaId || null); const markings = { ...((current?.marcacoes as Record<string, unknown>) || {}), [beneficiaryId]: { ...(((current?.marcacoes as Record<string, any>) || {})[beneficiaryId] || {}), [String(body.day)]: status } }; const updated = await updateAttendanceList(id, { marcacoes: markings, updated_at: new Date().toISOString(), autor: String(body.teacher || 'Professor').slice(0, 120) }); return NextResponse.json({ list: updated, syncedAt: new Date().toISOString() }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Não foi possível sincronizar a presença.' }, { status: 502 }); }
}
