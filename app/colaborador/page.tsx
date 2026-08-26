'use client';

import { FormEvent, useMemo, useState } from 'react';

type Employee = { id: string; name: string; employeeNumber: string; jobTitle: string | null; workDays: string | null; scheduleStart: string | null; scheduleEnd: string | null };
type Punch = { id: string; type: string; timestamp: string };

type HistoryResponse = { employee: Employee; punches: Punch[]; error?: string };

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

export default function ColaboradorPage() {
  const [employeeNumber, setEmployeeNumber] = useState('');
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function loadHistory(event?: FormEvent) {
    event?.preventDefault();
    const normalized = employeeNumber.replace(/\D/g, '').padStart(4, '0');
    if (!normalized) return setError('Digite sua matrícula para consultar seu portal.');
    setLoading(true); setError('');
    try {
      const response = await fetch(`/api/employee/history?employeeNumber=${normalized}`, { cache: 'no-store' });
      const payload = await response.json() as HistoryResponse;
      if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar os dados.');
      setData(payload);
    } catch (err) { setData(null); setError(err instanceof Error ? err.message : 'Falha ao consultar o portal.'); }
    finally { setLoading(false); }
  }

  const punchesByDay = useMemo(() => {
    const map = new Map<string, Punch[]>();
    for (const punch of data?.punches ?? []) {
      const key = new Date(punch.timestamp).toLocaleDateString('pt-BR');
      map.set(key, [...(map.get(key) ?? []), punch]);
    }
    return [...map.entries()];
  }, [data]);

  return <main className="employee-portal">
    <header className="employee-portal-header">
      <div><span className="eyebrow">PONTO PROGREDIR</span><h1>Portal do colaborador</h1><p>Consulte suas marcações e acompanhe o fechamento do mês.</p></div>
      <a className="ghost-btn" href="/ponto">Registrar ponto</a>
    </header>

    <section className="employee-lookup panel">
      <div><h2>Seu acesso</h2><p>Informe sua matrícula para consultar os dados vinculados ao seu cadastro.</p></div>
      <form onSubmit={loadHistory}><label htmlFor="employee-number">Matrícula</label><div className="employee-lookup-row"><input id="employee-number" inputMode="numeric" maxLength={8} value={employeeNumber} onChange={event => setEmployeeNumber(event.target.value.replace(/\D/g, ''))} placeholder="Ex.: 4041"/><button className="primary-btn" type="submit" disabled={loading}>{loading ? 'Carregando…' : 'Entrar no portal'}</button></div></form>
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>

    {!data && !loading && <section className="employee-feature-grid"><div className="panel"><span className="feature-icon">✓</span><h2>Confirmações de ponto</h2><p>Veja as marcações aceitas pelo sistema, com data, hora e tipo de batida.</p></div><div className="panel"><span className="feature-icon">▦</span><h2>Calendário mensal</h2><p>Acompanhe dias trabalhados, faltas, saldo e o progresso do fechamento.</p></div><div className="panel"><span className="feature-icon">＋</span><h2>Solicitações</h2><p>O portal será o caminho para ausências, trocas de dia e atualização cadastral com aprovação do gestor.</p></div></section>}

    {data && <section className="employee-dashboard"><div className="employee-profile panel"><div><span className="eyebrow">COLABORADOR IDENTIFICADO</span><h2>{data.employee.name}</h2><p>{data.employee.jobTitle || 'Cargo não informado'} · matrícula {data.employee.employeeNumber}</p></div><div className="employee-schedule"><strong>{data.employee.scheduleStart || '--:--'} — {data.employee.scheduleEnd || '--:--'}</strong><span>{data.employee.workDays || 'Jornada não informada'}</span></div></div><div className="employee-stat-grid"><div className="summary"><span>Marcações recentes</span><strong>{data.punches.length}</strong></div><div className="summary"><span>Período consultado</span><strong>30 dias</strong></div><div className="summary"><span>Status</span><strong className="status-pill ok">Ativo</strong></div></div><div className="employee-content-grid"><div className="panel"><div className="section-heading"><div><span className="eyebrow">HISTÓRICO</span><h2>Suas marcações</h2></div><a className="ghost-btn" href="/admin">Falar com gestor</a></div>{punchesByDay.length ? <div className="employee-punch-list">{punchesByDay.map(([day, punches]) => <div className="employee-day" key={day}><strong>{day}</strong>{punches.map(punch => <div className="employee-punch" key={punch.id}><span>{punch.type}</span><time>{formatDate(punch.timestamp)}</time></div>)}</div>)}</div> : <div className="report-empty"><strong>Nenhuma marcação recente encontrada.</strong><span>Quando você registrar pelo `/ponto`, ela aparecerá aqui.</span></div>}</div><div className="panel employee-next-steps"><span className="eyebrow">PRÓXIMOS RECURSOS</span><h2>Gestão da sua jornada</h2><p>Estamos preparando o calendário mensal completo, solicitações de ausência e troca de dia, além da edição de dados pessoais com registro de auditoria.</p><button className="ghost-btn" type="button" disabled>Solicitar ausência (em breve)</button><button className="ghost-btn" type="button" disabled>Atualizar perfil (em breve)</button></div></div></section>}
    <footer className="admin-footer">Desenvolvido por Marins Digital</footer>
  </main>;
}
