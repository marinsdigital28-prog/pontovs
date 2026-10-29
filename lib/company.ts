/**
 * Empresas do grupo (Espaço Progredir × Espaço Educacional Progredir).
 *
 * Fonte da empresa de cada colaborador, em ordem:
 *   1. coluna `User.company` (migração preparada em prisma/pending-migrations — AINDA NÃO aplicada);
 *   2. `profileJson.company` (funciona hoje, sem mudança de banco);
 *   3. padrão ESPACO_PROGREDIR.
 * Assim o código funciona com ou sem a coluna no banco.
 */
export const COMPANY_CODES = ['ESPACO_PROGREDIR', 'ESPACO_EDUCACIONAL_PROGREDIR'] as const;
export type CompanyCode = (typeof COMPANY_CODES)[number];
export const DEFAULT_COMPANY: CompanyCode = 'ESPACO_PROGREDIR';

export type CompanyConfig = {
  code: CompanyCode;
  name: string;          // nome no cabeçalho / selo (maiúsculas)
  shortName: string;     // nome no selo da tela
  cnpj: string | null;   // null = a cadastrar
  logoPath: string;      // relativo a /public (tela)
  logoMime: 'png' | 'jpg';
  /** PDF: usa o PNG embutido (base64) quando definido; senão lê logoPath */
  pdfLogo?: 'escola';
};

export const COMPANIES: Record<CompanyCode, CompanyConfig> = {
  ESPACO_PROGREDIR: {
    code: 'ESPACO_PROGREDIR', name: 'ESPAÇO PROGREDIR', shortName: 'Espaço Progredir',
    cnpj: '05.553.848/0001-61', logoPath: 'espaco-progredir-logo.jpeg', logoMime: 'jpg',
  },
  ESPACO_EDUCACIONAL_PROGREDIR: {
    code: 'ESPACO_EDUCACIONAL_PROGREDIR', name: 'ESPAÇO EDUCACIONAL PROGREDIR', shortName: 'Espaço Educacional Progredir',
    cnpj: '05.553.848/0001-61', // mesmo CNPJ do Espaço Progredir (confirmado pelo gestor em 29/10/2026)
    logoPath: 'empresas/espaco-educacional-progredir.svg', logoMime: 'png', pdfLogo: 'escola',
  },
};

export const CNPJ_PENDING_LABEL = 'a cadastrar';

export function isCompanyCode(v: unknown): v is CompanyCode {
  return typeof v === 'string' && (COMPANY_CODES as readonly string[]).includes(v);
}

export function companyCnpjLabel(code: CompanyCode) {
  const c = COMPANIES[code];
  return c.cnpj ? `CNPJ ${c.cnpj}` : `CNPJ ${CNPJ_PENDING_LABEL}`;
}

function parseProfile(p: unknown): Record<string, unknown> | null {
  if (!p) return null;
  if (typeof p === 'object') return p as Record<string, unknown>;
  try { const v = JSON.parse(String(p)); return v && typeof v === 'object' ? v : null; } catch { return null; }
}

/** Resolve a empresa de um colaborador a partir da coluna (se existir) ou do profileJson/profile. */
export function resolveCompany(e: { company?: unknown; profileJson?: unknown; profile?: unknown } | null | undefined): CompanyCode {
  if (!e) return DEFAULT_COMPANY;
  if (isCompanyCode(e.company)) return e.company;
  const prof = parseProfile(e.profile) ?? parseProfile(e.profileJson);
  if (prof && isCompanyCode(prof.company)) return prof.company;
  return DEFAULT_COMPANY;
}

/** Filtro: 'ALL' ou um código. */
export type CompanyFilter = CompanyCode | 'ALL';
export function parseCompanyFilter(v: unknown): CompanyFilter {
  return isCompanyCode(v) ? v : 'ALL';
}
export function matchesCompany(e: Parameters<typeof resolveCompany>[0], filter: CompanyFilter) {
  return filter === 'ALL' || resolveCompany(e) === filter;
}

/** Membros da escola (aprovado pelo gestor em 29/10/2026). Usado pelo script de definição. */
export const ESCOLA_MEMBERS = [
  'Cássio Freire de Oliveira', 'Daniele de Souza Tavares', 'Edilson Teixeira', 'Gabriela Pereira dos Santos Araujo',
  'José Ulian da Silva Inácio', 'Julyanne Felippe de Aguiar', 'Leonardo de Oliveira Dias', 'Nathalia de Lima Lomba',
  'Robson de Souza Santos',
];
export function normalizeName(s: string) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Lançamento em lote: só quem é da empresa e tem marcação no dia. */
export function selectBatchTargets<T extends { id: string; company?: unknown; profileJson?: unknown; profile?: unknown; active?: boolean }>(
  employees: T[], company: CompanyFilter, idsWithPunches: Set<string>, alreadyCovered: Set<string> = new Set(),
) {
  const inCompany = employees.filter((e) => e.active !== false && matchesCompany(e, company));
  return {
    targets: inCompany.filter((e) => idsWithPunches.has(e.id) && !alreadyCovered.has(e.id)),
    withoutPunches: inCompany.filter((e) => !idsWithPunches.has(e.id)),
    alreadyCovered: inCompany.filter((e) => idsWithPunches.has(e.id) && alreadyCovered.has(e.id)),
  };
}
