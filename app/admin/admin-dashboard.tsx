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
import './admin-redesign.css';
import './admin-v2.css';
import AutoAdjustReview from './auto-adjust-review';
import OverviewExitWatch from './overview-exit-watch';
import ShiftsPanel from './shifts-panel';
import InconsistenciesPanel from './inconsistencies-panel';
import CertificateChecklist from './certificate-checklist';

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

const ISSUE_LABEL: Record<string, string> = { ABSENCE: 'Falta sem justificativa', MISSING_PUNCHES: 'Batida faltando', DUPLICATE_PUNCHES: 'Batida duplicada', INVALID_SEQUENCE: 'Sequência inválida', LATE_ENTRY: 'Entrada atrasada', UNDERWORKED: 'Jornada abaixo do previsto' };
type PendingReq = { id: string; type: string; status: string; startDate: string; employee?: { name: string } | null };
type OpenIssue = { id: string; type: string; status: string; detectedAt: string; date?: string; user?: { name: string } };
const REQ_LABEL: Record<string, string> = { AUSENCIA: 'Ausência', ESQUECI_PONTO: 'Ajuste de ponto', AVISO_ATRASO: 'Aviso de atraso', TROCA_DIA: 'Troca de dia', LEMBRETE: 'Lembrete', COMPROVANTE: 'Comprovante', PASSEIO: 'Passeio / evento', EVENTO_EXTERNO: 'Evento externo' };
const requestLabel = (t: string) => REQ_LABEL[t] || 'Solicitação';
const issueLabel = (t: string) => ISSUE_LABEL[t] || t.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
const navIcons: Record<string, React.ReactNode> = {
  hoje: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  pessoas: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c.8-3.2 3-5 5.5-5s4.7 1.8 5.5 5" /><circle cx="17" cy="9" r="2.4" /><path d="M16 14.2c2.2.2 3.8 1.8 4.5 4.8" /></>,
  ponto: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  ausencias: <><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  folha: <><path d="M7 3.5h7l4.5 4.5v12.5H7z" /><path d="M14 3.5V8h4.5M9.5 13h6M9.5 16.5h6" /></>,
  pendencias: <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0" />,
  fechamento: <><rect x="4" y="4" width="16" height="16" rx="2.5" /><path d="M8.5 12.5l2.5 2.5 4.5-5" /></>,
  checklist: <><rect x="5" y="3.5" width="14" height="17" rx="2.5" /><path d="M9 3.5h6v3H9zM8.5 12l2 2 4-4M8.5 17h7" /></>,
  config: <><circle cx="12" cy="12" r="3" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" /></>,
};
const navHints: Record<string, string> = {
  hoje: 'Presença, pendências e alertas do dia',
  pessoas: 'Fichas cadastrais, jornadas e turnos',
  ponto: 'Marcações e inconsistências',
  ausencias: 'Solicitações, atestados e calendário',
  folha: 'Espelho mensal, fechamento, backup e análises',
  config: 'Importações, assinatura, notificações e auditoria',
};

