'use client';

import { useCallback, useEffect, useState } from 'react';

type Employee = { id: string; name: string; employeeNumber: string | null };
type RecordItem = {
  id: string;
  type: string;
  timestamp: string;
  origin: string;
  hasPhoto: boolean;
  user: { id: string; name: string; employeeNumber: string | null; jobTitle: string | null };
};

export default function PunchesPanel({ employees }: { employees: Employee[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [employeeId, setEmployeeId] = useState('');
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (employeeId) params.set('employeeId', employeeId);
    try {
      const response = await fetch(`/api/admin/punches?${params.toString()}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Não foi possível carregar os registros.');
      setRecords(data.records || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os registros.');
    } finally {
      setLoading(false);
    }
  }, [from, to, employeeId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="card" style={{ marginTop: 18 }}>
      <div className="header-row" style={{ alignItems: 'flex-end' }}>
        <div>
          <h2 style={{ margin: 0 }}>Registros de ponto</h2>
          <p className="small-muted" style={{ marginBottom: 0 }}>Filtre por período e colaborador para conferir as batidas.</p>
        </div>
        <button type="button" className="primary-btn" onClick={() => void load()} disabled={loading} style={{ width: 'auto', padding: '10px 16px' }}>
          {loading ? 'Carregando...' : 'Atualizar'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 16 }}>
        <label className="small-muted">Data inicial<input className="input" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label className="small-muted">Data final<input className="input" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <label className="small-muted">Colaborador<select className="input" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}><option value="">Todos os colaboradores</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.employeeNumber || 'sem matrícula'} — {employee.name}</option>)}</select></label>
      </div>

      {error ? <div className="status-msg" style={{ marginTop: 14 }}>{error}</div> : null}
      {loading ? <p className="small-muted" style={{ marginTop: 16 }}>Buscando registros...</p> : null}
      {!loading && !records.length ? <p className="small-muted" style={{ marginTop: 16 }}>Nenhum registro encontrado para os filtros selecionados.</p> : null}
      {records.length ? (
        <div style={{ overflowX: 'auto', marginTop: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 680 }}>
            <thead><tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}><th style={{ padding: 10 }}>Data e hora</th><th style={{ padding: 10 }}>Colaborador</th><th style={{ padding: 10 }}>Tipo</th><th style={{ padding: 10 }}>Origem</th><th style={{ padding: 10 }}>Evidência</th></tr></thead>
            <tbody>{records.map((record) => <tr key={record.id} style={{ borderBottom: '1px solid var(--border)' }}><td style={{ padding: 10 }}>{new Date(record.timestamp).toLocaleString('pt-BR')}</td><td style={{ padding: 10 }}><strong>{record.user.name}</strong><div className="small-muted">Matrícula: {record.user.employeeNumber || '—'}</div></td><td style={{ padding: 10 }}>{record.type}</td><td style={{ padding: 10 }}>{record.origin}</td><td style={{ padding: 10 }}>{record.hasPhoto ? <a href={`/api/admin/punches/${record.id}/photo`} target="_blank" rel="noreferrer">Ver foto</a> : <span className="small-muted">Sem foto</span>}</td></tr>)}</tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
