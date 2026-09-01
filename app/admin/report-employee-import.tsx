'use client';

import { useState } from 'react';

type ImportRow = { sourcePage?: number; page?: number; name?: string; pdfName?: string; employeeNumber?: string | null; cpf?: string | null; currentName?: string | null; status: string; conflict?: string | null };
type ReportPayload = { source?: string; preserveEmployeeNumber?: true; matched: ImportRow[]; review: ImportRow[] };
type ImportPreview = { source: string; preserveEmployeeNumber: boolean; totalPdfRecords: number; matched: ImportRow[]; review: ImportRow[]; existingCount: number };

export default function ReportEmployeeImport() {
  const [payload, setPayload] = useState<ReportPayload | null>(null); const [filename, setFilename] = useState(''); const [preview, setPreview] = useState<ImportPreview | null>(null); const [loading, setLoading] = useState(false); const [saving, setSaving] = useState(false); const [message, setMessage] = useState('');
  function parseFile(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.json')) return setMessage('Selecione o lote JSON exportado do Report.pdf. O PDF original deve ser processado localmente antes do upload.');
    setLoading(true); setMessage('');
    const reader = new FileReader();
    reader.onload = () => { try { const parsed = JSON.parse(String(reader.result)); if (!Array.isArray(parsed?.matched) || !Array.isArray(parsed?.review)) throw new Error('Formato inválido'); setPayload({ source: parsed.source || file.name, preserveEmployeeNumber: true, matched: parsed.matched, review: parsed.review }); setFilename(file.name); setPreview(null); setMessage('Lote carregado localmente. Clique em “Validar lote” para cruzar pela matrícula.'); } catch { setMessage('Não foi possível ler o JSON. Use o arquivo de lote exportado pelo processamento do Report.pdf.'); } finally { setLoading(false); } };
    reader.readAsText(file);
  }
  async function validateImport() {
    if (!payload) return setMessage('Selecione o lote JSON antes de validar.');
    setLoading(true); setMessage('');
    try { const response = await fetch('/api/admin/import-report-employees', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || 'Não foi possível validar o lote.'); setPreview(data); setMessage('Prévia gerada. Revise os itens antes de aplicar.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível validar o lote.'); }
    finally { setLoading(false); }
  }
  async function applyImport() {
    if (!payload || !preview || preview.matched.length === 0 || !window.confirm(`Atualizar ${preview.matched.length} cadastro(s) com ${filename}? As matrículas permanecerão exatamente iguais.`)) return;
    setSaving(true); setMessage('');
    try { const response = await fetch('/api/admin/import-report-employees', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, confirm: true }) }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || 'Não foi possível aplicar a importação.'); setMessage(`${data.updated || 0} cadastro(s) atualizado(s). Matrículas preservadas. ${data.review || 0} registro(s) permaneceram para revisão.`); setPreview(null); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível aplicar a importação.'); }
    finally { setSaving(false); }
  }
  function clear() { setPayload(null); setFilename(''); setPreview(null); setMessage(''); }
  return <section className="card report-import-card"><div className="section-heading"><div><span className="eyebrow">FONTE CADASTRAL PROTEGIDA</span><h2>Atualizar dados pelo Report.pdf</h2><p className="small-muted">Faça upload do lote JSON processado localmente. Dados pessoais não ficam versionados no repositório nem no bundle público.</p></div></div><div className="report-upload-row"><label className="small-muted">Lote JSON do Report.pdf<input className="input" type="file" accept="application/json,.json" onChange={event => parseFile(event.target.files?.[0])} /></label>{filename ? <span className="small-muted">Arquivo: <strong>{filename}</strong></span> : null}</div>{payload ? <div className="row-actions"><button type="button" className="primary-btn" onClick={() => void validateImport()} disabled={loading || saving}>{loading ? 'Validando...' : 'Validar lote'}</button><button type="button" className="ghost-btn" onClick={clear} disabled={saving}>Limpar</button></div> : <p className="small-muted">Nenhum lote carregado. A prévia não consulta arquivos fixos do servidor.</p>}{preview ? <><div className="report-summary report-import-summary"><div className="summary"><span className="small-muted">Fichas no arquivo</span><strong>{preview.totalPdfRecords}</strong></div><div className="summary"><span className="small-muted">Prontas para atualizar</span><strong>{preview.matched.length}</strong></div><div className="summary"><span className="small-muted">Para revisão</span><strong>{preview.review.length}</strong></div><div className="summary"><span className="small-muted">Matrículas preservadas</span><strong>{preview.matched.length}</strong></div></div><div className="report-import-notice"><strong>Regra de segurança:</strong><span>nenhum número de matrícula será criado, renumerado ou alterado. O funcionário sem correspondência segura permanecerá sem atualização até receber uma matrícula já existente confirmada pela gestão.</span></div>{preview.review.length ? <div className="report-import-review"><strong>Itens que exigem revisão antes da inclusão</strong>{preview.review.map((row, index) => <div key={`${row.sourcePage || row.page || 'x'}-${index}`}><span>Página {row.sourcePage || row.page || '—'}</span><b>{row.pdfName || row.name}</b><small>{row.conflict || 'Sem correspondência segura de matrícula'}</small></div>)}</div> : <p className="small-muted">Todas as fichas possuem correspondência segura com cadastros existentes.</p>}<div className="row-actions"><button type="button" className="primary-btn" onClick={() => void applyImport()} disabled={saving || !preview.matched.length}>{saving ? 'Aplicando dados...' : `Aplicar ${preview.matched.length} cadastro(s)`}</button></div></> : null}{message ? <p className="status-msg">{message}</p> : null}</section>;
}
