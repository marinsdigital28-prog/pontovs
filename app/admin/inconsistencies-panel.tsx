'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type EmployeeOption = { id: string; name: string; employeeNumber: string | null };
type Issue = {
  id: string;
  userId: string;
  type: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW' | string;
  status: string;
  description: string | null;
  detectedAt: string;
  date?: string;
  weekday?: string;
  missingTypes?: string[];
  duplicateTypes?: string[];
  suggestedTimes?: Record<string, string>;
  actualPunches?: Array<{ id: string; type: string; timestamp: string }>;
  expectedMinutes?: number | null;
  workedMinutes?: number | null;
  user: EmployeeOption;
};

type Props = { employees: EmployeeOption[]; onOpenPunches: () => void };

const tz = 'America/Sao_Paulo';
const dateFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, dateStyle: 'short' });
const typeLabels: Record<string, string> = {
  ABSENCE: 'Ausência completa',
  MISSING_PUNCHES: 'Batidas faltantes',
  DUPLICATE_PUNCHES: 'Batidas duplicadas',
  INVALID_SEQUENCE: 'Sequência inválida',
  LATE_ENTRY: 'Entrada atrasada',
  UNDERWORKED: 'Jornada abaixo do previsto',
};

function todayKey() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}
function monthStart() {
  return `${todayKey().slice(0, 7)}-01`;
}
function labelType(type: string) {
  return type.split('+').map((part) => typeLabels[part] || part.replaceAll('_', ' ')).join(' · ');
}
function minutes(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(Math.round(value));
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
}

