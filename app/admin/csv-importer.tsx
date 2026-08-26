'use client';

import { useMemo, useState } from 'react';

type CsvRow = { sourceId: string; employeeNumber: string; name: string; department: string; type: string; date: string; time: string; location: string };
const required = ['NSR', 'MATRICULA', 'NOME', 'TIPO', 'DATA', 'HORARIO'];
const allowedTypes = new Set(['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA', 'SAIDA_ALMOCO']);

function parseCsv(text: string) {
  const lines: string[] = [];
  let current = '';
  let quoted = false;
  for (const char of text.replace(/^\uFEFF/, '')) {
    if (char === '"') quoted = !quoted;
    else if ((char === '\n' || char === '\r') && !quoted) { if (current.trim()) lines.push(current); current = ''; }
    else current += char;
  }
  if (current.trim()) lines.push(current);
  const delimiter = lines[0]?.includes(';') ? ';' : ',';
  const split = (line: string) => { const values: string[] = []; let value = ''; let inside = false; for (const char of line) { if (char === '"') inside = !inside; else if (char === delimiter && !inside) { values.push(value.trim()); value = ''; } else value += char; } values.push(value.trim()); return values; };
  const headers = split(lines[0] || '').map((header) => header.replace(/^"|"$/g, '').trim().toUpperCase());
  const index = (name: string) => headers.indexOf(name);
  const missing = required.filter((header) => index(header) < 0);
  if (missing.length) throw new Error(`Colunas obrigatórias ausentes: ${missing.join(', ')}`);
  const rows = lines.slice(1).map((line) => { const values = split(line); return { sourceId: values[index('NSR')] || '', employeeNumber: values[index('MATRICULA')] || '', name: values[index('NOME')] || '', department: values[index('DEPARTAMENTO')] || '', type: values[index('TIPO')] || '', date: values[index('DATA')] || '', time: values[index('HORARIO')] || '', location: values[index('LOCALIZACAO')] || '' }; }).filter((row) => Object.values(row).some(Boolean));
  return { headers, rows };
}

function validate(rows: CsvRow[]) {
  return rows.map((row, index) => { const errors: string[] = []; if (!/^\d{1,}$/.test(row.employeeNumber.replace(/\D/g, ''))) errors.push('matrícula'); if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) errors.push('data'); if (!/^\d{2}:\d{2}:\d{2}$/.test(row.time)) errors.push('horário'); if (!allowedTypes.has(row.type.toUpperCase())) errors.push('tipo'); return errors.length ? `Linha ${index + 2}: ${errors.join(', ')} inválido(s)` : ''; }).filter(Boolean);
}

export default function CsvImporter() {
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const validRows = useMemo(() => rows.filter((row) => !validate([row]).length), [rows]);
  const employees = useMemo(() => { const map = new Map<string, { employeeNumber: string; name: string; jobTitle: string }>(); for (const row of validRows) { const employeeNumber = row.employeeNumber.replace(/\D/g, '').padStart(4, '0'); if (!map.has(employeeNumber)) map.set(employeeNumber, { employeeNumber, name: row.name, jobTitle: row.department }); } return [...map.values()]; }, [validRows]);

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file) return; setFileName(file.name); setMessage(''); try { const parsed = parseCsv(await file.text()); const nextErrors = validate(parsed.rows); setRows(parsed.rows); setErrors(nextErrors); setOpen(true); } catch (cause) { setRows([]); setErrors([cause instanceof Error ? cause.message : 'Não foi possível ler o CSV.']); setOpen(true); } event.target.value = ''; };
  const importRows = async () => { if (errors.length || !validRows.length) return; setLoading(true); setMessage(''); const response = await fetch('/api/admin/import-csv', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ employees, punches: validRows.map((row) => ({ sourceId: row.sourceId, employeeNumber: row.employeeNumber, type: row.type, date: row.date, time: row.time })) }) }); const data = await response.json().catch(() => ({})); setMessage(response.ok ? `Importação concluída: ${data.punchesCreated || 0} criadas, ${data.punchesExisting || 0} já existentes e ${data.rowsIgnored || 0} ignoradas.` : data.error || 'Não foi possível importar.'); setLoading(false); };

  return <div className="csv-importer card"><div className="section-heading"><div><span className="eyebrow">DADOS HISTÓRICOS</span><h3>Importar marcações CSV</h3><p className="small-muted">Faça a prévia antes de gravar. O sistema não duplica registros já importados.</p></div><label className="primary-btn compact-btn csv-file-btn">Escolher CSV<input type="file" accept=".csv,text/csv" onChange={(event) => void handleFile(event)} /></label></div>{fileName ? <p className="small-muted">Arquivo selecionado: <strong>{fileName}</strong> · {rows.length} linhas · {employees.length} colaboradores</p> : null}{open ? <div className="csv-preview"><div className="csv-preview-head"><strong>Prévia da importação</strong><span className={errors.length ? 'status-pill off' : 'status-pill ok'}>{errors.length ? `${errors.length} erro(s)` : `${validRows.length} linha(s) válidas`}</span></div>{errors.length ? <div className="csv-errors">{errors.slice(0, 8).map((error) => <span key={error}>{error}</span>)}{errors.length > 8 ? <span>… e mais {errors.length - 8} erro(s).</span> : null}</div> : <div className="csv-sample">{validRows.slice(0, 5).map((row) => <div key={`${row.sourceId}-${row.employeeNumber}-${row.date}-${row.time}`}><strong>{row.employeeNumber}</strong><span>{row.name}</span><span>{row.date} {row.time}</span><span>{row.type}</span></div>)}</div>}<div className="row-actions"><button type="button" className="ghost-btn" onClick={() => { setOpen(false); setRows([]); setErrors([]); }}>Cancelar</button><button type="button" className="primary-btn compact-btn" disabled={loading || Boolean(errors.length) || !validRows.length} onClick={() => void importRows()}>{loading ? 'Importando...' : 'Confirmar importação'}</button></div></div> : null}{message ? <div className="status-msg admin-toast">{message}</div> : null}</div>;
}
