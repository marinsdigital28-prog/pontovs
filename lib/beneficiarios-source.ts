const SUPABASE_URL = process.env.BENEFICIARIOS_SUPABASE_URL || 'https://pwnxvwpxvflgcpxkvwyw.supabase.co';
const SUPABASE_ANON_KEY = process.env.BENEFICIARIOS_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3bnh2d3B4dmZsZ2NweGt2d3l3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MjQ5OTQsImV4cCI6MjA5MzAwOTk0NH0.nz-sSavPWJGe57IAT0r2igPviV5CLOabc4TW9nGokOI';
const SUPABASE_ACCESS_TOKEN = process.env.BENEFICIARIOS_SUPABASE_SERVICE_ROLE_KEY || process.env.BENEFICIARIOS_SUPABASE_ACCESS_TOKEN || SUPABASE_ANON_KEY;

export type Beneficiario = {
  id: string;
  nome: string;
  codigo: number | string | null;
  bairro: string | null;
  escola: string | null;
  escolaridade: string | null;
  ativo: boolean | null;
  classe_risco: string | null;
  data_nascimento: string | null;
  celular: string | null;
  whatsapp: string | null;
  genero: string | null;
  turno: string | null;
  nome_mae: string | null;
  responsavel: string | null;
};

const SELECT = ['id', 'nome', 'codigo', 'bairro', 'escola', 'escolaridade', 'ativo', 'classe_risco', 'data_nascimento', 'celular', 'whatsapp', 'genero', 'turno', 'nome_mae', 'responsavel'].join(',');

function headers() {
  return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}` };
}

function endpoint(params: URLSearchParams) {
  return `${SUPABASE_URL}/rest/v1/beneficiarios?${params.toString()}`;
}

export async function listBeneficiarios(options: { search?: string; status?: 'todos' | 'ativos' | 'inativos'; limit?: number; offset?: number } = {}) {
  const params = new URLSearchParams({ select: SELECT, order: 'nome.asc', limit: String(Math.min(Math.max(options.limit ?? 100, 1), 1000)), offset: String(Math.max(options.offset ?? 0, 0)) });
  if (options.search?.trim()) {
    const search = options.search.trim().replace(/[*(),]/g, ' ');
    const clauses = [`nome.ilike.*${search}*`, `escola.ilike.*${search}*`, `bairro.ilike.*${search}*`];
    if (/^\d+$/.test(search)) clauses.push(`codigo.eq.${search}`);
    params.set('or', `(${clauses.join(',')})`);
  }
  if (options.status === 'ativos') params.set('ativo', 'eq.true');
  if (options.status === 'inativos') params.set('ativo', 'eq.false');
  const response = await fetch(endpoint(params), { headers: headers(), cache: 'no-store' });
  if (!response.ok) throw new Error(`Fonte de beneficiários indisponível (${response.status}). Configure BENEFICIARIOS_SUPABASE_ACCESS_TOKEN no ambiente do portal.`);
  return (await response.json()) as Beneficiario[];
}

export async function getBeneficiario(id: string) {
  const params = new URLSearchParams({ select: SELECT, id: `eq.${id}`, limit: '1' });
  const response = await fetch(endpoint(params), { headers: headers(), cache: 'no-store' });
  if (!response.ok) throw new Error(`Não foi possível consultar o beneficiário (${response.status})`);
  const rows = (await response.json()) as Beneficiario[];
  return rows[0] ?? null;
}
