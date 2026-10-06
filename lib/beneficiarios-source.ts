const SUPABASE_URL = process.env.BENEFICIARIOS_SUPABASE_URL || 'https://pwnxvwpxvflgcpxkvwyw.supabase.co';
const SUPABASE_ANON_KEY = process.env.BENEFICIARIOS_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3bnh2d3B4dmZsZ2NweGt2d3l3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MjQ5OTQsImV4cCI6MjA5MzAwOTk5NH0.nz-sSavPWJGe57IAT0r2igPviV5CLOabc4TW9nGokOI';
const SUPABASE_ACCESS_TOKEN = process.env.BENEFICIARIOS_SUPABASE_SERVICE_ROLE_KEY || process.env.BENEFICIARIOS_SUPABASE_ACCESS_TOKEN || '';

export type Beneficiario = {
  id: string; nome: string; codigo: number | string | null; bairro: string | null; escola: string | null;
  escolaridade: string | null; ativo: boolean | null; classe_risco: string | null; data_nascimento: string | null;
  celular: string | null; whatsapp: string | null; genero: string | null; turno: string | null;
  nome_mae: string | null; responsavel: string | null;
};
export type Turma = { id: string; nome: string; oficina_id?: string | null; dias_semana?: string[] | null; horario_inicio?: string | null; horario_fim?: string | null };
export type Matricula = { id: string; beneficiario_id: string; turma_id: string; status: string | null };
export type PresencaParticipante = { id: string; nome: string; codigo?: number | string | null; turma?: string; idade?: number | null };
export type PresencaStatus = 'presente' | 'falta' | 'justificado' | 'nao_compareceu';

const SELECT = ['id', 'nome', 'codigo', 'bairro', 'escola', 'escolaridade', 'ativo', 'classe_risco', 'data_nascimento', 'celular', 'whatsapp', 'genero', 'turno', 'nome_mae', 'responsavel'].join(',');
function headers(extra: Record<string, string> = {}) { return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json', ...extra }; }
function rest(table: string, params = new URLSearchParams()) { return `${SUPABASE_URL}/rest/v1/${table}?${params.toString()}`; }
async function supabase(table: string, params: URLSearchParams, init?: RequestInit) {
  if (!SUPABASE_ACCESS_TOKEN) throw new Error(sourceError());
  const response = await fetch(rest(table, params), { ...init, headers: headers(init?.headers as Record<string, string>), cache: 'no-store' });
  const text = await response.text();
  let body: unknown = null; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) throw new Error(`Supabase ${table} (${response.status}): ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  return body;
}
function sourceError() { return 'A fonte externa exige token Supabase autorizado. Configure BENEFICIARIOS_SUPABASE_ACCESS_TOKEN ou BENEFICIARIOS_SUPABASE_SERVICE_ROLE_KEY no portal.'; }

export async function listBeneficiarios(options: { search?: string; status?: 'todos' | 'ativos' | 'inativos'; limit?: number; offset?: number } = {}) {
  const params = new URLSearchParams({ select: SELECT, order: 'nome.asc', limit: String(Math.min(Math.max(options.limit ?? 100, 1), 1000)), offset: String(Math.max(options.offset ?? 0, 0)) });
  if (options.search?.trim()) { const search = options.search.trim().replace(/[*(),]/g, ' '); const clauses = [`nome.ilike.*${search}*`, `escola.ilike.*${search}*`, `bairro.ilike.*${search}*`]; if (/^\d+$/.test(search)) clauses.push(`codigo.eq.${search}`); params.set('or', `(${clauses.join(',')})`); }
  if (options.status === 'ativos') params.set('ativo', 'eq.true');
  if (options.status === 'inativos') params.set('ativo', 'eq.false');
  try { return (await supabase('beneficiarios', params)) as Beneficiario[]; } catch (error) { throw new Error(error instanceof Error && /401|403/.test(error.message) ? sourceError() : error instanceof Error ? error.message : sourceError()); }
}
export async function getBeneficiario(id: string) { const rows = (await supabase('beneficiarios', new URLSearchParams({ select: SELECT, id: `eq.${id}`, limit: '1' }))) as Beneficiario[]; return rows[0] ?? null; }
export async function listTurmas() { return (await supabase('turmas', new URLSearchParams({ select: 'id,nome,oficina_id,dias_semana,horario_inicio,horario_fim', order: 'nome.asc', limit: '1000' }))) as Turma[]; }
export async function listMatriculas(turmaId?: string) { const params = new URLSearchParams({ select: 'id,beneficiario_id,turma_id,status', status: 'neq.cancelada', limit: '2000' }); if (turmaId) params.set('turma_id', `eq.${turmaId}`); return (await supabase('matriculas', params)) as Matricula[]; }
export async function listAtivosParaChamada(turmaId?: string) {
  const [beneficiarios, matriculas, turmas] = await Promise.all([listBeneficiarios({ status: 'ativos', limit: 1000 }), listMatriculas(turmaId), listTurmas()]);
  const turmaName = new Map(turmas.map((item) => [item.id, item.nome]));
  const enrolled = new Set(matriculas.filter((item) => !turmaId || item.turma_id === turmaId).map((item) => item.beneficiario_id));
  return beneficiarios.filter((item) => !turmaId || enrolled.has(item.id)).map((item) => ({ id: item.id, nome: item.nome, codigo: item.codigo, turma: turmaId ? turmaName.get(turmaId) || '' : undefined }));
}
export async function findAttendanceList(mes: number, ano: number, turmaId?: string | null) {
  const params = new URLSearchParams({ select: '*', mes: `eq.${mes}`, ano: `eq.${ano}`, order: 'created_at.desc', limit: '1' });
  if (turmaId) params.set('turma_id', `eq.${turmaId}`); else params.set('turma_id', 'is.null');
  const rows = (await supabase('listas_presenca', params)) as Array<Record<string, unknown>>;
  return rows[0] ?? null;
}
export async function createAttendanceList(data: Record<string, unknown>) {
  const rows = (await supabase('listas_presenca', new URLSearchParams({ select: '*' }), { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(data) })) as Array<Record<string, unknown>>;
  return rows[0] ?? null;
}
export async function updateAttendanceList(id: string, data: Record<string, unknown>) {
  const rows = (await supabase('listas_presenca', new URLSearchParams({ select: '*', id: `eq.${id}` }), { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(data) })) as Array<Record<string, unknown>>;
  return rows[0] ?? null;
}
