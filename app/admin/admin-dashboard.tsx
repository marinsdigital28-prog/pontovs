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
import BackupPanel from './backup-panel';
import PeriodClosureCard from './period-closure-card';
import './overview-layout.css';
import OverviewInbox from './overview-inbox';
import OverviewExitWatch from './overview-exit-watch';
import ShiftsPanel from './shifts-panel';
import InconsistenciesPanel from './inconsistencies-panel';

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
type AuditEvent = { id: string; action: string; actorId?: string; resource?: string; createdAt: string; hash: string };
type PresenceEmployee = { id: string; name: string; employeeNumber: string | null; jobTitle: string | null; status: 'PRESENTE' | 'NAO_MARCOU' | 'PENDENTE' | 'SAIU' | 'FOLGA'; scheduled: boolean; latestPunch: { id: string; type: string; timestamp: string; status: string; hasPhoto: boolean } | null };

export default function AdminDashboard({ employees: initialEmployees, stats, degraded = false }: { employees: Employee[]; stats: { employeeCount: number; punchesToday: number; openInconsistencies: number }; degraded?: boolean }) {
  const [tab, setTab] = useState('hoje');
  const [employees, setEmployees] = useState<Employee[]>(initialEmployees);
  const [focusEmployee, setFocusEmployee] = useState<{ id: string; nonce: number } | null>(null);
  const [message, setMessage] = useState('');
  const [scheduleApplying, setScheduleApplying] = useState(false);
  const [audit, setAudit] = useState<{ chainValid: boolean; events: AuditEvent[]; mode: string } | null>(null);
  const [presence, setPresence] = useState<PresenceEmployee[]>([]);
  const [presenceFilter, setPresenceFilter] = useState<'TODOS' | PresenceEmployee['status']>('TODOS');
  const [presenceUpdatedAt, setPresenceUpdatedAt] = useState<Date | null>(null);

  const loadEmployees = useCallback(async () => { const response = await fetch('/api/admin/employees', { cache: 'no-store' }); if (response.ok) setEmployees((await response.json()).employees || []); }, []);
  const autoApplySchedulePatterns = useCallback(async () => { const response = await fetch('/api/admin/apply-schedule-patterns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'automatic' }) }); if (response.ok) { const data = await response.json().catch(() => ({})); if (data.updated) await loadEmployees(); } }, [loadEmployees]);
  const loadAudit = useCallback(async () => { const response = await fetch('/api/admin/audit', { cache: 'no-store' }); if (response.ok) setAudit(await response.json()); }, []);
  const loadPresence = useCallback(async () => { const response = await fetch('/api/admin/presence', { cache: 'no-store' }); if (response.ok) { const data = await response.json(); setPresence(Array.isArray(data.employees) ? data.employees : []); setPresenceUpdatedAt(new Date()); } }, []);
  useEffect(() => { void loadEmployees(); }, [loadEmployees]);
  useEffect(() => { void autoApplySchedulePatterns(); }, [autoApplySchedulePatterns]);
  useEffect(() => { if (tab === 'config') void loadAudit(); }, [tab, loadAudit]);
  useEffect(() => { if (tab !== 'hoje') return; void loadPresence(); const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void loadPresence(); }, 10000); return () => window.clearInterval(timer); }, [tab, loadPresence]);

  const filteredPresence = useMemo(() => presenceFilter === 'TODOS' ? presence : presence.filter((employee) => employee.status === presenceFilter), [presence, presenceFilter]);
  const presenceCounts = useMemo(() => presence.reduce((acc, employee) => { acc[employee.status] += 1; return acc; }, { PRESENTE: 0, NAO_MARCOU: 0, PENDENTE: 0, SAIU: 0, FOLGA: 0 } as Record<PresenceEmployee['status'], number>), [presence]);
  const startEdit = (employee: Employee) => { setFocusEmployee({ id: employee.id, nonce: Date.now() }); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const applySchedulePatterns = async () => { setScheduleApplying(true); setMessage(''); const response = await fetch('/api/admin/apply-schedule-patterns', { method: 'POST' }); const data = await response.json().catch(() => ({})); if (!response.ok) setMessage(data.error || 'Não foi possível aplicar os padrões.'); else { setMessage(`${data.updated || 0} jornadas atualizadas.`); await loadEmployees(); } setScheduleApplying(false); };

  const statusLabel = (status: PresenceEmployee['status']) => {
    if (status === 'PRESENTE') return 'Presente';
    if (status === 'NAO_MARCOU') return 'Não marcou';
    if (status === 'PENDENTE') return 'Revisar';
    if (status === 'SAIU') return 'Saiu';
    return 'Folga';
  };

  return <>
    <nav className="admin-tabs" aria-label="Seções administrativas">{[['hoje', 'Hoje'], ['pessoas', 'Pessoas'], ['ponto', 'Ponto'], ['ausencias', 'Ausências'], ['folha', 'Folha e relatórios'], ['config', 'Configurações']].map(([key, label]) => <button key={key} type="button" className={tab === key ? 'active' : ''} aria-current={tab === key ? 'page' : undefined} onClick={() => setTab(key)}>{label}</button>)}</nav>
    {degraded ? <div className="status-msg admin-toast" role="status">Modo contingência: o banco está temporariamente indisponível.</div> : null}
    {message ? <div className="status-msg admin-toast">{message}</div> : null}

    {tab === 'hoje' ? <section className="overview-layout">
      <div className="overview-top">
        <div className="card admin-hero overview-hero">
          <div><span className="eyebrow">OPERAÇÃO EM TEMPO REAL</span><h2>Operação de hoje</h2><p className="small-muted">Presença da equipe, pendências e atalhos.</p></div>
          <div className="row-actions overview-actions">
            <button className="primary-btn admin-action" onClick={() => setTab('ponto')}>Ver marcações</button>
            <button className="ghost-btn admin-action" onClick={() => setTab('folha')}>Abrir folha</button>
            <button className="ghost-btn admin-action" onClick={() => setTab('pessoas')}>Equipe</button>
            <a className="ghost-btn admin-action" href="/modulo-3">Módulo 3 · Beneficiários</a>
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
              <button type="button" className="ghost-btn" onClick={() => setTab('pessoas')}>Fichas cadastrais</button>
              <button type="button" className="ghost-btn" onClick={() => setTab('ponto')}>Corrigir marcações</button>
              <button type="button" className="ghost-btn" onClick={() => setTab('ausencias')}>Conflitos atestado × ponto</button>
            </div>
          </div>
        </aside>
      </div>
      <div className="overview-ops">
        <OverviewInbox onOpenRequests={() => setTab('ausencias')} onOpenIssues={() => setTab('ponto')} />
        <OverviewExitWatch presence={presence} employees={employees} />
      </div>
    </section> : null}

    {tab === 'pessoas' ? <section>
      <EmployeesPanel employees={employees} onChanged={() => void loadEmployees()} focusId={focusEmployee?.id} focusNonce={focusEmployee?.nonce} />
      <div className="admin-shifts-layout" style={{ marginTop: 20 }}>
        <ShiftsPanel
          employees={employees}
          scheduleApplying={scheduleApplying}
          onApplyPatterns={() => void applySchedulePatterns()}
          onEdit={(employee) => startEdit(employee)}
        />
      </div>
    </section> : null}
    {tab === 'ponto' ? <section>
      <PunchesPanel employees={employees.filter((item) => item.active).map(({ id, name, employeeNumber }) => ({ id, name, employeeNumber }))} />
      <div style={{ marginTop: 20 }}><InconsistenciesPanel employees={employees.filter((item) => item.active).map(({ id, name, employeeNumber }) => ({ id, name, employeeNumber }))} onOpenPunches={() => window.scrollTo({ top: 0, behavior: 'smooth' })} /></div>
    </section> : null}
    {tab === 'ausencias' ? <section>
      <RequestsPanel />
      <div style={{ marginTop: 20 }}><CertificatesPanel employees={employees.filter((item) => item.active).map(({ id, name, employeeNumber, cpf }) => ({ id, name, employeeNumber, cpf }))} /></div>
      <div style={{ marginTop: 20 }}><CertificateConflictsPanel /></div>
    </section> : null}
    {tab === 'folha' ? <section>
      <FolhaPontoPanel employees={employees.filter((item) => item.active)} />
      <PeriodClosureCard />
      <div style={{ marginTop: 20 }}><BackupPanel /></div>
      <div className="overview-analytics" style={{ marginTop: 20 }}><AttendanceAnalytics employees={employees.filter((item) => item.active).map(({ id, name, employeeNumber }) => ({ id, name, employeeNumber }))} /></div>
    </section> : null}
    {tab === 'config' ? <section>
      <section className="admin-two-col"><CsvImporter /><PdfImporter /><SignatureSettings /></section>
      <div style={{ marginTop: 20 }}><NotificationsPanel /></div>
      <div className="admin-two-col" style={{ marginTop: 20 }}>
        <HealthCard />
        <section className="card"><div className="section-heading"><div><span className="eyebrow">CONTROLES</span><h2>Segurança e auditoria</h2></div><button className="ghost-btn" onClick={() => void loadAudit()}>Atualizar</button></div>{audit ? <div className="employee-list">{audit.events.map((event) => <div className="employee-row" key={event.id}><div><strong>{event.action}</strong><div className="small-muted">{event.resource || '—'} · {new Date(event.createdAt).toLocaleString('pt-BR')}</div></div></div>)}</div> : <p className="small-muted">Carregando...</p>}</section>
      </div>
    </section> : null}
  </>;
}
