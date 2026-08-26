'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type Employee = { id: string; name: string; employeeNumber: string | null };
type RecordItem = {
  id: string;
  type: string;
  timestamp: string;
  status: string;
  origin: string;
  user: { id: string; name: string; employeeNumber: string | null; jobTitle: string | null };
};

const typeLabels: Record<string, string> = { ENTRADA: 'ENTRADA', INTERVALO: 'INTERVALO', RETORNO: 'RETORNO', SAIDA: 'SAÍDA' };

function monthBounds(month: string) {
  const [year, value] = month.split('-').map(Number);
  const lastDay = new Date(year, value, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` };
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('pt-BR');
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatMonth(month: string) {
  const [year, value] = month.split('-').map(Number);
  return new Date(year, value - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

export default function FolhaPontoPanel({ employees }: { employees: Employee[] }) {
  const [month, setMonth] = useState(currentMonth());
  const [employeeId, setEmployeeId] = useState('');
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    const bounds = monthBounds(month);
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ ...bounds, status: 'VALID' });
    if (employeeId) params.set('employeeId', employeeId);
    try {
      const response = await fetch(`/api/admin/punches?${params.toString()}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Não foi possível carregar a folha de ponto.');
      setRecords(Array.isArray(data.records) ? data.records.sort((a: RecordItem, b: RecordItem) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()) : []);
      setLastUpdated(new Date());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar a folha de ponto.');
    } finally {
      setLoading(false);
    }
  }, [employeeId, month]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => { void load(); }, 10000);
    return () => window.clearInterval(timer);
  }, [load]);

  const selectedEmployee = useMemo(() => employees.find((employee) => employee.id === employeeId), [employeeId, employees]);
  const totals = useMemo(() => records.reduce((summary, record) => {
    summary.total += 1;
    summary[record.type as 'ENTRADA' | 'INTERVALO' | 'RETORNO' | 'SAIDA'] += 1;
    return summary;
  }, { total: 0, ENTRADA: 0, INTERVALO: 0, RETORNO: 0, SAIDA: 0 }), [records]);

  return (
    <section className="card timesheet-panel">
      <div className="section-heading timesheet-toolbar no-print">
        <div><span className="eyebrow">FOLHA DE PONTO</span><h2>Relatório oficial de marcações</h2><p className="small-muted">Modelo compatível com o backup diário. Atualização automática a cada 10 segundos.</p></div>
        <div className="report-actions"><button type="button" className="ghost-btn" onClick={() => window.print()}>Imprimir / salvar PDF</button><button type="button" className="primary-btn compact-btn" onClick={() => void load()} disabled={loading}>{loading ? 'Atualizando...' : 'Atualizar agora'}</button></div>
      </div>

      <div className="report-filters no-print">
        <label className="small-muted">Competência<input className="input" type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
        <label className="small-muted">Colaborador<select className="input" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}><option value="">Todos os colaboradores</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.employeeNumber || 'sem matrícula'} — {employee.name}</option>)}</select></label>
      </div>

      {error ? <div className="status-msg no-print">{error}</div> : null}
      <div className="timesheet-paper">
        <header className="timesheet-titlebar"><div><strong>ESPAÇO PROGREDIR — RELATÓRIO OFICIAL DE BACKUP DIÁRIO</strong><span>SISTEMA ELETRÔNICO DE REGISTRO DE PONTO (REP-P) · CONFORME PORTARIA 671 MTE</span></div><div className="timesheet-competence"><b>COMPETÊNCIA: {formatMonth(month).toUpperCase()}</b><span>Data do relatório: {new Date().toLocaleDateString('pt-BR')}</span></div></header>
        <section className="timesheet-section"><h3>1. DADOS DA EMPRESA E METADADOS DO RELATÓRIO</h3><div className="timesheet-meta"><span><b>Razão Social / Nome Fantasia:</b> Espaço Progredir</span><span><b>CNPJ:</b> 05.553.848/0001-61</span><span><b>Endereço:</b> Estrada da Grama, 21 — Miguel Couto · Nova Iguaçu — RJ</span><span><b>Total de colaboradores ativos:</b> {employees.length}</span><span><b>Arquivo:</b> Folha_Ponto_{month}.pdf</span><span><b>Total de marcações no período:</b> {totals.total}</span></div></section>
        <section className="timesheet-section"><h3>2. RELATÓRIO DE TODAS AS MARCAÇÕES DO MÊS ({totals.total} REGISTROS)</h3><div className="timesheet-table-wrap"><table className="timesheet-table"><thead><tr><th>NSR</th><th>DATA</th><th>HORA</th><th>COLABORADOR</th><th>MATRÍCULA</th><th>TIPO DE MARCAÇÃO</th><th>LOCAL / DISPOSITIVO</th></tr></thead><tbody>{records.map((record, index) => <tr key={record.id}><td>{String(index + 1).padStart(6, '0')}</td><td>{formatDate(record.timestamp)}</td><td>{formatTime(record.timestamp)}</td><td>{record.user.name}</td><td>{record.user.employeeNumber || '—'}</td><td>{typeLabels[record.type] || record.type}</td><td>Espaço Progredir · {record.origin || 'WEB'}</td></tr>)}</tbody></table>{!loading && !records.length ? <div className="timesheet-empty">Nenhuma marcação válida encontrada para a competência selecionada.</div> : null}</div></section>
        <footer className="timesheet-footer">{lastUpdated ? `Atualizado em ${lastUpdated.toLocaleString('pt-BR')}. ` : ''}Documento gerado pelo Ponto Progredir. As marcações são lidas diretamente do registro oficial do sistema.</footer>
      </div>
      {selectedEmployee ? <p className="report-updated no-print">Folha individual: {selectedEmployee.name} · matrícula {selectedEmployee.employeeNumber || 'sem matrícula'}</p> : null}
    </section>
  );
}
