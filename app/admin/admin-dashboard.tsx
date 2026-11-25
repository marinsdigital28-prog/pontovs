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
import OverviewInbox from './overview-inbox';
import OverviewExitWatch from './overview-exit-watch';
import ShiftsPanel from './shifts-panel';
import InconsistenciesPanel from './inconsistencies-panel';
import EmployeeDayPanel from './employee-day-panel';
import AutoCloseCard from './auto-close-card';
import PendenciasInbox from './pendencias-inbox';
import AtestadoRapido from './atestado-rapido';
import HojeV2, { SuggestionsPanel, useHojeData, shortName } from './hoje-v2';
import './painel-v2.css';
import './auto-robo.css';

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

export default function AdminDashboard({ employees: initialEmployees, stats, degraded = false, managerName = '' }: { employees: Employee[]; stats: { employeeCount: number; punchesToday: number; openPendencias: number }; degraded?: boolean; managerName?: string }) {
  const [tab, setTab] = useState('hoje');
  const [employees, setEmployees] = useState<Employee[]>(initialEmployees);
  const [focusEmployee, setFocusEmployee] = useState<{ id: string; nonce: number } | null>(null);
  const [message, setMessage] = useState('');
  const [dayFocus, setDayFocus] = useState<{ userId: string; date: string; nonce: number } | null>(null);
  const [pendOpen, setPendOpen] = useState(false);
  const [pendCount, setPendCount] = useState(stats.openPendencias);
  const [pedidosCount, setPedidosCount] = useState(0);
  const [search, setSearch] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const hoje = useHojeData(!degraded);
  // Fonte única: o sino, o menu "Sugestões" e o card "Sugestões para revisar" usam a mesma contagem (Pendencia OPEN).
  useEffect(() => { if (hoje.data) { setPendCount(hoje.data.openCount); setPedidosCount(hoje.data.pedidosPendentes); } }, [hoje.data]);
  const openDay = useCallback((userId: string, date: string) => { setPendOpen(false); setTab('ponto'); setDayFocus({ userId, date, nonce: Date.now() }); window.scrollTo({ top: 0, behavior: 'smooth' }); }, []);
  const onPendCount = useCallback((n: number) => setPendCount(n), []);
  useEffect(() => {
    let alive = true;
    const tick = () => fetch('/api/admin/pendencias?status=OPEN', { cache: 'no-store' }).then((r) => r.ok ? r.json() : null).then((d) => { if (alive && d) setPendCount(d.openCount || 0); }).catch(() => undefined);
    void tick(); const t = window.setInterval(tick, 5 * 60_000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);
  const [scheduleApplying, setScheduleApplying] = useState(false);
  const [audit, setAudit] = useState<{ chainValid: boolean; events: AuditEvent[]; mode: string } | null>(null);
  const [presence, setPresence] = useState<PresenceEmployee[]>([]);

  const loadEmployees = useCallback(async () => { const response = await fetch('/api/admin/employees', { cache: 'no-store' }); if (response.ok) setEmployees((await response.json()).employees || []); }, []);
  const autoApplySchedulePatterns = useCallback(async () => { const response = await fetch('/api/admin/apply-schedule-patterns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'automatic' }) }); if (response.ok) { const data = await response.json().catch(() => ({})); if (data.updated) await loadEmployees(); } }, [loadEmployees]);
  const loadAudit = useCallback(async () => { const response = await fetch('/api/admin/audit', { cache: 'no-store' }); if (response.ok) setAudit(await response.json()); }, []);
  const loadPresence = useCallback(async () => { const response = await fetch('/api/admin/presence', { cache: 'no-store' }); if (response.ok) { const data = await response.json(); setPresence(Array.isArray(data.employees) ? data.employees : []); } }, []);
  useEffect(() => { void loadEmployees(); }, [loadEmployees]);
  useEffect(() => { void autoApplySchedulePatterns(); }, [autoApplySchedulePatterns]);
  useEffect(() => { if (tab === 'config') void loadAudit(); }, [tab, loadAudit]);
  useEffect(() => { if (tab !== 'ponto') return; void loadPresence(); const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void loadPresence(); }, 10000); return () => window.clearInterval(timer); }, [tab, loadPresence]);

  const startEdit = (employee: Employee) => { setFocusEmployee({ id: employee.id, nonce: Date.now() }); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const applySchedulePatterns = async () => { setScheduleApplying(true); setMessage(''); const response = await fetch('/api/admin/apply-schedule-patterns', { method: 'POST' }); const data = await response.json().catch(() => ({})); if (!response.ok) setMessage(data.error || 'Não foi possível aplicar os padrões.'); else { setMessage(`${data.updated || 0} jornadas atualizadas.`); await loadEmployees(); } setScheduleApplying(false); };


  const go = useCallback((key: string) => { setTab(key); setMoreOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }, []);
  const openPerson = useCallback((userId: string) => { setTab('ponto'); setDayFocus({ userId, date: hoje.data?.today || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }), nonce: Date.now() }); window.scrollTo({ top: 0, behavior: 'smooth' }); }, [hoje.data?.today]);
  const [atestadoFocus, setAtestadoFocus] = useState<{ userId: string; date: string; nonce: number } | null>(null);
  const [folhaFocus, setFolhaFocus] = useState<{ userId?: string; nonce: number } | null>(null);
  const openAtestado = useCallback((userId: string, date: string) => { setTab('atestado'); setAtestadoFocus({ userId, date, nonce: Date.now() }); window.scrollTo({ top: 0, behavior: 'smooth' }); }, []);
  const openFolha = useCallback((userId?: string) => { setTab('folha'); setFolhaFocus({ userId, nonce: Date.now() }); window.scrollTo({ top: 0, behavior: 'smooth' }); }, []);
  const searchHits = useMemo(() => { const q = search.trim().toLowerCase(); if (!q) return []; return employees.filter((e) => e.active && (e.name.toLowerCase().includes(q) || String(e.employeeNumber || '').includes(q))).slice(0, 8); }, [search, employees]);
  const pickEmployee = (employee: Employee) => { setSearch(''); setTab('pessoas'); startEdit(employee); };
  const nowLabel = `${new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long' }).replace('-feira', '')}, ${new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: 'numeric', month: 'long', year: 'numeric' })} · ${new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })} (Brasília)`;
  const competencia = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', month: 'long', year: 'numeric' }).replace(' de ', '/').replace(/^./, (c) => c.toUpperCase());
  const initialsOf = (name: string) => shortName(name).split(' ').map((p) => p[0]).join('').toUpperCase().slice(0, 2);
  const TITLES: Record<string, string> = { hoje: 'Hoje', sugestoes: 'Sugestões', pedidos: 'Pedidos', pessoas: 'Pessoas', ponto: 'Ponto', ausencias: 'Ausências', atestado: 'Lançar atestado', folha: 'Folha de ponto', config: 'Configurações' };
  const NAV: [string, string, string][] = [['rotina', 'hoje', '◎ Hoje'], ['rotina', 'sugestoes', '✦ Sugestões'], ['rotina', 'pedidos', '✉ Pedidos'], ['rotina', 'atestado', '🩺 Lançar atestado'], ['cad', 'pessoas', '👥 Pessoas'], ['cad', 'ponto', '🕘 Ponto'], ['cad', 'ausencias', '📅 Ausências'], ['cad', 'folha', '📄 Folha de ponto'], ['sis', 'config', '⚙ Configurações']];
  const badge = (key: string) => key === 'sugestoes' && pendCount ? <em>{pendCount}</em> : key === 'pedidos' && pedidosCount ? <em className="gold">{pedidosCount}</em> : null;
  const navBtn = ([, key, label]: [string, string, string]) => <button key={key} type="button" className={tab === key ? 'on' : ''} aria-current={tab === key ? 'page' : undefined} onClick={() => go(key)}>{label} {badge(key)}</button>;

  return <>
    <div className="pv2">
    <aside className="pv2-side">
      <div className="pv2-brand"><img src="/espaco-progredir-logo.jpeg" alt="" width={44} height={44} /><div><b>Ponto Progredir</b><small>Espaço Progredir · Gestão</small></div></div>
      <nav className="pv2-nav" aria-label="Seções administrativas">
        <h6>Rotina</h6>{NAV.filter((n) => n[0] === 'rotina').map(navBtn)}
        <h6>Cadastro e registros</h6>{NAV.filter((n) => n[0] === 'cad').map(navBtn)}
        <h6>Sistema</h6>{NAV.filter((n) => n[0] === 'sis').map(navBtn)}
        <a className="ext" href="/ponto">↗ Abrir ponto</a><a className="ext" href="/modulo-3">↗ Módulo 3 · Beneficiários</a>
      </nav>
      {managerName ? <div className="pv2-me"><span className="av">{initialsOf(managerName)}</span><div><b>{shortName(managerName)}</b><br /><small>Gestor</small></div></div> : null}
    </aside>
    <main className="pv2-main">
    <header className="pv2-top">
      <h1>{TITLES[tab]}</h1><span className="date">{nowLabel}</span><span className="sp" />
      <div className="pv2-search"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔍 Buscar pessoa ou matrícula…" aria-label="Buscar pessoa ou matrícula" onKeyDown={(e) => { if (e.key === 'Enter' && searchHits[0]) pickEmployee(searchHits[0]); }} />{searchHits.length ? <ul>{searchHits.map((e) => <li key={e.id}><button type="button" onClick={() => pickEmployee(e)}>{shortName(e.name)} <small style={{ color: 'var(--mut)' }}>{e.employeeNumber || ''}</small></button></li>)}</ul> : null}</div>
      <button type="button" className="pv2-pill comp" onClick={() => go('folha')} title="Abrir a folha deste mês">Folha de {competencia}</button>
      <button type="button" className="pv2-bell" aria-label={`Pendências do ponto: ${pendCount}`} title="Pendências do ponto (mesmo número do card Sugestões)" onClick={() => setPendOpen(true)}>🔔{pendCount ? <em>{pendCount}</em> : null}</button>
    </header>
    {pendOpen ? <><div className="ar-drawer-bg" onClick={() => setPendOpen(false)} /><div className="ar-drawer" role="dialog" aria-label="Pendências"><div style={{ textAlign: 'right' }}><button type="button" className="ar-btn o s" onClick={() => setPendOpen(false)}>✕ Fechar</button></div><PendenciasInbox onAdjust={openDay} onCount={onPendCount} /></div></> : null}
    {degraded ? <div className="status-msg admin-toast" role="status">Modo contingência: o banco está temporariamente indisponível.</div> : null}
    {message ? <div className="status-msg admin-toast">{message}</div> : null}

    {tab === 'hoje' ? <HojeV2 data={hoje.data} error={hoje.error} reload={() => void hoje.reload()} onAdjust={openDay} onOpenPerson={openPerson} go={go} onOpenAtestado={openAtestado} onOpenFolha={openFolha} /> : null}
    {tab === 'sugestoes' ? <section>
      <div className="pvh">{hoje.data ? <SuggestionsPanel data={hoje.data} onAdjust={openDay} onChanged={() => void hoje.reload()} /> : <div className="panel">{hoje.error || 'Carregando…'}</div>}</div>
      <div className="admin-two-col" style={{ alignItems: 'start' }}>
        <AutoCloseCard onAdjust={openDay} />
        <PendenciasInbox onAdjust={openDay} onCount={onPendCount} />
      </div>
    </section> : null}
    {tab === 'pedidos' ? <section>
      <div className="overview-ops" style={{ marginBottom: 20 }}><OverviewInbox onOpenRequests={() => go('ausencias')} onOpenIssues={() => go('ponto')} /></div>
      <RequestsPanel />
    </section> : null}
    {tab === 'atestado' ? <section><AtestadoRapido employees={employees.filter((item) => item.active)} initialEmployeeId={atestadoFocus?.userId} initialDate={atestadoFocus?.date} initialNonce={atestadoFocus?.nonce} /></section> : null}
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
      <div style={{ marginBottom: 20 }}><EmployeeDayPanel employees={employees.filter((item) => item.active).map(({ id, name, employeeNumber }) => ({ id, name, employeeNumber }))} focus={dayFocus} /></div>
      <PunchesPanel employees={employees.filter((item) => item.active).map(({ id, name, employeeNumber }) => ({ id, name, employeeNumber }))} />
      <div style={{ marginTop: 20 }}><InconsistenciesPanel employees={employees.filter((item) => item.active).map(({ id, name, employeeNumber }) => ({ id, name, employeeNumber }))} onOpenPunches={() => window.scrollTo({ top: 0, behavior: 'smooth' })} /></div>
      <div className="overview-ops" style={{ marginTop: 20 }}><OverviewExitWatch presence={presence} employees={employees} /></div>
    </section> : null}
    {tab === 'ausencias' ? <section>
      <div style={{ marginBottom: 20 }}><EmployeeDayPanel employees={employees.filter((item) => item.active).map(({ id, name, employeeNumber }) => ({ id, name, employeeNumber }))} focus={dayFocus} /></div>
      <RequestsPanel />
      <div style={{ marginTop: 20 }}><CertificatesPanel employees={employees.filter((item) => item.active).map(({ id, name, employeeNumber, cpf }) => ({ id, name, employeeNumber, cpf }))} /></div>
      <div style={{ marginTop: 20 }}><CertificateConflictsPanel /></div>
    </section> : null}
    {tab === 'folha' ? <section>
      <FolhaPontoPanel employees={employees.filter((item) => item.active)} initialEmployeeId={folhaFocus?.userId} initialNonce={folhaFocus?.nonce} />
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
    {/* Pontinho flutuante oculto: a arte aprovada não tem o mascote flutuante e o Pontinho está pausado (sem custo de IA). */}
    <footer className="admin-footer">Desenvolvido por Marins Digital</footer>
    </main>
    {moreOpen ? <div className="pv2-more" role="menu">{(['atestado', 'pedidos', 'ponto', 'folha', 'config'] as const).map((k) => <button key={k} type="button" className={tab === k ? 'on' : ''} onClick={() => go(k)}>{NAV.find((n) => n[1] === k)?.[2]} {badge(k)}</button>)}<a href="/ponto">↗ Abrir ponto</a><a href="/modulo-3">↗ Módulo 3 · Beneficiários</a></div> : null}
    <nav className="pv2-tabbar" aria-label="Navegação">
      <button type="button" className={tab === 'hoje' ? 'on' : ''} onClick={() => go('hoje')}><b>◎</b>Hoje</button>
      <button type="button" className={tab === 'sugestoes' ? 'on' : ''} onClick={() => go('sugestoes')}><b>✦</b>Sugestões{pendCount ? <em>{pendCount}</em> : null}</button>
      <button type="button" className={tab === 'pessoas' ? 'on' : ''} onClick={() => go('pessoas')}><b>👥</b>Pessoas</button>
      <button type="button" className={tab === 'ausencias' ? 'on' : ''} onClick={() => go('ausencias')}><b>📅</b>Ausências</button>
      <button type="button" className={['atestado', 'pedidos', 'ponto', 'folha', 'config'].includes(tab) || moreOpen ? 'on' : ''} onClick={() => setMoreOpen((v) => !v)}><b>☰</b>Mais</button>
    </nav>
    </div>
  </>;
}
