'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import PunchesPanel from './punches-panel';
import FolhaPontoPanel from './folha-ponto-panel';
import CsvImporter from './csv-importer';
import PdfImporter from './pdf-importer';
import SignatureSettings from './signature-settings';
import AttendanceAnalytics from './attendance-analytics';
import CertificatesPanel from './certificates-panel';
import RequestsPanel from './requests-panel';
import NotificationsPanel from './notifications-panel';
import HealthCard from './health-card';
import CertificateConflictsPanel from './certificate-conflicts-panel';
import EmployeesPanel from './employees-panel';
import IntegrityCenter from './integrity-center';
import './overview-layout.css';
import OverviewCalendar from './overview-calendar';
import OverviewInbox from './overview-inbox';
import OverviewExitWatch from './overview-exit-watch';
import AbsenceCalendarLive from './absence-calendar-live';

type EmployeeProfile = {
  phone?: string; personalEmail?: string; address?: string; city?: string; uf?: string; cep?: string;
  pis?: string; rg?: string; birthDate?: string; admissionDate?: string; department?: string; ctps?: string;
  motherName?: string; fatherName?: string; [key: string]: string | undefined;
};

type Employee = {
  id: string; name: string; employeeNumber: string | null; cpf?: string | null; jobTitle?: string | null;
  workDays?: string | null; scheduleStart?: string | null; scheduleEnd?: string | null; scheduleByDay?: string | null;
  profile?: EmployeeProfile | null; active: boolean; _count?: { punches: number };
};
type Issue = { id: string; type: string; status: string; description: string | null; detectedAt: string; user: { name: string; employeeNumber: string | null }; punch: { id: string; type: string; timestamp: string } | null };
type AuditEvent = { id: string; action: string; actorId?: string; resource?: string; createdAt: string; hash: string };
type PresenceEmployee = { id: string; name: string; employeeNumber: string | null; jobTitle: string | null; status: 'PRESENTE' | 'NAO_MARCOU' | 'PENDENTE' | 'SAIU' | 'FOLGA'; scheduled: boolean; latestPunch: { id: string; type: string; timestamp: string; status: string; hasPhoto: boolean } | null };

const emptyForm = { name: '', employeeNumber: '', cpf: '', jobTitle: '', workDays: 'SEG,TER,QUA,QUI,SEX', scheduleStart: '08:00', scheduleEnd: '18:00' };

