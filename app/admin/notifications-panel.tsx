'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type NotificationRow = {
  id: string;
  status: 'AGUARDANDO_ENVIO' | 'SEM_EMAIL';
  recipient: string | null;
  employee: { id: string; name: string; employeeNumber: string | null; email: string | null };
  type: string;
  timestamp: string;
  origin: string;
  canResend: boolean;
};

type ApiResponse = {
  notifications: NotificationRow[];
  integration: { provider: string; automaticDispatch: boolean; message: string };
  summary: { total: number; awaiting: number; missingEmail: number };
};

const TYPE_LABEL: Record<string, string> = { ENTRADA: 'Entrada', INTERVALO: 'Intervalo', RETORNO: 'Retorno', SAIDA: 'Saída' };
const STATUS_LABEL: Record<NotificationRow['status'], string> = { AGUARDANDO_ENVIO: 'Aguardando integração', SEM_EMAIL: 'Sem e-mail' };

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(value));
}

export default function NotificationsPanel() {
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [summary, setSummary] = useState<ApiResponse['summary']>({ total: 0, awaiting: 0, missingEmail: 0 });
  const [integration, setIntegration] = useState<ApiResponse['integration'] | null>(null);
  const [status, setStatus] = useState<'TODOS' | NotificationRow['status']>('TODOS');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ status });
    if (search.trim()) params.set('search', search.trim());
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    try {
      const response = await fetch(`/api/admin/notifications?${params.toString()}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Não foi possível carregar as notificações.');
      setRows(Array.isArray(data.notifications) ? data.notifications : []);
      setSummary(data.summary || { total: 0, awaiting: 0, missingEmail: 0 });
      setIntegration(data.integration || null);
      setUpdatedAt(new Date());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar as notificações.');
    } finally {
      setLoading(false);
    }
  }, [from, search, status, to]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 15000); return () => window.clearInterval(timer); }, [load]);

  const filteredRows = useMemo(() => rows.filter((row) => `${row.employee.name} ${row.employee.employeeNumber || ''} ${row.recipient || ''}`.toLowerCase().includes(search.toLowerCase())), [rows, search]);

  return <section className="notifications-center">
    <div className="card notifications-hero">
      <div><span className="eyebrow">COMUNICAÇÃO OPERACIONAL</span><h2>Central de Notificações</h2><p className="small-muted">Acompanhe a confirmação por e-mail vinculada às batidas válidas, sem interferir no registro do ponto.</p></div>
      <button type="button" className="ghost-btn" onClick={() => void load()} disabled={loading}>{loading ? 'Atualizando...' : 'Atualizar agora'}</button>
    </div>

    {integration ? <div className={`notification-integration ${integration.automaticDispatch ? 'ready' : 'attention'}`}><span className="notification-status-dot" aria-hidden="true" /><div><strong>{integration.automaticDispatch ? 'Envio automático ativo' : 'Envio automático ainda não conectado'}</strong><p>{integration.message}</p></div><span className="status-pill">{integration.provider}</span></div> : null}

    <div className="notification-stats"><div className="summary"><span className="small-muted">Registros no filtro</span><strong>{summary.total}</strong></div><div className="summary"><span className="small-muted">Aguardando envio</span><strong>{summary.awaiting}</strong></div><div className="summary"><span className="small-muted">Sem e-mail válido</span><strong>{summary.missingEmail}</strong></div></div>

    <div className="card notification-filters"><div className="section-heading"><div><h3>Fila e histórico</h3><p className="small-muted">A lista é atualizada automaticamente a cada 15 segundos.</p></div><span className="small-muted">{updatedAt ? `Atualizado às ${updatedAt.toLocaleTimeString('pt-BR')}` : 'Aguardando dados...'}</span></div><div className="notification-filter-grid"><label className="small-muted">Buscar<input className="input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nome, matrícula ou e-mail" /></label><label className="small-muted">De<input className="input" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label className="small-muted">Até<input className="input" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><label className="small-muted">Status<select className="input" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="TODOS">Todos</option><option value="AGUARDANDO_ENVIO">Aguardando integração</option><option value="SEM_EMAIL">Sem e-mail</option></select></label></div></div>

    {error ? <div className="status-msg admin-toast">{error}</div> : null}
    <div className="card notification-table-card">{loading && !rows.length ? <p className="small-muted">Carregando registros de notificação...</p> : !filteredRows.length ? <div className="notification-empty"><span aria-hidden="true">✉</span><h3>Nenhum registro encontrado</h3><p className="small-muted">As confirmações aparecerão aqui depois que houver batidas válidas no período selecionado.</p></div> : <div className="notification-table" role="table" aria-label="Histórico de notificações"><div className="notification-row notification-header" role="row"><span>Colaborador</span><span>Batida</span><span>Destinatário</span><span>Status</span><span>Ação</span></div>{filteredRows.map((row) => <div className="notification-row" role="row" key={row.id}><span><strong>{row.employee.name}</strong><small>{row.employee.employeeNumber || 'Sem matrícula'} · {formatDate(row.timestamp)}</small></span><span><strong>{TYPE_LABEL[row.type] || row.type}</strong><small>{row.origin}</small></span><span className="notification-recipient">{row.recipient || 'Nenhum e-mail cadastrado'}</span><span><span className={`status-pill ${row.status === 'SEM_EMAIL' ? 'off' : 'pending'}`}>{STATUS_LABEL[row.status]}</span></span><button type="button" className="ghost-btn" disabled title="Disponível quando o envio automático estiver integrado">Reenviar</button></div>)}</div>}</div>

    <div className="card notification-note"><strong>Como esta tela funciona</strong><p className="small-muted">A batida é a fonte oficial. O e-mail deve ser processado depois da confirmação do banco; falhas de envio não invalidam o ponto. O botão Reenviar ficará disponível quando a fila de e-mail estiver integrada ao backend.</p></div>
  </section>;
}
