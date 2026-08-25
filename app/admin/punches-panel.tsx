'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type Employee = { id: string; name: string; employeeNumber: string | null };
type RecordItem = {
  id: string;
  type: string;
  timestamp: string;
  status: string;
  origin: string;
  hasPhoto: boolean;
  user: { id: string; name: string; employeeNumber: string | null; jobTitle: string | null };
};

const typeLabels: Record<string, string> = { ENTRADA: 'Entrada', INTERVALO: 'Intervalo', RETORNO: 'Retorno', SAIDA: 'Saída' };
const statusLabels: Record<string, string> = { VALID: 'Válido', REJECTED: 'Rejeitado', PENDING: 'Pendente' };

function localDateString(date = new Date()) {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 10);
}

export default function PunchesPanel({ employees }: { employees: Employee[] }) {
  const today = localDateString();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [employeeId, setEmployeeId] = useState('');
  const [type, setType] = useState('ALL');
  const [status, setStatus] = useState('VALID');
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ from, to, status });
    if (employeeId) params.set('employeeId', employeeId);
    if (type !== 'ALL') params.set('type', type);
    try {
      const response = await fetch(`/api/admin/punches?${params.toString()}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Não foi possível carregar os registros.');
      setRecords(Array.isArray(data.records) ? data.records : []);
      setLastUpdated(new Date());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os registros.');
    } finally {
      setLoading(false);
    }
  }, [from, to, employeeId, type, status]);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => records.reduce((summary, record) => {
    summary.total += 1;
    if (record.hasPhoto) summary.photos += 1;
    if (record.type === 'ENTRADA') summary.entries += 1;
    if (record.type === 'SAIDA') summary.exits += 1;
    return summary;
  }, { total: 0, photos: 0, entries: 0, exits: 0 }), [records]);

  function exportCsv() {
    const params = new URLSearchParams({ from, to, status, format: 'csv' });
    if (employeeId) params.set('employeeId', employeeId);
    if (type !== 'ALL') params.set('type', type);
    window.location.assign(`/api/admin/punches?${params.toString()}`);
  }

  return (
    <section className="card reports-panel">
      <div className="section-heading reports-heading">
        <div><span className="eyebrow">RELATÓRIO OPERACIONAL</span><h2>Registros de ponto</h2><p className="small-muted">Consulte, confira evidências e exporte as marcações salvas no sistema.</p></div>
        <div className="report-actions"><button type="button" className="ghost-btn" onClick={exportCsv} disabled={loading || !records.length}>Exportar CSV</button><button type="button" className="primary-btn" onClick={() => void load()} disabled={loading}>{loading ? 'Atualizando...' : 'Atualizar'}</button></div>
      </div>

      <div className="report-filters">
        <label className="small-muted">Data inicial<input className="input" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label className="small-muted">Data final<input className="input" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <label className="small-muted">Colaborador<select className="input" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}><option value="">Todos os colaboradores</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.employeeNumber || 'sem matrícula'} — {employee.name}</option>)}</select></label>
        <label className="small-muted">Tipo<select className="input" value={type} onChange={(event) => setType(event.target.value)}><option value="ALL">Todos os tipos</option><option value="ENTRADA">Entrada</option><option value="INTERVALO">Intervalo</option><option value="RETORNO">Retorno</option><option value="SAIDA">Saída</option></select></label>
        <label className="small-muted">Status<select className="input" value={status} onChange={(event) => setStatus(event.target.value)}><option value="VALID">Válidos</option><option value="ALL">Todos</option><option value="REJECTED">Rejeitados</option><option value="PENDING">Pendentes</option></select></label>
      </div>

      <div className="report-summary"><div className="summary"><span className="small-muted">Registros encontrados</span><strong>{counts.total}</strong></div><div className="summary"><span className="small-muted">Entradas</span><strong>{counts.entries}</strong></div><div className="summary"><span className="small-muted">Saídas</span><strong>{counts.exits}</strong></div><div className="summary"><span className="small-muted">Com foto</span><strong>{counts.photos}</strong></div></div>
      {lastUpdated ? <div className="report-updated">Atualizado às {lastUpdated.toLocaleTimeString('pt-BR')}</div> : null}
      {error ? <div className="status-msg" style={{ marginTop: 14 }}>{error}</div> : null}
      {loading ? <p className="small-muted" style={{ marginTop: 16 }}>Buscando registros...</p> : null}
      {!loading && !records.length ? <div className="report-empty"><strong>Nenhum registro encontrado</strong><span>Ajuste o período ou os filtros para consultar outras marcações.</span></div> : null}
      {records.length ? <div className="report-table-wrap"><table className="report-table"><thead><tr><th>Data e hora</th><th>Colaborador</th><th>Tipo</th><th>Status</th><th>Origem</th><th>Evidência</th></tr></thead><tbody>{records.map((record) => <tr key={record.id}><td><strong>{new Date(record.timestamp).toLocaleDateString('pt-BR')}</strong><div className="small-muted">{new Date(record.timestamp).toLocaleTimeString('pt-BR')}</div></td><td><strong>{record.user.name}</strong><div className="small-muted">{record.user.employeeNumber || 'Sem matrícula'}{record.user.jobTitle ? ` · ${record.user.jobTitle}` : ''}</div></td><td><span className={`type-badge type-${record.type.toLowerCase()}`}>{typeLabels[record.type] || record.type}</span></td><td><span className={`status-pill ${record.status === 'VALID' ? 'ok' : 'off'}`}>{statusLabels[record.status] || record.status}</span></td><td>{record.origin || 'WEB'}</td><td>{record.hasPhoto ? <a href={`/api/admin/punches/${record.id}/photo`} target="_blank" rel="noreferrer">Ver foto</a> : <span className="small-muted">Sem foto</span>}</td></tr>)}</tbody></table></div> : null}
    </section>
  );
}
