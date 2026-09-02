'use client';

import './emp-app.css';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { signIn, signOut, useSession } from 'next-auth/react';

type Punch = { id: string; type: string; timestamp: string; status: string; photoData?: string | null; hasPhoto?: boolean };
type EmployeeData = {
  employee: { id: string; name: string; employeeNumber: string | null; jobTitle: string | null; scheduleStart: string | null; scheduleEnd: string | null; workDays: string | null };
  punches: Punch[];
  summary?: { workedMinutes?: number; plannedMinutes?: number; lateMinutes?: number };
};
type RequestItem = { id: string; type: string; status: string; startDate: string; endDate: string; reason: string; details?: string | null; createdAt: string };

const TYPE_LABEL: Record<string, string> = { ENTRADA: 'Entrada', INTERVALO: 'Intervalo', RETORNO: 'Retorno', SAIDA: 'Saída' };

const ABSENCE_REASONS = [
  'Consulta médica',
  'Exame médico',
  'Atestado / problema de saúde',
  'Compromisso pessoal',
  'Problema familiar',
  'Passeio / evento externo',
  'Evento ou atividade externa',
  'Curso / treinamento',
  'Audiência / cartório / banco',
  'Imprevisto no trajeto / transporte',
  'Acompanhamento de familiar',
  'Outros',
] as const;

const COVERAGE_OPTIONS = [
  { value: 'PARCIAL_MANHA', label: 'Parcial — manhã' },
  { value: 'PARCIAL_TARDE', label: 'Parcial — tarde' },
  { value: 'DIA_INTEIRO', label: 'Dia inteiro' },
  { value: 'EMERGENCIA', label: 'Emergência (sem aviso prévio)' },
] as const;

const COVERAGE_LABEL: Record<string, string> = {
  PARCIAL_MANHA: 'Parcial manhã',
  PARCIAL_TARDE: 'Parcial tarde',
  DIA_INTEIRO: 'Dia inteiro',
  EMERGENCIA: 'Emergência',
};

const APP_TZ = 'America/Sao_Paulo';
const timeFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: APP_TZ, hour: '2-digit', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: APP_TZ, weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
const shortDate = new Intl.DateTimeFormat('pt-BR', { timeZone: APP_TZ, day: '2-digit', month: '2-digit', year: 'numeric' });

function padMat(v: string) { return v.replace(/\D/g, '').padStart(4, '0'); }

type Tab = 'home' | 'journey' | 'month' | 'absences' | 'profile';