export default function InconsistenciesPanel({ employees, onOpenPunches }: Props) {
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(todayKey);
  const [employeeId, setEmployeeId] = useState('');
  const [query, setQuery] = useState('');
  const [severity, setSeverity] = useState('TODOS');
  const [issues, setIssues] = useState<Issue[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setMessage('');
    try {
      const params = new URLSearchParams({ from, to });
      if (employeeId) params.set('employeeId', employeeId);
      const response = await fetch(`/api/admin/inconsistencies?${params.toString()}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Não foi possível analisar o período.');
      setIssues(Array.isArray(data.inconsistencies) ? data.inconsistencies : []);
      setSelected(new Set());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível carregar as inconsistências.');
    } finally {
      setLoading(false);
    }
  }, [employeeId, from, to]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('pt-BR');
    return issues.filter((issue) => {
      const text = `${issue.user.name} ${issue.user.employeeNumber || ''} ${issue.type} ${issue.description || ''}`.toLocaleLowerCase('pt-BR');
      return (!normalized || text.includes(normalized)) && (severity === 'TODOS' || issue.severity === severity);
    });
  }, [issues, query, severity]);

  const counts = useMemo(() => ({
    total: issues.length,
    high: issues.filter((i) => i.severity === 'HIGH').length,
    medium: issues.filter((i) => i.severity === 'MEDIUM').length,
    low: issues.filter((i) => i.severity === 'LOW').length,
  }), [issues]);

  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allFilteredSelected = filtered.length > 0 && filtered.every((issue) => selected.has(issue.id));
  const toggleAll = () => setSelected((current) => {
    const next = new Set(current);
    if (allFilteredSelected) filtered.forEach((issue) => next.delete(issue.id));
    else filtered.forEach((issue) => next.add(issue.id));
    return next;
  });

  const resolve = async (ids: string[], preset?: string) => {
    const finalReason = (preset || reason).trim();
    if (!ids.length) return setMessage('Selecione ao menos uma inconsistência.');
    if (finalReason.length < 5) return setMessage('Informe como a inconsistência foi tratada (mínimo de 5 caracteres).');
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin/inconsistencies', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, status: 'RESOLVED', reason: finalReason }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Não foi possível registrar o tratamento.');
      setMessage(`${data.updated || ids.length} inconsistência(s) tratada(s) e registrada(s) na auditoria.`);
      setReason('');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível registrar o tratamento.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card">
      <div className="section-heading">
        <div><span className="eyebrow">ANÁLISE ASSISTIDA</span><h2>Inconsistências</h2><p className="small-muted">Encontre, entenda e trate todas as ocorrências do período sem perder a trilha de auditoria.</p></div>
        <button type="button" className="ghost-btn" onClick={() => void load()} disabled={loading}>{loading ? 'Analisando...' : 'Reanalisar período'}</button>
      </div>

      <div className="admin-form" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
        <label className="small-muted">De<input className="input" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label className="small-muted">Até<input className="input" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <label className="small-muted">Colaborador<select className="input" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}><option value="">Todos</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} · {employee.employeeNumber || 'sem matrícula'}</option>)}</select></label>
        <label className="small-muted">Buscar<input className="input" placeholder="nome, matrícula ou tipo" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <label className="small-muted">Gravidade<select className="input" value={severity} onChange={(event) => setSeverity(event.target.value)}><option value="TODOS">Todas</option><option value="HIGH">Alta</option><option value="MEDIUM">Média</option><option value="LOW">Baixa</option></select></label>
      </div>

      <div className="stat-grid admin-stat-grid" style={{ marginBottom: 16 }}>
        <div className={`summary ${counts.total ? 'summary-alert' : 'summary-ok'}`}><span className="small-muted">Encontradas</span><strong>{counts.total}</strong></div>
        <div className="summary summary-alert"><span className="small-muted">Alta prioridade</span><strong>{counts.high}</strong></div>
        <div className="summary summary-warn"><span className="small-muted">Média prioridade</span><strong>{counts.medium}</strong></div>
        <div className="summary"><span className="small-muted">Selecionadas</span><strong>{selected.size}</strong></div>
      </div>

      {message ? <div className="status-msg admin-toast" role="status">{message}</div> : null}
      <div className="section-heading" style={{ marginBottom: 10 }}>
        <label className="small-muted" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input type="checkbox" checked={allFilteredSelected} onChange={toggleAll} /> Selecionar filtradas ({filtered.length})</label>
        <button type="button" className="ghost-btn" onClick={onOpenPunches} disabled={!selected.size}>Abrir registros para corrigir marcações</button>
      </div>

      {selected.size ? <div className="card" style={{ background: '#fffaf0', border: '1px solid #ead59a', marginBottom: 14, padding: 12 }}>
        <strong>Tratamento em lote</strong>
        <p className="small-muted" style={{ margin: '4px 0 8px' }}>A correção não apaga batidas: apenas registra a decisão do gestor e mantém a ocorrência auditável.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
          <label className="small-muted" style={{ flex: '1 1 300px' }}>Motivo da correção<input className="input" placeholder="Ex.: batida ajustada na folha após conferência" value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          <button type="button" className="primary-btn" disabled={saving} onClick={() => void resolve([...selected])}>{saving ? 'Registrando...' : `Resolver ${selected.size}`}</button>
          <button type="button" className="ghost-btn" disabled={saving} onClick={() => void resolve([...selected], 'Não procede após conferência do gestor')}>Não procede</button>
        </div>
      </div> : null}

      {!filtered.length ? <div className="report-empty"><strong>{loading ? 'Analisando período...' : 'Nenhuma inconsistência encontrada'}</strong><span>O filtro atual não retornou ocorrências abertas para revisão.</span></div> : <div className="employee-list">
        {filtered.map((issue) => <article className="employee-row" key={issue.id} style={{ alignItems: 'flex-start', gap: 12 }}>
          <input type="checkbox" checked={selected.has(issue.id)} onChange={() => toggle(issue.id)} aria-label={`Selecionar ${issue.user.name}`} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}><strong>{issue.user.name}</strong><span className={`status-pill ${issue.severity === 'HIGH' ? 'danger' : issue.severity === 'MEDIUM' ? 'pending' : 'ok'}`}>{issue.severity === 'HIGH' ? 'Alta' : issue.severity === 'MEDIUM' ? 'Média' : 'Baixa'}</span><span className="small-muted">{issue.date ? dateFmt.format(new Date(`${issue.date}T12:00:00-03:00`)) : dateFmt.format(new Date(issue.detectedAt))}</span></div>
            <div className="small-muted" style={{ marginTop: 4 }}><strong>{labelType(issue.type)}</strong>{issue.description ? ` — ${issue.description}` : ''}</div>
            {issue.missingTypes?.length ? <div className="small-muted">Faltam: {issue.missingTypes.join(', ')}{issue.suggestedTimes ? ` · Sugestão: ${Object.entries(issue.suggestedTimes).filter(([key]) => issue.missingTypes?.includes(key)).map(([key, value]) => `${key} ${value}`).join(' · ')}` : ''}</div> : null}
            {issue.duplicateTypes?.length ? <div className="small-muted">Duplicadas: {issue.duplicateTypes.join(', ')}</div> : null}
            {issue.expectedMinutes !== undefined ? <div className="small-muted">Previsto: {minutes(issue.expectedMinutes)} · Trabalhado: {minutes(issue.workedMinutes)}</div> : null}
          </div>
          <button type="button" className="primary-btn compact-btn" disabled={saving} onClick={() => { setSelected(new Set([issue.id])); setReason(''); }}>Tratar</button>
        </article>)}
      </div>}
    </section>
  );
}