export default function AdminDashboard({ employees: initialEmployees, stats, degraded = false }: { employees: Employee[]; stats: { employeeCount: number; punchesToday: number; openInconsistencies: number }; degraded?: boolean }) {
  const [tab, setTab] = useState('overview');
  const [employees, setEmployees] = useState<Employee[]>(initialEmployees);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [scheduleApplying, setScheduleApplying] = useState(false);
  const [audit, setAudit] = useState<{ chainValid: boolean; events: AuditEvent[]; mode: string } | null>(null);
  const [presence, setPresence] = useState<PresenceEmployee[]>([]);
  const [presenceFilter, setPresenceFilter] = useState<'TODOS' | PresenceEmployee['status']>('TODOS');
  const [presenceUpdatedAt, setPresenceUpdatedAt] = useState<Date | null>(null);

  const loadEmployees = useCallback(async () => { const response = await fetch('/api/admin/employees', { cache: 'no-store' }); if (response.ok) setEmployees((await response.json()).employees || []); }, []);
  const autoApplySchedulePatterns = useCallback(async () => { const response = await fetch('/api/admin/apply-schedule-patterns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'automatic' }) }); if (response.ok) { const data = await response.json().catch(() => ({})); if (data.updated) await loadEmployees(); } }, [loadEmployees]);
  const loadIssues = useCallback(async () => { const response = await fetch('/api/admin/inconsistencies', { cache: 'no-store' }); if (response.ok) setIssues((await response.json()).inconsistencies || []); }, []);
  const loadAudit = useCallback(async () => { const response = await fetch('/api/admin/audit', { cache: 'no-store' }); if (response.ok) setAudit(await response.json()); }, []);
  const loadPresence = useCallback(async () => { const response = await fetch('/api/admin/presence', { cache: 'no-store' }); if (response.ok) { const data = await response.json(); setPresence(Array.isArray(data.employees) ? data.employees : []); setPresenceUpdatedAt(new Date()); } }, []);
  useEffect(() => { void loadIssues(); }, [loadIssues]);
  useEffect(() => { void loadEmployees(); }, [loadEmployees]);
  useEffect(() => { void autoApplySchedulePatterns(); }, [autoApplySchedulePatterns]);
  useEffect(() => { if (tab === 'security') void loadAudit(); }, [tab, loadAudit]);
  useEffect(() => { if (tab !== 'overview') return; void loadPresence(); const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void loadPresence(); }, 10000); return () => window.clearInterval(timer); }, [tab, loadPresence]);

  const filteredPresence = useMemo(() => presenceFilter === 'TODOS' ? presence : presence.filter((employee) => employee.status === presenceFilter), [presence, presenceFilter]);
  const presenceCounts = useMemo(() => presence.reduce((acc, employee) => { acc[employee.status] += 1; return acc; }, { PRESENTE: 0, NAO_MARCOU: 0, PENDENTE: 0, SAIU: 0, FOLGA: 0 } as Record<PresenceEmployee['status'], number>), [presence]);
  const startEdit = (employee: Employee) => { setEditing(employee); setForm({ name: employee.name, employeeNumber: employee.employeeNumber || '', cpf: employee.cpf || '', jobTitle: employee.jobTitle || '', workDays: employee.workDays || '', scheduleStart: employee.scheduleStart || '', scheduleEnd: employee.scheduleEnd || '' }); setTab('shifts'); };
  const resetForm = () => { setEditing(null); setForm(emptyForm); };
  const saveEmployee = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setMessage('');
    const response = await fetch('/api/admin/employees', { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editing ? { ...form, id: editing.id } : form) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) setMessage(data.error || 'Não foi possível salvar.');
    else { setMessage(editing ? 'Jornada atualizada.' : 'Colaborador cadastrado.'); resetForm(); await loadEmployees(); }
    setSaving(false);
  };
  const applySchedulePatterns = async () => { setScheduleApplying(true); setMessage(''); const response = await fetch('/api/admin/apply-schedule-patterns', { method: 'POST' }); const data = await response.json().catch(() => ({})); if (!response.ok) setMessage(data.error || 'Não foi possível aplicar os padrões.'); else { setMessage(`${data.updated || 0} jornadas atualizadas.`); await loadEmployees(); } setScheduleApplying(false); };
  const resolveIssue = async (id: string) => { const response = await fetch('/api/admin/inconsistencies', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status: 'RESOLVED' }) }); if (response.ok) { setMessage('Inconsistência resolvida.'); await loadIssues(); } };

  const statusLabel = (status: PresenceEmployee['status']) => {
    if (status === 'PRESENTE') return 'Presente';
    if (status === 'NAO_MARCOU') return 'Não marcou';
    if (status === 'PENDENTE') return 'Revisar';
    if (status === 'SAIU') return 'Saiu';
    return 'Folga';
  };

  return <>
    <nav className="admin-tabs" aria-label="Seções administrativas">{[['overview', 'Visão geral'], ['integrity', 'Central de Integridade'], ['employees', 'Colaboradores'], ['shifts', 'Turnos e jornada'], ['punches', 'Registros de ponto'], ['timesheet', 'Folha de ponto'], ['issues', 'Inconsistências'], ['requests', 'Solicitações'], ['notifications', 'Notificações'], ['certificates', 'Atestados'], ['settings', 'Dados e documentos'], ['security', 'Segurança e auditoria']].map(([key, label]) => <button key={key} type="button" className={tab === key ? 'active' : ''} aria-current={tab === key ? 'page' : undefined} onClick={() => setTab(key)}>{label}</button>)}</nav>
    {degraded ? <div className="status-msg admin-toast" role="status">Modo contingência: o banco está temporariamente indisponível.</div> : null}
    {message ? <div className="status-msg admin-toast">{message}</div> : null}

    {tab === 'overview' ? <section className="overview-layout">
      <div className="overview-top">
        <div className="card admin-hero overview-hero">
          <div><span className="eyebrow">OPERAÇÃO EM TEMPO REAL</span><h2>Operação de hoje</h2><p className="small-muted">Presença da equipe, pendências e atalhos.</p></div>
          <div className="row-actions overview-actions">
            <button className="primary-btn admin-action" onClick={() => setTab('punches')}>Ver marcações</button>
            <button className="ghost-btn admin-action" onClick={() => setTab('timesheet')}>Abrir folha</button>
            <button className="ghost-btn admin-action" onClick={() => setTab('employees')}>Equipe</button>
            <button className="ghost-btn admin-action" onClick={() => setTab('timesheet')}>Espelho mensal</button>
            <button className="ghost-btn admin-action" onClick={() => setTab('integrity')}>Central de Integridade</button>
          </div>
        </div>
        <div className="stat-grid admin-stat-grid overview-kpis">
          <div className="summary"><span className="small-muted">Colaboradores ativos</span><strong>{stats.employeeCount}</strong></div>
          <div className="summary summary-ok"><span className="small-muted">Presentes agora</span><strong>{presenceCounts.PRESENTE}</strong></div>
          <div className="summary summary-warn"><span className="small-muted">Não marcaram</span><strong>{presenceCounts.NAO_MARCOU}</strong></div>
          <div className="summary summary-alert"><span className="small-muted">Pendências abertas</span><strong>{stats.openInconsistencies}</strong></div>
        </div>
      </div>
      <div className="overview-main">
        <div className="card presence-card overview-presence">
          <div className="section-heading">
            <div><span className="eyebrow">ACOMPANHAMENTO DO DIA</span><h2>Quem está no trabalho agora</h2><p className="small-muted">{presenceUpdatedAt ? `Atualizado às ${presenceUpdatedAt.toLocaleTimeString('pt-BR')}` : 'Carregando...'}</p></div>
            <button type="button" className="ghost-btn" onClick={() => void loadPresence()}>Atualizar</button>
          </div>
          <div className="presence-summary">
            {(['TODOS', 'PRESENTE', 'NAO_MARCOU', 'PENDENTE', 'SAIU', 'FOLGA'] as const).map((key) => (
              <button key={key} type="button" className={presenceFilter === key ? 'presence-filter active' : 'presence-filter'} onClick={() => setPresenceFilter(key)}>
                <strong>{key === 'TODOS' ? presence.length : presenceCounts[key as PresenceEmployee['status']]}</strong>
                <span>{key === 'TODOS' ? 'Todos' : statusLabel(key as PresenceEmployee['status'])}</span>
              </button>
            ))}
          </div>
          <div className="presence-grid">
            {filteredPresence.map((employee) => (
              <div className={`presence-person presence-${employee.status.toLowerCase()}`} key={employee.id}>
                <div className="presence-avatar">{employee.latestPunch?.hasPhoto ? <img src={`/api/admin/punches/${employee.latestPunch.id}/photo`} alt={employee.name} /> : <span>{employee.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase()}</span>}<i aria-hidden="true" /></div>
                <strong title={employee.name}>{employee.name}</strong>
                <span>{employee.employeeNumber || 'Sem matrícula'}</span>
                <small>{statusLabel(employee.status)}</small>
              </div>
            ))}
          </div>
          {!filteredPresence.length ? <p className="small-muted presence-empty">Nenhum colaborador neste filtro.</p> : null}
        </div>
        <aside className="overview-side">
          <div className="card admin-guide overview-alerts">
            <span className="eyebrow">ATENÇÃO DO DIA</span><h3>O que priorizar</h3>
            <div className="overview-side-actions">
              <button type="button" className="ghost-btn" onClick={() => setTab('employees')}>Fichas cadastrais</button>
              <button type="button" className="ghost-btn" onClick={() => setTab('punches')}>Corrigir marcações</button>
              <button type="button" className="ghost-btn" onClick={() => setTab('issues')}>Conflitos atestado × ponto</button>
            </div>
          </div>
          <HealthCard />
        </aside>
      </div>
      <div className="overview-ops">
        <OverviewInbox onOpenRequests={() => setTab('requests')} onOpenIssues={() => setTab('issues')} />
        <OverviewExitWatch presence={presence} employees={employees} />
      </div>
      <AbsenceCalendarLive />
      <OverviewCalendar />
      <div className="overview-analytics"><AttendanceAnalytics employees={employees.filter((item) => item.active).map(({ id, name, employeeNumber }) => ({ id, name, employeeNumber }))} /></div>
    </section> : null}

    {tab === 'integrity' ? <IntegrityCenter /> : null}
    {tab === 'settings' ? <section className="admin-two-col"><CsvImporter /><PdfImporter /><SignatureSettings /></section> : null}
    {tab === 'employees' ? <EmployeesPanel employees={employees} onChanged={() => void loadEmployees()} /> : null}
    {tab === 'shifts' ? <section className="admin-two-col">
      <div className="card">
        <div className="section-heading"><div><h2>{editing ? 'Editar jornada' : 'Nova jornada / colaborador'}</h2><p className="small-muted">Matrícula e horários de expediente. Dados cadastrais ficam em Colaboradores.</p></div>{editing ? <button className="ghost-btn" onClick={resetForm}>Cancelar</button> : null}</div>
        <form onSubmit={saveEmployee} className="admin-form">
          {[['name', 'Nome completo'], ['employeeNumber', 'Matrícula'], ['cpf', 'CPF'], ['jobTitle', 'Cargo'], ['workDays', 'Dias trabalhados'], ['scheduleStart', 'Início da jornada'], ['scheduleEnd', 'Fim da jornada']].map(([key, label]) => (
            <label key={key} className="small-muted">{label}<input className="input" required={key === 'name' || key === 'employeeNumber'} value={form[key as keyof typeof form]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></label>
          ))}
          <button className="primary-btn" disabled={saving}>{saving ? 'Salvando...' : editing ? 'Salvar jornada' : 'Cadastrar'}</button>
        </form>
      </div>
      <div className="card">
        <div className="section-heading"><div><h2>Turnos e jornada</h2><p className="small-muted">Expediente em uso no ponto.</p></div>
          <div className="row-actions">
            <button className="ghost-btn" onClick={() => void applySchedulePatterns()} disabled={scheduleApplying}>{scheduleApplying ? 'Aplicando...' : 'Aplicar padrões de agosto'}</button>
            <button className="ghost-btn" onClick={() => setTab('employees')}>Ver fichas</button>
          </div>
        </div>
        <div className="shift-table">
          <div className="shift-header"><span>Colaborador</span><span>Dias</span><span>Jornada</span><span>Status</span><span>Ação</span></div>
          {employees.map((employee) => (
            <div className="shift-row" key={employee.id}>
              <span><b>{employee.name}</b><small>{employee.employeeNumber || '—'}</small></span>
              <span>{employee.workDays || 'Não definido'}</span>
              <span>{employee.scheduleStart || '—'} às {employee.scheduleEnd || '—'}</span>
              <span className={employee.active ? 'status-pill ok' : 'status-pill off'}>{employee.active ? 'Ativo' : 'Inativo'}</span>
              <button className="ghost-btn" onClick={() => startEdit(employee)}>Editar jornada</button>
            </div>
          ))}
        </div>
      </div>
    </section> : null}
    {tab === 'punches' ? <PunchesPanel employees={employees.filter((item) => item.active).map(({ id, name, employeeNumber }) => ({ id, name, employeeNumber }))} /> : null}
    {tab === 'timesheet' ? <FolhaPontoPanel employees={employees.filter((item) => item.active)} /> : null}
    {tab === 'security' ? <section className="card"><div className="section-heading"><div><span className="eyebrow">CONTROLES</span><h2>Segurança e auditoria</h2></div><button className="ghost-btn" onClick={() => void loadAudit()}>Atualizar</button></div>{audit ? <div className="employee-list">{audit.events.map((event) => <div className="employee-row" key={event.id}><div><strong>{event.action}</strong><div className="small-muted">{event.resource || '—'} · {new Date(event.createdAt).toLocaleString('pt-BR')}</div></div></div>)}</div> : <p className="small-muted">Carregando...</p>}</section> : null}
    {tab === 'requests' ? <RequestsPanel /> : null}
    {tab === 'notifications' ? <NotificationsPanel /> : null}
    {tab === 'certificates' ? <CertificatesPanel employees={employees.filter((item) => item.active).map(({ id, name, employeeNumber, cpf }) => ({ id, name, employeeNumber, cpf }))} /> : null}
    {tab === 'issues' ? <section>
      <section className="card">
        <div className="section-heading"><div><h2>Inconsistências</h2><p className="small-muted">Pendências do gestor.</p></div><button className="ghost-btn" onClick={() => void loadIssues()}>Atualizar</button></div>
        {!issues.length ? <p className="small-muted">Nenhuma inconsistência aberta.</p> : <div className="employee-list">{issues.map((issue) => <div className="employee-row" key={issue.id}><div><strong>{issue.user.name} · {issue.type}</strong><div className="small-muted">{issue.description || 'Sem descrição'} · {new Date(issue.detectedAt).toLocaleString('pt-BR')}</div></div><button className="primary-btn compact-btn" onClick={() => void resolveIssue(issue.id)}>Resolver</button></div>)}</div>}
      </section>
      <CertificateConflictsPanel />
    </section> : null}
  </>;
}