export default function EmployeeAppPage() {
  const { status: sessionStatus } = useSession();
  const [tab, setTab] = useState<Tab>('home');
  const [matricula, setMatricula] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<EmployeeData | null>(null);
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [monthCursor, setMonthCursor] = useState(() => { const n = new Date(); return { year: n.getFullYear(), month: n.getMonth() }; });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [absenceMode, setAbsenceMode] = useState<'HORAS' | 'DIAS'>('HORAS');
  const [absenceMsg, setAbsenceMsg] = useState('');
  const [coverage, setCoverage] = useState<string>('DIA_INTEIRO');
  const [reasonChoice, setReasonChoice] = useState<string>(ABSENCE_REASONS[0]);
  const [whatsappText, setWhatsappText] = useState<string | null>(null);
  const [isStandalone, setIsStandalone] = useState<boolean | null>(null);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [toast, setToast] = useState<string | null>(null);
  const knownPunchIds = useRef<Set<string>>(new Set());
  const firstLoadDone = useRef(false);

  const loadHistory = useCallback(async () => {
    const res = await fetch('/api/employee/history', { cache: 'no-store' });
    if (!res.ok) return;
    const json = await res.json();
    const punches: Punch[] = json.punches || [];
    if (firstLoadDone.current) {
      const newOnes = punches.filter((p) => !knownPunchIds.current.has(p.id));
      if (newOnes.length) {
        const latest = newOnes[0];
        const label = TYPE_LABEL[latest.type] || latest.type;
        const when = timeFmt.format(new Date(latest.timestamp));
        const msg = `${label} registrada às ${when}`;
        setToast(msg);
        try { if (navigator.vibrate) navigator.vibrate([80, 40, 80]); } catch {}
        try {
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            new Notification('Ponto Progredir', { body: msg, icon: '/ponto-progredir-icon-circular.png', tag: `punch-${latest.id}` });
          }
        } catch {}
        window.setTimeout(() => setToast(null), 4500);
      }
    }
    knownPunchIds.current = new Set(punches.map((p) => p.id));
    firstLoadDone.current = true;
    setData({ employee: json.employee, punches, summary: json.summary });
  }, []);

  const loadRequests = useCallback(async () => {
    const res = await fetch('/api/employee/requests', { cache: 'no-store' });
    if (res.ok) { const json = await res.json(); setRequests(json.requests || []); }
  }, []);

  useEffect(() => {
    if (sessionStatus !== 'authenticated') return;
    void loadHistory(); void loadRequests();
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission();
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') { void loadHistory(); void loadRequests(); } }, 12000);
    return () => window.clearInterval(t);
  }, [sessionStatus, loadHistory, loadRequests]);

  useEffect(() => {
    const nativeShell = new URLSearchParams(window.location.search).get('native') === '1'
      || /PontoProgredirNative|Capacitor/i.test(window.navigator.userAgent)
      || Boolean((window as Window & { Capacitor?: unknown }).Capacitor);
    const standalone = nativeShell || window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true || document.referrer.includes('android-app://');
    setIsStandalone(standalone);
    const onBip = (e: Event) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener('beforeinstallprompt', onBip);
    const onInstalled = () => setIsStandalone(true);
    window.addEventListener('appinstalled', onInstalled);
    return () => { window.removeEventListener('beforeinstallprompt', onBip); window.removeEventListener('appinstalled', onInstalled); };
  }, []);

  async function handleInstall() {
    if (!installPrompt) return;
    installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice?.outcome === 'accepted') setIsStandalone(true);
    setInstallPrompt(null);
  }

  async function login(e: FormEvent) {
    e.preventDefault(); setLoading(true); setError('');
    const result = await signIn('credentials', { employeeNumber: padMat(matricula), redirect: false });
    if (result?.error) setError('Matrícula não encontrada ou inativa.');
    else { await loadHistory(); await loadRequests(); }
    setLoading(false);
  }

  const todayKey = useMemo(() => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: APP_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return `${v.year}-${v.month}-${v.day}`;
  }, []);

  const todayPunches = useMemo(() => {
    if (!data?.punches) return [];
    return data.punches.filter((p) => {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: APP_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(p.timestamp));
      const v = Object.fromEntries(parts.map((x) => [x.type, x.value]));
      return `${v.year}-${v.month}-${v.day}` === todayKey;
    }).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [data, todayKey]);

  const lastPhoto = useMemo(() => {
    const withPhoto = [...todayPunches].reverse().find((p) => p.photoData);
    return withPhoto?.photoData || null;
  }, [todayPunches]);

  const punchesByDay = useMemo(() => {
    const map = new Map<string, Punch[]>();
    for (const p of data?.punches ?? []) {
      const key = shortDate.format(new Date(p.timestamp));
      map.set(key, [...(map.get(key) ?? []), p]);
    }
    return map;
  }, [data]);

  async function submitAbsence(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setLoading(true); setAbsenceMsg(''); setError(''); setWhatsappText(null);
    const form = new FormData(e.currentTarget);
    const file = form.get('document');
    const documentFile = file instanceof File && file.size > 0 ? file : null;
    let documentData: string | null = null;
    if (documentFile) {
      documentData = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = reject;
        r.readAsDataURL(documentFile);
      });
    }
    const isHours = absenceMode === 'HORAS';
    const startDate = String(form.get('startDate') || '');
    const endDate = isHours ? startDate : String(form.get('endDate') || startDate);
    const startTime = isHours ? String(form.get('startTime') || '') : null;
    const endTime = isHours ? String(form.get('endTime') || '') : null;
    const returnTime = String(form.get('returnTime') || '') || null;
    const note = String(form.get('note') || '') || null;
    const today = todayKey;
    let finalCoverage = coverage;
    if (startDate === today && finalCoverage !== 'EMERGENCIA') {
      finalCoverage = 'EMERGENCIA';
    }
    const reason = reasonChoice === 'Outros' ? (String(form.get('reasonOther') || '').trim() || 'Outros') : reasonChoice;
    const detailsParts = [
      `Tipo: ${COVERAGE_LABEL[finalCoverage] || finalCoverage}`,
      startTime && endTime ? `Horário: ${startTime}–${endTime}` : null,
      returnTime ? `Previsão de volta: ${returnTime}` : null,
      note,
    ].filter(Boolean);
    const details = detailsParts.join(' · ');
    const response = await fetch('/api/employee/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'AUSENCIA',
        startDate,
        endDate,
        reason,
        details: details || null,
        classification: finalCoverage,
        returnExpected: Boolean(returnTime),
        documentName: documentFile?.name || null,
        documentMime: documentFile?.type || null,
        documentData,
      }),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) setError(json.error || 'Não foi possível enviar a solicitação.');
    else {
      const period = startDate === endDate
        ? shortDate.format(new Date(startDate + 'T12:00:00'))
        : `${shortDate.format(new Date(startDate + 'T12:00:00'))} até ${shortDate.format(new Date(endDate + 'T12:00:00'))}`;
      const timePart = startTime && endTime ? ` das ${startTime} às ${endTime}` : '';
      const returnPart = returnTime ? `\nPrevisão de volta: ${returnTime}` : '';
      const wa = `Olá! Comuniquei ausência pelo app Ponto Progredir.\n\nColaborador: ${data?.employee?.name || ''}\nMatrícula: ${data?.employee?.employeeNumber || ''}\nPeríodo: ${period}${timePart}\nTipo: ${COVERAGE_LABEL[finalCoverage] || finalCoverage}\nMotivo: ${reason}${returnPart}\n\nAguardando análise da administração.`;
      setWhatsappText(wa);
      setAbsenceMsg(finalCoverage === 'EMERGENCIA'
        ? 'Solicitação de emergência enviada. A administração já já pode ver no painel.'
        : 'Solicitação enviada. Aguarde a análise da administração.');
      (e.target as HTMLFormElement).reset();
      setReasonChoice(ABSENCE_REASONS[0]);
      setCoverage('DIA_INTEIRO');
      await loadRequests();
    }
    setLoading(false);
  }

  const brandLogo = (
    <div className="emp-logo-wrap" aria-hidden>
      <img src="/ponto-progredir-icon-circular.png" alt="" className="emp-logo-img" />
    </div>
  );

  if (sessionStatus !== 'authenticated') {
    return (
      <main className="emp-app emp-login">
        <div className="emp-login-card">
          <div className="emp-brand">
            {brandLogo}
            <h1>Ponto <span>Progredir</span></h1>
            <p>Consulte seus pontos e horários de trabalho</p>
          </div>
          <form onSubmit={login} className="emp-form">
            <label>Matrícula
              <input inputMode="numeric" maxLength={8} required value={matricula} onChange={(e) => setMatricula(e.target.value.replace(/\D/g, ''))} placeholder="Ex.: 1401" autoComplete="username" />
            </label>
            <button type="submit" className="emp-btn primary" disabled={loading || matricula.length < 3}>{loading ? 'Entrando…' : 'Entrar'}</button>
            {error ? <p className="emp-error" role="alert">{error}</p> : null}
          </form>
          <p className="emp-footer-note">Acesso exclusivo do colaborador · Espaço Progredir</p>
        </div>
      </main>
    );
  }

  if (isStandalone === null) {
    return (<main className="emp-app emp-login"><div className="emp-login-card"><p className="emp-muted" style={{ textAlign: 'center' }}>Verificando instalação…</p></div></main>);
  }

  if (!isStandalone) {
    return (
      <main className="emp-app emp-login">
        <div className="emp-login-card emp-install-card">
          <div className="emp-brand">{brandLogo}<h1>Instale o aplicativo</h1><p>Tenha o Ponto Progredir disponível na tela inicial do seu celular.</p></div>
          <button type="button" className="emp-btn primary" onClick={() => void handleInstall()}>Instalar aplicativo</button>
          {!installPrompt ? <p className="emp-muted emp-install-feedback">O navegador ainda não disponibilizou o botão nativo. Use o menu do navegador ou peça ajuda à ADM.</p> : null}
          <button type="button" className="emp-btn danger" onClick={() => void signOut({ callbackUrl: '/app' })}>Sair</button>
        </div>
      </main>
    );
  }

  const emp = data?.employee;

  return (
    <main className="emp-app">
      {toast ? <div className="emp-toast" role="status"><strong>Nova marcação</strong><span>{toast}</span></div> : null}

      <header className="emp-top">
        <div className="emp-top-left">
          <div className="emp-logo-wrap sm" aria-hidden><img src="/ponto-progredir-icon-circular.png" alt="" className="emp-logo-img" /></div>
          <div>
            <span className="emp-greet">{emp ? `Olá, ${emp.name.split(' ')[0]}` : 'Carregando…'}</span>
            <small>{dateFmt.format(new Date())}</small>
          </div>
        </div>
      </header>

      <div className="emp-content">
        {tab === 'home' && (
          <section className="emp-section">
            <div className="emp-card emp-hero">
              <span className="emp-label">Hoje</span>
              <strong className="emp-big">{emp?.scheduleStart || '--:--'} às {emp?.scheduleEnd || '--:--'}</strong>
              <p className="emp-muted">Jornada prevista · {emp?.workDays || 'dias não informados'}</p>
            </div>
            {lastPhoto ? (
              <div className="emp-card emp-photo-card">
                <span className="emp-label">Última foto registrada hoje</span>
                <img src={lastPhoto} alt="Foto da marcação" className="emp-punch-photo" />
              </div>
            ) : null}
            <div className="emp-card">
              <div className="emp-card-head">
                <h2>Marcações de hoje limpa</h2>
                <button type="button" className="emp-link" onClick={() => void loadHistory()}>Atualizar</button>
              </div>
              {!todayPunches.length ? <p className="emp-muted">Nenhuma marcação registrada hoje ainda.</p> : (
                <ul className="emp-timeline">
                  {todayPunches.map((p) => (
                    <li key={p.id} className="emp-timeline-row">
                      {p.photoData ? <img src={p.photoData} alt="" className="emp-thumb" /> : <span className="emp-thumb placeholder" />}
                      <span className="emp-time">{timeFmt.format(new Date(p.timestamp))}</span>
                      <span>{TYPE_LABEL[p.type] || p.type}</span>
                      <span className="emp-pill ok">OK</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {tab === 'journey' && (
          <section className="emp-section">
            <div className="emp-card">
              <span className="emp-label">Sua jornada cadastrada</span>
              <strong className="emp-big">{emp?.scheduleStart || '--:--'}–{emp?.scheduleEnd || '--:--'}</strong>
              <p className="emp-muted">{emp?.workDays || 'Dias não informados'}</p>
            </div>
            <div className="emp-grid-2">
              <div className="emp-card compact"><span className="emp-label">Batidas hoje</span><strong className="emp-big">{todayPunches.length}</strong></div>
              <div className="emp-card compact"><span className="emp-label">Status</span><strong className="emp-status ok">{todayPunches.length ? 'Em andamento' : 'Aguardando'}</strong></div>
            </div>
            <div className="emp-card">
              <h2>Resumo do dia</h2>
              <div className="emp-row"><span>Primeira marcação</span><strong>{todayPunches[0] ? timeFmt.format(new Date(todayPunches[0].timestamp)) : '—'}</strong></div>
              <div className="emp-row"><span>Última marcação</span><strong>{todayPunches.length ? timeFmt.format(new Date(todayPunches[todayPunches.length - 1].timestamp)) : '—'}</strong></div>
              <div className="emp-row"><span>Tipos registrados</span><strong>{todayPunches.length ? [...new Set(todayPunches.map((p) => TYPE_LABEL[p.type] || p.type))].join(', ') : '—'}</strong></div>
            </div>
          </section>
        )}

        {tab === 'month' && (
          <section className="emp-section">
            <div className="emp-card">
              <div className="emp-card-head">
                <button type="button" className="emp-link" onClick={() => setMonthCursor((c) => { const d = new Date(c.year, c.month - 1, 1); return { year: d.getFullYear(), month: d.getMonth() }; })}>‹</button>
                <strong>{new Date(monthCursor.year, monthCursor.month).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</strong>
                <button type="button" className="emp-link" onClick={() => setMonthCursor((c) => { const d = new Date(c.year, c.month + 1, 1); return { year: d.getFullYear(), month: d.getMonth() }; })}>›</button>
              </div>
              <div className="emp-cal-legend"><span><i className="dot green" /> Trabalhado</span><span><i className="dot gray" /> Sem registro</span></div>
              <div className="emp-cal-grid">
                {Array.from({ length: new Date(monthCursor.year, monthCursor.month + 1, 0).getDate() }, (_, i) => {
                  const day = i + 1;
                  const key = shortDate.format(new Date(monthCursor.year, monthCursor.month, day));
                  const has = punchesByDay.has(key);
                  return (
                    <button key={day} type="button" className={`emp-cal-day ${has ? 'has' : ''} ${selectedDay === key ? 'selected' : ''}`} onClick={() => setSelectedDay(key)}>
                      {day}{has ? <i className="dot green" /> : null}
                    </button>
                  );
                })}
              </div>
            </div>
            {selectedDay && (
              <div className="emp-card">
                <h2>{selectedDay}</h2>
                <ul className="emp-timeline">
                  {(punchesByDay.get(selectedDay) || []).map((p) => (
                    <li key={p.id}><span className="emp-time">{timeFmt.format(new Date(p.timestamp))}</span><span>{TYPE_LABEL[p.type] || p.type}</span></li>
                  ))}
                  {!(punchesByDay.get(selectedDay) || []).length ? <li className="emp-muted">Sem marcações neste dia</li> : null}
                </ul>
              </div>
            )}
          </section>
        )}

        {tab === 'absences' && (
          <section className="emp-section">
            <div className="emp-card">
              <h2>Nova ausência</h2>
              <div className="emp-segment">
                <button type="button" className={absenceMode === 'HORAS' ? 'active' : ''} onClick={() => setAbsenceMode('HORAS')}>Por horas</button>
                <button type="button" className={absenceMode === 'DIAS' ? 'active' : ''} onClick={() => setAbsenceMode('DIAS')}>Por dias</button>
              </div>
              <form onSubmit={submitAbsence} className="emp-form">
                <label>Tipo de ausência
                  <select value={coverage} onChange={(e) => setCoverage(e.target.value)} required>
                    {COVERAGE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </label>
                <p className="emp-muted">Se for hoje e não deu tempo de avisar, use <strong>Emergência</strong> (ou o sistema marca automaticamente).</p>
                <label>Data {absenceMode === 'DIAS' ? 'inicial' : ''}<input name="startDate" type="date" required /></label>
                {absenceMode === 'DIAS' ? (
                  <label>Data final<input name="endDate" type="date" required /></label>
                ) : (
                  <div className="emp-grid-2">
                    <label>Hora inicial<input name="startTime" type="time" /></label>
                    <label>Hora final<input name="endTime" type="time" /></label>
                  </div>
                )}
                <label>Motivo
                  <select value={reasonChoice} onChange={(e) => setReasonChoice(e.target.value)} required>
                    {ABSENCE_REASONS.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </label>
                {reasonChoice === 'Outros' ? (
                  <label>Descreva o motivo<input name="reasonOther" required maxLength={200} placeholder="Descreva o motivo" /></label>
                ) : null}
                <label>Previsão de volta (horário)<input name="returnTime" type="time" /></label>
                <label>Observação<textarea name="note" rows={2} maxLength={500} placeholder="Opcional — detalhes extras" /></label>
                <label>Anexo (PDF, JPG ou PNG)<input name="document" type="file" accept=".pdf,image/jpeg,image/png" /></label>
                <button type="submit" className="emp-btn primary" disabled={loading}>{loading ? 'Enviando…' : 'Enviar solicitação'}</button>
                {absenceMsg ? <p className="emp-success">{absenceMsg}</p> : null}
                {whatsappText ? (
                  <a className="emp-btn primary emp-wa-btn" href={`https://wa.me/?text=${encodeURIComponent(whatsappText)}`} target="_blank" rel="noreferrer">
                    Enviar confirmação no WhatsApp
                  </a>
                ) : null}
                {error ? <p className="emp-error">{error}</p> : null}
              </form>
            </div>
            <div className="emp-card">
              <h2>Minhas solicitações</h2>
              {!requests.length ? <p className="emp-muted">Nenhuma solicitação ainda.</p> : (
                <ul className="emp-req-list">
                  {requests.slice(0, 20).map((r) => (
                    <li key={r.id}>
                      <div>
                        <strong>{r.reason}</strong>
                        <small>{shortDate.format(new Date(r.startDate))}{r.endDate !== r.startDate ? ` → ${shortDate.format(new Date(r.endDate))}` : ''}{r.details ? ` · ${r.details}` : ''}</small>
                      </div>
                      <span className={`emp-pill ${r.status === 'APROVADO' ? 'ok' : r.status === 'REJEITADO' ? 'bad' : 'warn'}`}>{r.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {tab === 'profile' && (
          <section className="emp-section">
            <div className="emp-card profile">
              <div className="emp-logo-wrap" aria-hidden><img src="/ponto-progredir-icon-circular.png" alt="" className="emp-logo-img" /></div>
              <h2>{emp?.name}</h2>
              <p>Matrícula {emp?.employeeNumber}</p>
              <p>{emp?.jobTitle || 'Cargo não informado'}</p>
            </div>
            <div className="emp-card">
              <div className="emp-row"><span>Jornada</span><strong>{emp?.scheduleStart || '--:--'}–{emp?.scheduleEnd || '--:--'}</strong></div>
              <div className="emp-row"><span>Dias</span><strong>{emp?.workDays || '—'}</strong></div>
              <div className="emp-row"><span>Status</span><strong className="emp-status ok">Ativo</strong></div>
            </div>
            <button type="button" className="emp-btn danger" onClick={() => void signOut({ callbackUrl: '/app' })}>Sair</button>
          </section>
        )}
      </div>

      <nav className="emp-bottom-nav" aria-label="Menu principal">
        {([['home', 'Início', '🏠'], ['journey', 'Jornada', '⏱️'], ['month', 'Meu mês', '📅'], ['absences', 'Ausências', '📝'], ['profile', 'Perfil', '👤']] as const).map(([id, label, icon]) => (
          <button key={id} type="button" className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            <span aria-hidden>{icon}</span>{label}
          </button>
        ))}
      </nav>
    </main>
  );
}
