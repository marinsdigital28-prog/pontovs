'use client';

import { FormEvent, useMemo, useState } from 'react';
import { validateProfile } from '../../lib/employee-validation';

type Employee = { id: string; name: string; employeeNumber: string; jobTitle: string | null; workDays: string | null; scheduleStart: string | null; scheduleEnd: string | null };
type Punch = { id: string; type: string; timestamp: string };
type HistoryResponse = { employee: Employee; punches: Punch[]; error?: string };
type ActivePanel = 'overview' | 'absence' | 'exchange' | 'profile';

function formatDate(value: string) { return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)); }
function normalizeEmployeeNumber(value: string) { return value.replace(/\D/g, '').padStart(4, '0'); }

export default function ColaboradorPage() {
  const [employeeNumber, setEmployeeNumber] = useState('');
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activePanel, setActivePanel] = useState<ActivePanel>('overview');
  const [notice, setNotice] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [profileEmail, setProfileEmail] = useState('');
  const [profileErrors, setProfileErrors] = useState<string[]>([]);

  async function loadHistory(event?: FormEvent) {
    event?.preventDefault();
    const normalized = normalizeEmployeeNumber(employeeNumber);
    if (!normalized || normalized === '0000') return setError('Digite uma matrícula de colaborador válida.');
    setLoading(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/employee/history?employeeNumber=${normalized}`, { cache: 'no-store' });
      const payload = await response.json() as HistoryResponse;
      if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar os dados.');
      setData(payload); setActivePanel('overview');
    } catch (err) { setData(null); setError(err instanceof Error ? err.message : 'Falha ao consultar o portal.'); }
    finally { setLoading(false); }
  }

  const punchesByDay = useMemo(() => {
    const map = new Map<string, Punch[]>();
    for (const punch of data?.punches ?? []) { const key = new Date(punch.timestamp).toLocaleDateString('pt-BR'); map.set(key, [...(map.get(key) ?? []), punch]); }
    return [...map.entries()];
  }, [data]);

  function submitRequest(event: FormEvent<HTMLFormElement>, label: string) { event.preventDefault(); setNotice(`${label} registrada no modo de teste local. No próximo deploy, ela será enviada para aprovação do gestor.`); setActivePanel('overview'); }
  function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const errors = validateProfile({
      cpf: String(form.get('cpf') || ''), birthDate: String(form.get('birthDate') || ''), jobTitle: String(form.get('jobTitle') || ''), unit: String(form.get('unit') || ''), workDays: String(form.get('workDays') || ''), scheduleStart: String(form.get('scheduleStart') || ''), scheduleEnd: String(form.get('scheduleEnd') || ''), whatsapp: String(form.get('whatsapp') || ''), email: String(form.get('email') || ''),
    });
    const messages = Object.values(errors).filter((message): message is string => Boolean(message));
    if (messages.length) { setProfileErrors(messages); setNotice('Revise os campos obrigatórios antes de enviar.'); return; }
    setProfileErrors([]); setNotice('Dados de perfil validados e enviados para análise no modo de teste local. A jornada só muda após aprovação do gestor.'); setActivePanel('overview');
  }

  return <main className="employee-portal">
    <header className="employee-portal-header"><div><span className="eyebrow">PONTO PROGREDIR · PORTAL</span><h1>Área do colaborador</h1><p>Consulte sua jornada, confirme marcações e envie solicitações.</p></div><div className="employee-header-actions"><span className="local-badge">TESTE LOCAL · SEM BATIDA PELO CELULAR</span></div></header>

    <section className="employee-lookup panel"><div><h2>Identificação</h2><p>Use sua matrícula para consultar suas informações e o histórico. A batida é feita somente no relógio autorizado.</p></div><form onSubmit={loadHistory}><label htmlFor="employee-number">Matrícula</label><div className="employee-lookup-row"><input id="employee-number" inputMode="numeric" maxLength={8} value={employeeNumber} onChange={event => setEmployeeNumber(event.target.value.replace(/\D/g, ''))} placeholder="Ex.: 4041"/><button className="primary-btn" type="submit" disabled={loading}>{loading ? 'Carregando…' : 'Acessar portal'}</button></div></form>{error && <p className="form-error" role="alert">{error}</p>}</section>

    {!data && !loading && <section className="employee-feature-grid"><div className="panel"><span className="feature-icon">✓</span><h2>Confirmações de ponto</h2><p>Veja data, hora e tipo de cada registro aceito pelo sistema.</p></div><div className="panel"><span className="feature-icon">▦</span><h2>Fechamento mensal</h2><p>Acompanhe dias trabalhados, faltas, saldo e o que falta para fechar o mês.</p></div><div className="panel"><span className="feature-icon">＋</span><h2>Solicitações</h2><p>Teste ausência, troca de dia e atualização cadastral em um único lugar.</p></div></section>}

    {data && <section className="employee-dashboard"><div className="employee-profile panel"><div><span className="eyebrow">COLABORADOR IDENTIFICADO</span><h2>{data.employee.name}</h2><p>{data.employee.jobTitle || 'Cargo não informado'} · matrícula {data.employee.employeeNumber}</p></div><div className="employee-schedule"><strong>{data.employee.scheduleStart || '--:--'} — {data.employee.scheduleEnd || '--:--'}</strong><span>{data.employee.workDays || 'Jornada não informada'}</span></div></div>
      <nav className="employee-action-tabs" aria-label="Ações do colaborador"><button className={activePanel === 'overview' ? 'active' : ''} onClick={() => setActivePanel('overview')}>Resumo</button><button className={activePanel === 'absence' ? 'active' : ''} onClick={() => setActivePanel('absence')}>Informar ausência</button><button className={activePanel === 'exchange' ? 'active' : ''} onClick={() => setActivePanel('exchange')}>Trocar dia</button><button className={activePanel === 'profile' ? 'active' : ''} onClick={() => setActivePanel('profile')}>Minhas informações</button></nav>
      {notice && <div className="employee-notice" role="status">✓ {notice}<button type="button" onClick={() => setNotice('')} aria-label="Fechar aviso">×</button></div>}
      {activePanel === 'absence' && <form className="panel employee-form" onSubmit={event => submitRequest(event, 'Solicitação de ausência')}><span className="eyebrow">NOVA SOLICITAÇÃO</span><h2>Informar ausência</h2><p>O gestor receberá a solicitação para análise.</p><label>Data<input required type="date" name="date" /></label><label>Motivo<select required name="reason" defaultValue=""><option value="" disabled>Selecione o motivo</option><option>Atestado médico</option><option>Compromisso pessoal</option><option>Ausência previamente autorizada</option><option>Outro motivo</option></select></label><label>Observação<textarea name="note" rows={3} placeholder="Detalhes opcionais" /></label><button className="primary-btn" type="submit">Enviar para aprovação</button></form>}
      {activePanel === 'exchange' && <form className="panel employee-form" onSubmit={event => submitRequest(event, 'Solicitação de troca de dia')}><span className="eyebrow">AJUSTE DE JORNADA</span><h2>Trocar dia trabalhado</h2><p>Informe o dia original e a nova data pretendida.</p><div className="form-two-col"><label>Dia original<input required type="date" name="from" /></label><label>Novo dia<input required type="date" name="to" /></label></div><label>Motivo<textarea required name="reason" rows={3} placeholder="Explique a troca de dia" /></label><button className="primary-btn" type="submit">Enviar troca para aprovação</button></form>}
      {activePanel === 'profile' && <form className="panel employee-form" onSubmit={saveProfile}><span className="eyebrow">DADOS CADASTRAIS OBRIGATÓRIOS</span><h2>Minhas informações</h2><p>Confira e atualize seus dados. A jornada fica sujeita à aprovação do gestor.</p>{profileErrors.length > 0 && <div className="form-error" role="alert">{profileErrors.map(error => <div key={error}>{error}</div>)}</div>}<label>Nome completo<input value={data.employee.name} readOnly /></label><div className="form-two-col"><label>CPF<input required name="cpf" inputMode="numeric" placeholder="000.000.000-00" /></label><label>Data de nascimento<input required name="birthDate" type="date" /></label></div><label>Cargo<input required name="jobTitle" defaultValue={data.employee.jobTitle || ''} placeholder="Informe seu cargo" /></label><label>Unidade<select required name="unit" defaultValue=""><option value="" disabled>Selecione a unidade</option><option>Espaço Educacional Progredir</option><option>Espaço Progredir</option></select></label><label>Dias da semana trabalhados<input required name="workDays" defaultValue={data.employee.workDays || ''} placeholder="Ex.: Seg, Ter, Qua, Qui, Sex" /></label><div className="form-two-col"><label>Início da jornada<input required name="scheduleStart" type="time" defaultValue={data.employee.scheduleStart || ''} /></label><label>Fim da jornada<input required name="scheduleEnd" type="time" defaultValue={data.employee.scheduleEnd || ''} /></label></div><div className="form-two-col"><label>WhatsApp<input required name="whatsapp" value={profilePhone} onChange={event => setProfilePhone(event.target.value)} placeholder="(00) 00000-0000" /></label><label>E-mail<input required type="email" name="email" value={profileEmail} onChange={event => setProfileEmail(event.target.value)} placeholder="seu@email.com" /></label></div><button className="primary-btn" type="submit">Enviar atualização para análise</button></form>}
      {activePanel === 'overview' && <><div className="employee-stat-grid"><div className="summary"><span>Marcações recentes</span><strong>{data.punches.length}</strong></div><div className="summary"><span>Dias com registro</span><strong>{punchesByDay.length}</strong></div><div className="summary"><span>Status</span><strong className="status-pill ok">Ativo</strong></div></div><div className="employee-content-grid"><div className="panel"><div className="section-heading"><div><span className="eyebrow">HISTÓRICO REAL</span><h2>Suas marcações</h2></div><span className="local-badge">BATIDA SOMENTE NO RELÓGIO</span></div>{punchesByDay.length ? <div className="employee-punch-list">{punchesByDay.map(([day, punches]) => <div className="employee-day" key={day}><strong>{day}</strong>{punches.map(punch => <div className="employee-punch" key={punch.id}><span>{punch.type}</span><time>{formatDate(punch.timestamp)}</time></div>)}</div>)}</div> : <div className="report-empty"><strong>Nenhuma marcação recente encontrada.</strong><span>Quando você registrar pelo `/ponto`, ela aparecerá aqui.</span></div>}</div><div className="panel employee-next-steps"><span className="eyebrow">FECHAMENTO DO MÊS</span><h2>Acompanhe sua jornada</h2><div className="month-progress"><span style={{ width: `${Math.min(100, punchesByDay.length * 4)}%` }} /></div><p><strong>{punchesByDay.length}</strong> dias com registro no período consultado. O gestor poderá revisar faltas, atrasos e saldo no fechamento.</p><button className="ghost-btn" type="button" onClick={() => setActivePanel('absence')}>Informar ausência</button><button className="ghost-btn" type="button" onClick={() => setActivePanel('exchange')}>Solicitar troca de dia</button></div></div></>}</section>}
    <footer className="admin-footer">Desenvolvido por Marins Digital</footer>
  </main>;
}