export default function AdminDashboard({ employees: initialEmployees, stats, degraded = false, managerName = '' }: { employees: Employee[]; stats: { employeeCount: number; punchesToday: number; openInconsistencies: number }; degraded?: boolean; managerName?: string }) {
  const [tab, setTab] = useState('hoje');
  const [employees, setEmployees] = useState<Employee[]>(initialEmployees);
  const [focusEmployee, setFocusEmployee] = useState<{ id: string; nonce: number } | null>(null);
  const [message, setMessage] = useState('');
  const [scheduleApplying, setScheduleApplying] = useState(false);
  const [audit, setAudit] = useState<{ chainValid: boolean; events: AuditEvent[]; mode: string } | null>(null);
  const [presence, setPresence] = useState<PresenceEmployee[]>([]);
  const [presenceFilter, setPresenceFilter] = useState<'TODOS' | PresenceEmployee['status']>('TODOS');
  const [presenceUpdatedAt, setPresenceUpdatedAt] = useState<Date | null>(null);
  const [presencePage, setPresencePage] = useState(1);
  const [navOpen, setNavOpen] = useState(false);
  const [pendTab, setPendTab] = useState('inc');
  const [step, setStep] = useState(1);
  const [pendingRequests, setPendingRequests] = useState<PendingReq[]>([]);
  const [openIssues, setOpenIssues] = useState<OpenIssue[]>([]);
  const loadPending = useCallback(async () => {
    try {
      const [r, i] = await Promise.all([fetch('/api/admin/requests', { cache: 'no-store' }), fetch('/api/admin/inconsistencies', { cache: 'no-store' })]);
      const rj = await r.json().catch(() => ({})); const ij = await i.json().catch(() => ({}));
      setPendingRequests((Array.isArray(rj.requests) ? rj.requests : []).filter((x: PendingReq) => x.status === 'PENDENTE'));
      const list = Array.isArray(ij.inconsistencies) ? ij.inconsistencies : Array.isArray(ij.issues) ? ij.issues : [];
      setOpenIssues(list.filter((x: OpenIssue) => x.status !== 'RESOLVED'));
    } catch { /* mantém a contagem anterior */ }
  }, []);
  useEffect(() => { void loadPending(); }, [loadPending, tab]);

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

  const active = employees.filter((item) => item.active);
  const activeOpts = active.map(({ id, name, employeeNumber }) => ({ id, name, employeeNumber }));
  const initials = (name: string) => name.split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const monthName = new Date().toLocaleDateString('pt-BR', { month: 'long' });
  const monthCap = monthName.charAt(0).toUpperCase() + monthName.slice(1);
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const daysLeft = Math.max(0, Math.ceil((lastDay.getTime() - now.getTime()) / 86400000));
  const pendingTotal = pendingRequests.length + openIssues.length;
  const go = (key: string) => { setTab(key); setNavOpen(false); window.scrollTo({ top: 0 }); };
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(filteredPresence.length / pageSize));
  const pageRows = filteredPresence.slice((presencePage - 1) * pageSize, presencePage * pageSize);
  const ddmm = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  const titles: Record<string, string> = { hoje: 'Hoje', pendencias: 'Pendências', fechamento: 'Fechamento do mês', checklist: 'Checklist de atestados', pessoas: 'Pessoas', ponto: 'Ponto', ausencias: 'Ausências', folha: 'Folha de ponto', config: 'Configurações' };
  const subtitles: Record<string, string> = {
    hoje: new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }),
    pendencias: `${pendingTotal} itens · tudo que depende de você em um só lugar`,
    fechamento: `${monthCap}/${now.getFullYear()} · prazo ${ddmm(lastDay)}`,
    checklist: 'Auditoria mensal · prova contra contestações',
    pessoas: `${stats.employeeCount} ativas`,
    ponto: 'Marcações originais preservadas · inclusões marcadas com *',
    ausencias: 'Atestados, férias e calendário',
    folha: 'Uma pessoa por vez · A4 com assinatura digital',
    config: 'Importações, exportações, backup e auditoria',
  };
  const NavBtn = ({ k, label, badge, gold }: { k: string; label: string; badge?: React.ReactNode; gold?: boolean }) => (
    <button type="button" className={tab === k ? 'on' : ''} aria-current={tab === k ? 'page' : undefined} onClick={() => go(k)}>
      <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">{navIcons[k]}</svg><span>{label}</span>
      {badge ? <b className={gold ? 'nb gold' : 'nb'}>{badge}</b> : null}
    </button>
  );
  const steps = [
    { n: 1, t: 'Resolver inconsistências', d: `${openIssues.length} em aberto` },
    { n: 2, t: 'Atestados e ausências', d: `${pendingRequests.length} aguardando conferência` },
    { n: 3, t: 'Conferir folhas', d: `${active.length} folhas` },
    { n: 4, t: 'Fechar e gerar PDFs', d: 'assinatura digital A1' },
  ];
  const sit = (s: PresenceEmployee['status']) => ({ PRESENTE: ['Trabalhando', 'ok'], NAO_MARCOU: ['Sem registro', 'bad'], PENDENTE: ['Revisar', 'warn'], SAIU: ['Saiu', 'mut'], FOLGA: ['Folga', 'info'] } as Record<string, string[]>)[s];

  return <>
    <div className={`admin-shell adm2${navOpen ? ' nav-open' : ''}`}>
    <aside className="admin-sidebar">
      <div className="admin-brand">
        <img src="/ponto-progredir-icon-circular.png" alt="" width={40} height={40} />
        <div><strong>Ponto Progredir</strong><span>Espaço Progredir · Gestão</span></div>
      </div>
      <nav className="adm2-nav" aria-label="Seções administrativas">
        <div className="sec">Rotina</div>
        <NavBtn k="hoje" label="Hoje" />
        <NavBtn k="pendencias" label="Pendências" badge={pendingTotal || undefined} />
        <NavBtn k="fechamento" label="Fechamento do mês" badge={daysLeft <= 5 ? `${daysLeft} ${daysLeft === 1 ? 'dia' : 'dias'}` : undefined} gold />
        <NavBtn k="checklist" label="Checklist de atestados" />
        <div className="sec">Cadastro e registros</div>
        <NavBtn k="pessoas" label="Pessoas" />
        <NavBtn k="ponto" label="Ponto" />
        <NavBtn k="ausencias" label="Ausências" />
        <NavBtn k="folha" label="Folha de ponto" />
        <div className="sec">Sistema</div>
        <NavBtn k="config" label="Configurações" />
      </nav>
      <div className="admin-sidebar-footer">
        {managerName ? <div className="admin-user"><span className="admin-avatar">{initials(managerName)}</span><div><strong>{managerName}</strong><span>Gestor</span></div></div> : null}
        <a className="ghost-btn admin-open-ponto" href="/ponto">Abrir totem de ponto</a>
      </div>
    </aside>
    <div className="adm2-scrim" onClick={() => setNavOpen(false)} />
    <main className="admin-main">
    <header className="adm2-top">
      <button type="button" className="adm2-burger" aria-label="Abrir menu" onClick={() => setNavOpen(true)}><svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16" /></svg></button>
      <h1>{titles[tab]}</h1><span className="adm2-sub">{subtitles[tab]}</span>
      <span className="adm2-sp" />
      <button type="button" className="adm2-bell" aria-label="Pendências" onClick={() => go('pendencias')}><svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0" /></svg>{pendingTotal ? <i>{pendingTotal}</i> : null}</button>
    </header>
    <div className="adm2-content">
    {degraded ? <div className="status-msg admin-toast" role="status">Modo contingência: o banco está temporariamente indisponível.</div> : null}
    {message ? <div className="status-msg admin-toast">{message}</div> : null}

    {tab === 'hoje' ? <section className="adm2-hoje">
      <div className="adm2-kpis">
        <div className="kpi g"><span>Presentes agora</span><strong>{presenceCounts.PRESENTE} / {stats.employeeCount}</strong><small>{presenceCounts.SAIU} já saíram</small></div>
        <div className="kpi o"><span>Para revisar</span><strong>{presenceCounts.PENDENTE}</strong><small>marcações a conferir</small></div>
        <div className="kpi r"><span>Sem registro</span><strong>{presenceCounts.NAO_MARCOU}</strong><small>jornada já começou</small></div>
        <div className="kpi o"><span>Fechamento de {monthCap}</span><strong>{daysLeft === 0 ? 'hoje' : `em ${daysLeft} ${daysLeft === 1 ? 'dia' : 'dias'}`}</strong><small>{pendingTotal} pendências</small></div>
      </div>
      <div className="adm2-grid">
        <div className="card adm2-card">
          <div className="hd"><h2>Quem está trabalhando</h2><span className="note">{presenceUpdatedAt ? `atualizado às ${presenceUpdatedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'carregando…'}</span>
            <div className="chips">{(['TODOS', 'PRESENTE', 'NAO_MARCOU', 'PENDENTE', 'SAIU', 'FOLGA'] as const).map((key) => <button key={key} type="button" className={presenceFilter === key ? 'chip on' : 'chip'} onClick={() => { setPresenceFilter(key); setPresencePage(1); }}>{key === 'TODOS' ? 'Todos' : statusLabel(key)} <b>{key === 'TODOS' ? presence.length : presenceCounts[key]}</b></button>)}</div>
          </div>
          <div className="adm2-table-wrap"><table className="adm2-table">
            <thead><tr><th>Pessoa</th><th>Último registro</th><th>Situação</th><th /></tr></thead>
            <tbody>{pageRows.map((e) => { const [lbl, cls] = sit(e.status); return <tr key={e.id}>
              <td><div className="person">{e.latestPunch?.hasPhoto ? <img className="av" src={`/api/admin/punches/${e.latestPunch.id}/photo`} alt="" /> : <span className="av">{initials(e.name)}</span>}<div><strong>{e.name}</strong><small>Mat. {e.employeeNumber || '—'}{e.jobTitle ? ` · ${e.jobTitle}` : ''}</small></div></div></td>
              <td className="num">{e.latestPunch ? new Date(e.latestPunch.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
              <td><span className={`tag ${cls}`}>{lbl}</span></td>
              <td className="act"><button type="button" className="ghost-btn" onClick={() => go('ponto')}>Ver ponto</button></td>
            </tr>; })}</tbody>
          </table>{!pageRows.length ? <p className="small-muted adm2-empty">Nenhum colaborador neste filtro.</p> : null}</div>
          <div className="ft"><span className="note">Mostrando {pageRows.length} de {filteredPresence.length}</span><div className="pager">{Array.from({ length: pageCount }, (_, i) => <button key={i} type="button" className={presencePage === i + 1 ? 'on' : ''} onClick={() => setPresencePage(i + 1)}>{i + 1}</button>)}</div></div>
        </div>
        <div className="adm2-side">
          <div className="card adm2-card">
            <div className="hd"><h2>Precisa da sua atenção</h2><span className="adm2-sp" />{pendingTotal ? <span className="tag bad">{pendingTotal}</span> : null}</div>
            <ul className="adm2-att">
              {openIssues.slice(0, 4).map((i) => <li key={i.id}><span className="tag bad">{issueLabel(i.type)}</span><span>{i.user?.name} · {(i.date ? i.date.slice(8, 10) + '/' + i.date.slice(5, 7) : ddmm(new Date(i.detectedAt)))}</span></li>)}
              {pendingRequests.slice(0, 3).map((r) => <li key={r.id}><span className="tag warn">{requestLabel(r.type)}</span><span>{r.employee?.name || '—'} · {ddmm(new Date(r.startDate))}</span></li>)}
              {!pendingTotal ? <li className="note">Tudo em dia. Nenhuma pendência aberta.</li> : null}
            </ul>
            <div className="bd"><button type="button" className="primary-btn" onClick={() => go('pendencias')}>Abrir Pendências ({pendingTotal})</button></div>
          </div>
          <div className="card adm2-card">
            <div className="hd"><h2>Fechamento de {monthCap}</h2></div>
            <div className="bd"><div className="adm2-bars">{steps.map((s) => <i key={s.n} className={s.n <= step ? 'on' : ''} />)}</div>
              <p>Passo {step} de 4 — {steps[step - 1].t.toLowerCase()}. Prazo: <strong>{ddmm(lastDay)}</strong>.</p>
              <button type="button" className="gold-btn" onClick={() => go('fechamento')}>Continuar fechamento →</button></div>
          </div>
        </div>
      </div>
      <OverviewExitWatch presence={presence} employees={employees} />
    </section> : null}

    {tab === 'pendencias' ? <section className="adm2-stack">
      <div className="adm2-tabs">{[['inc', `Inconsistências do ponto (${openIssues.length})`], ['sol', `Solicitações e ajustes (${pendingRequests.length})`], ['ate', 'Atestado × ponto']].map(([k, l]) => <button key={k} type="button" className={pendTab === k ? 'on' : ''} onClick={() => setPendTab(k)}>{l}</button>)}</div>
      {pendTab === 'inc' ? <InconsistenciesPanel employees={activeOpts} onOpenPunches={() => go('ponto')} /> : null}
      {pendTab === 'sol' ? <RequestsPanel /> : null}
      {pendTab === 'ate' ? <CertificateConflictsPanel /> : null}
    </section> : null}

    {tab === 'fechamento' ? <section className="adm2-stack">
      <div className="card adm2-steps">
        <div className="row">{steps.map((s) => <button key={s.n} type="button" className={step === s.n ? 'on' : step > s.n ? 'done' : ''} onClick={() => setStep(s.n)}><span className="n">{step > s.n ? '✓' : s.n}</span><div><strong>{s.t}</strong><small>{s.d}</small></div></button>)}</div>
        <div className="prog"><i style={{ width: `${step * 25}%` }} /></div>
      </div>
      <div className="adm2-step-body">
        {step === 1 ? <><AutoAdjustReview employees={active} /><InconsistenciesPanel employees={activeOpts} onOpenPunches={() => go('ponto')} /></> : null}
        {step === 2 ? <><RequestsPanel /><CertificateConflictsPanel /></> : null}
        {step === 3 ? <FolhaPontoPanel employees={active} /> : null}
        {step === 4 ? <><PeriodClosureCard /><BackupPanel /><div className="adm2-hint card">Para gerar os PDFs assinados, use <strong>Gerar PDF assinado</strong> na folha de cada pessoa (passo 3).</div></> : null}
      </div>
      <div className="adm2-step-nav">
        <button type="button" className="ghost-btn" disabled={step === 1} onClick={() => setStep(step - 1)}>← Voltar</button>
        <span className="adm2-sp" />
        {step < 4 ? <button type="button" className="primary-btn" onClick={() => { setStep(step + 1); void loadPending(); window.scrollTo({ top: 0 }); }}>Próximo: {steps[step].t} →</button> : null}
      </div>
    </section> : null}

    {tab === 'checklist' ? <section className="adm2-stack">
      <CertificateChecklist employees={active} onGo={go} />
    </section> : null}

    {tab === 'pessoas' ? <section className="adm2-stack">
      <EmployeesPanel employees={employees} onChanged={() => void loadEmployees()} focusId={focusEmployee?.id} focusNonce={focusEmployee?.nonce} />
      <div className="admin-shifts-layout">
        <ShiftsPanel employees={employees} scheduleApplying={scheduleApplying} onApplyPatterns={() => void applySchedulePatterns()} onEdit={(employee) => startEdit(employee)} />
      </div>
    </section> : null}
    {tab === 'ponto' ? <section className="adm2-stack">
      <PunchesPanel employees={activeOpts} />
    </section> : null}
    {tab === 'ausencias' ? <section className="adm2-stack adm2-aus">
      <CertificatesPanel employees={active.map(({ id, name, employeeNumber, cpf }) => ({ id, name, employeeNumber, cpf }))} />
      <div className="adm2-hint card">Solicitações para aprovar e conflitos atestado × ponto agora ficam em <button type="button" className="linkish" onClick={() => go('pendencias')}>Pendências</button>.</div>
    </section> : null}
    {tab === 'folha' ? <section className="adm2-stack">
      <FolhaPontoPanel employees={active} />
    </section> : null}
    {tab === 'config' ? <section className="adm2-stack">
      <div className="admin-two-col"><BackupPanel /><SignatureSettings /></div>
      <div className="admin-two-col"><CsvImporter /><PdfImporter /></div>
      <div className="overview-analytics"><AttendanceAnalytics employees={activeOpts} /></div>
      <NotificationsPanel />
      <div className="admin-two-col">
        <HealthCard />
        <section className="card"><div className="section-heading"><div><span className="eyebrow">CONTROLES</span><h2>Segurança e auditoria</h2></div><button className="ghost-btn" onClick={() => void loadAudit()}>Atualizar</button></div>{audit ? <div className="employee-list adm2-audit">{audit.events.slice(0, 30).map((event) => <div className="employee-row" key={event.id}><div><strong>{event.action}</strong><div className="small-muted">{event.resource || '—'} · {new Date(event.createdAt).toLocaleString('pt-BR')}</div></div></div>)}</div> : <p className="small-muted">Carregando...</p>}</section>
      </div>
    </section> : null}
    </div>
    <footer className="admin-footer">Desenvolvido por Marins Digital</footer>
    </main>
    </div>
  </>;
}
