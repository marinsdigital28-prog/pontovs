export type CsvRow = {
  sourceId: string;
  employeeNumber: string;
  name: string;
  jobTitle: string;
  department: string;
  type: string;
  date: string;
  time: string;
  location: string;
};

const required = ['NSR', 'MATRICULA', 'NOME', 'TIPO', 'DATA', 'HORARIO'];
export const allowedTypes = new Set(['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA', 'SAIDA_ALMOCO', 'VOLTA_ALMOCO']);

function normalizeHeader(value: string) {
  return value
    .replace(/^\uFEFF/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');
}

function splitLine(line: string, delimiter: string) {
  const values: string[] = [];
  let value = '';
  let inside = false;
  for (const char of line) {
    if (char === '"') inside = !inside;
    else if (char === delimiter && !inside) {
      values.push(value.trim().replace(/^"|"$/g, ''));
      value = '';
    } else value += char;
  }
  values.push(value.trim().replace(/^"|"$/g, ''));
  return values;
}

function normalizeDate(value: string) {
  const trimmed = value.trim();
  const brazilian = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (brazilian) return `${brazilian[3]}-${brazilian[2]}-${brazilian[1]}`;
  return trimmed;
}

function canonicalHeader(value: string) {
  const normalized = normalizeHeader(value);
  if (normalized === 'NSR') return 'NSR';
  if (normalized === 'MATRICULA') return 'MATRICULA';
  if (normalized === 'NOME' || normalized === 'COLABORADOR') return 'NOME';
  if (normalized === 'CARGO') return 'CARGO';
  if (normalized === 'DEPARTAMENTO') return 'DEPARTAMENTO';
  if (normalized === 'TIPO' || normalized === 'TIPODEMARCACAO') return 'TIPO';
  if (normalized === 'DATA') return 'DATA';
  if (normalized === 'HORARIO') return 'HORARIO';
  if (normalized === 'LOCALIZACAO' || normalized === 'LOCALUNIDADE') return 'LOCALIZACAO';
  return normalized;
}

export function parseCsv(text: string) {
  const lines: string[] = [];
  let current = '';
  let quoted = false;
  for (const char of text.replace(/^\uFEFF/, '')) {
    if (char === '"') quoted = !quoted;
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (current.trim()) lines.push(current);
      current = '';
    } else current += char;
  }
  if (current.trim()) lines.push(current);

  const delimiter = lines.find((line) => line.includes(';'))?.includes(';') ? ';' : ',';
  const headerLineIndex = lines.findIndex((line) => splitLine(line, delimiter).some((value) => canonicalHeader(value) === 'NSR'));
  if (headerLineIndex < 0) throw new Error('Cabeçalho de marcações não encontrado. O CSV precisa conter a coluna NSR.');

  const rawHeaders = splitLine(lines[headerLineIndex], delimiter);
  const headers = rawHeaders.map(canonicalHeader);
  const index = (name: string) => headers.indexOf(name);
  const missing = required.filter((header) => index(header) < 0);
  if (missing.length) throw new Error(`Colunas obrigatórias ausentes: ${missing.join(', ')}`);

  const rows = lines.slice(headerLineIndex + 1).map((line) => {
    const values = splitLine(line, delimiter);
    return {
      sourceId: values[index('NSR')] || '',
      employeeNumber: values[index('MATRICULA')] || '',
      name: values[index('NOME')] || '',
      jobTitle: index('CARGO') >= 0 ? values[index('CARGO')] || '' : '',
      department: index('DEPARTAMENTO') >= 0 ? values[index('DEPARTAMENTO')] || '' : '',
      type: values[index('TIPO')] || '',
      date: normalizeDate(values[index('DATA')] || ''),
      time: values[index('HORARIO')] || '',
      location: index('LOCALIZACAO') >= 0 ? values[index('LOCALIZACAO')] || '' : '',
    } satisfies CsvRow;
  }).filter((row) => Object.values(row).some(Boolean));

  return { headers, rows };
}

export function validate(rows: CsvRow[]) {
  return rows.map((row, index) => {
    const errors: string[] = [];
    if (!/^\d{1,}$/.test(row.employeeNumber.replace(/\D/g, ''))) errors.push('matrícula');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) errors.push('data');
    if (!/^\d{2}:\d{2}:\d{2}$/.test(row.time)) errors.push('horário');
    if (!allowedTypes.has(row.type.toUpperCase())) errors.push('tipo');
    return errors.length ? `Linha ${index + 2}: ${errors.join(', ')} inválido(s)` : '';
  }).filter(Boolean);
}
