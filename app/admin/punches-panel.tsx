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
  const [message, setMessage] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [actionRecord, setActionRecord] = useState<RecordItem | null>(null);
  const [actionMode, setActionMode] = useState<'edit' | 'cancel' | null>(null);
  const [actionType, setActionType] = useState('ENTRADA');
  const [actionTimestamp, setActionTimestamp] = useState('');
  const [actionReason, setActionReason] = useState('');
  const [actionSaving, setActionSaving] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualEmployeeId, setManualEmployeeId] = useState('');
  const [manualType, setManualType] = useState('ENTRADA');
  const [manualDate, setManualDate] = useState(today);
  const [manualTime, setManualTime] = useState('08:00');
  const [manualReason, setManualReason] = useState('');
  const [manualSaving, setManualSaving] = useState(false);

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

  async function submitAction(event: React.FormEvent) {
    event.preventDefault();
    if (!actionRecord || !actionMode || actionReason.trim().length < 5) return;
    setActionSaving(true);
    try {
      const response = await fetch(`/api/admin/punches/${actionRecord.id}`, { method: actionMode === 'cancel' ? 'DELETE' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(actionMode === 'cancel' ? { reason: actionReason } : { type: actionType, timestamp: actionTimestamp, reason: actionReason }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a ação.');
      setActionRecord(null); setActionMode(null); setActionReason(''); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível concluir a ação.'); }
    finally { setActionSaving(false); }
  }

  function openAction(record: RecordItem, mode: 'edit' | 'cancel') {
    setActionRecord(record); setActionMode(mode); setActionType(record.type); setActionTimestamp(new Date(record.timestamp).toISOString().slice(0, 16)); setActionReason(''); setError('');
  }

  async function submitManualPunch(event: React.FormEvent) {
    event.preventDefault();
    if (!manualEmployeeId || manualReason.trim().length < 5) return;
    setManualSaving(true);
    setError('');
    try {
      const response = await fetch('/api/admin/punches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: manualEmployeeId, type: manualType, date: manualDate, time: manualTime, reason: manualReason }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Não foi possível lançar a marcação manual.');
      setMessage(`Marcação manual registrada para ${data.employee?.name || 'o colaborador'}.`);
      setManualReason('');
      setManualOpen(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível lançar a marcação manual.');
    } finally {
      setManualSaving(false);
    }
  }

  return (
    <section className="card reports-panel">
      <div className="section-heading reports-heading">
        <div><span className="eyebrow">RELATÓRIO OPERACIONAL</span><h2>Registros de ponto</h2><p className="small-muted">Consulte, confira evidências e exporte as marcações salvas no sistema.</p></div>
        <div className="report-actions"><button type="button" className="primary-btn" onClick={() => setManualOpen((open) => !open)}>Lançar marcação manual</button><button type="button" className="ghost-btn" onClick={exportCsv} disabled={loading || !records.length}>Exportar CSV</button><button type="button" className="primary-btn" onClick={() => void load()} disabled={loading}>{loading ? 'Atualizando...' : 'Atualizar'}</button></div>
      </div>

      {manualOpen ? <form className="punch-action-box manual-punch-box" onSubmit={(event) => void submitManualPunch(event)}><div><span className="eyebrow">AJUSTE AUDITADO</span><h3>Lançar marcação manual</h3><p className="small-muted">Use quando o colaborador esquecer uma batida. A marcação será identificada como ajuste manual.</p></div><div className="punch-action-fields"><label className="small-muted">Colaborador<select className="input" required value={manualEmployeeId} onChange={(event) => setManualEmployeeId(event.target.value)}><option value="">Selecione um colaborador</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.employeeNumber || 'sem matrícula'} — {employee.name}</option>)}</select></label><label className="small-muted">Tipo<select className="input" value={manualType} onChange={(event) => setManualType(event.target.value)}><option value="ENTRADA">Entrada</option><option value="INTERVALO">Intervalo</option><option value="RETORNO">Retorno</option><option value="SAIDA">Saída</option></select></label><label className="small-muted">Data<input className="input" type="date" required value={manualDate} onChange={(event) => setManualDate(event.target.value)} /></label><label className="small-muted">Horário<input className="input" type="time" required value={manualTime} onChange={(event) => setManualTime(event.target.value)} /></label></div><label className="small-muted">Motivo obrigatório<textarea className="input" rows={3} minLength={5} required value={manualReason} onChange={(event) => setManualReason(event.target.value)} placeholder="Ex.: colaborador esqueceu de registrar a entrada" /></label><div className="row-actions"><button type="button" className="ghost-btn" onClick={() => setManualOpen(false)}>Cancelar</button><button type="submit" className="primary-btn" disabled={manualSaving || !manualEmployeeId || manualReason.trim().length < 5}>{manualSaving ? 'Registrando...' : 'Registrar marcação'}</button></div></form> : null}

      <div className="report-filters">
        <label className="small-muted">Data inicial<input className="input" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label className="small-muted">Data final<input className="input" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <label className="small-muted">Colaborador<select className="input" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}><option value="">Todos os colaboradores</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.employeeNumber || 'sem matrícula'} — {employee.name}</option>)}</select></label>
        <label className="small-muted">Tipo<select className="input" value={type} onChange={(event) => setType(event.target.value)}><option value="ALL">Todos os tipos</option><option value="ENTRADA">Entrada</option><option value="INTERVALO">Intervalo</option><option value="RETORNO">Retorno</option><option value="SAIDA">Saída</option></select></label>
        <label className="small-muted">Status<select className="input" value={status} onChange={(event) => setStatus(event.target.value)}><option value="VALID">Válidos</option><option value="ALL">Todos</option><option value="REJECTED">Rejeitados</option><option value="PENDING">Pendentes</option></select></label>
      </div>

      <div className="report-summary"><div className="summary"><span className="small-muted">Registros encontrados</span><strong>{counts.total}</strong></div><div className="summary"><span className="small-muted">Entradas</span><strong>{counts.entries}</strong></div><div className="summary"><span className="small-muted">Saídas</span><strong>{counts.exits}</strong></div><div className="summary"><span className="small-muted">Com foto</span><strong>{counts.photos}</strong></div></div>
      {lastUpdated ? <div className="report-updated">Atualizado às {lastUpdated.toLocaleTimeString('pt-BR')}</div> : null}
      {actionRecord && actionMode ? <form className="punch-action-box" onSubmit={submitAction}><div><span className="eyebrow">TRATAMENTO AUDITADO</span><h3>{actionMode === 'cancel' ? 'Cancelar marcação' : 'Editar marcação'}</h3><p className="small-muted">{actionRecord.user.name} · {new Date(actionRecord.timestamp).toLocaleString('pt-BR')}</p></div>{actionMode === 'edit' ? <div className="punch-action-fields"><label className="small-muted">Tipo<select className="input" value={actionType} onChange={(event) => setActionType(event.target.value)}><option value="ENTRADA">Entrada</option><option value="INTERVALO">Intervalo</option><option value="RETORNO">Retorno</option><option value="SAIDA">Saída</option></select></label><label className="small-muted">Data e hora<input className="input" type="datetime-local" value={actionTimestamp} onChange={(event) => setActionTimestamp(event.target.value)} /></label></div> : <div className="status-msg">O registro original será preservado e ficará com status “Rejeitado”.</div>}<label className="small-muted">Motivo obrigatório<textarea className="input" rows={3} minLength={5} required value={actionReason} onChange={(event) => setActionReason(event.target.value)} placeholder="Descreva o motivo do tratamento" /></label><div className="row-actions"><button type="button" className="ghost-btn" onClick={() => { setActionRecord(null); setActionMode(null); }}>Voltar</button><button type="submit" className={actionMode === 'cancel' ? 'danger-btn' : 'primary-btn'} disabled={actionSaving || actionReason.trim().length < 5}>{actionSaving ? 'Salvando...' : actionMode === 'cancel' ? 'Confirmar cancelamento' : 'Salvar edição'}</button></div></form> : null}
      {message ? <div className="status-msg admin-toast">{message}</div> : null}
      {error ? <div className="status-msg" style={{ marginTop: 14 }}>{error}</div> : null}
      {loading ? <p className="small-muted" style={{ marginTop: 16 }}>Buscando registros...</p> : null}
      {!loading && !records.length ? <div className="report-empty"><strong>Nenhum registro encontrado</strong><span>Ajuste o período ou os filtros para consultar outras marcações.</span></div> : null}
      {records.length ? <div className="report-table-wrap"><table className="report-table"><thead><tr><th>Data e hora</th><th>Colaborador</th><th>Tipo</th><th>Status</th><th>Origem</th><th>Evidência</th><th>Ações</th></tr></thead><tbody>{records.map((record) => <tr key={record.id}><td><strong>{new Date(record.timestamp).toLocaleDateString('pt-BR')}</strong><div className="small-muted">{new Date(record.timestamp).toLocaleTimeString('pt-BR')}</div></td><td><strong>{record.user.name}</strong><div className="small-muted">{record.user.employeeNumber || 'Sem matrícula'}{record.user.jobTitle ? ` · ${record.user.jobTitle}` : ''}</div></td><td><span className={`type-badge type-${record.type.toLowerCase()}`}>{typeLabels[record.type] || record.type}</span></td><td><span className={`status-pill ${record.status === 'VALID' ? 'ok' : 'off'}`}>{statusLabels[record.status] || record.status}</span></td><td>{record.origin || 'WEB'}</td><td>{record.hasPhoto ? <a href={`/api/admin/punches/${record.id}/photo`} target="_blank" rel="noreferrer">Ver foto</a> : <span className="small-muted">Sem foto</span>}</td><td><div className="row-actions"><button type="button" className="ghost-btn compact-btn" onClick={() => openAction(record, 'edit')} disabled={record.status === 'REJECTED'}>Editar</button><button type="button" className="danger-link" onClick={() => openAction(record, 'cancel')} disabled={record.status === 'REJECTED'}>Excluir</button></div></td></tr>)}</tbody></table></div> : null}
    </section>
  );
}
