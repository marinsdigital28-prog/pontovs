'use client';

import './emp-app.css';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { signIn, signOut, useSession } from 'next-auth/react';

type Punch = { id: string; type: string; timestamp: string; status: string };
type EmployeeData = {
  employee: { id: string; name: string; employeeNumber: string | null; jobTitle: string | null; scheduleStart: string | null; scheduleEnd: string | null; workDays: string | null };
  punches: Punch[];
  summary?: { workedMinutes?: number; plannedMinutes?: number; lateMinutes?: number };
};
type RequestItem = { id: string; type: string; status: string; startDate: string; endDate: string; reason: string; details?: string | null; createdAt: string };

const TYPE_LABEL: Record<string, string> = { ENTRADA: 'Entrada', INTERVALO: 'Intervalo', RETORNO: 'Retorno', SAIDA: 'Saída' };
const APP_TZ = 'America/Sao_Paulo';
const timeFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: APP_TZ, hour: '2-digit', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: APP_TZ, weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
const shortDate = new Intl.DateTimeFormat('pt-BR', { timeZone: APP_TZ, day: '2-digit', month: '2-digit', year: 'numeric' });

function padMat(v: string) { return v.replace(/\D/g, '').padStart(4, '0'); }
function minutesLabel(m?: number) {
  if (m == null || Number.isNaN(m)) return '--:--';
  const h = Math.floor(Math.abs(m) / 60);
  const min = Math.abs(m) % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

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

  const loadHistory = useCallback(async () => {
    const res = await fetch('/api/employee/history', { cache: 'no-store' });
    if (res.ok) { const json = await res.json(); setData({ employee: json.employee, punches: json.punches || [], summary: json.summary }); }
  }, []);

  const loadRequests = useCallback(async () => {
    const res = await fetch('/api/employee/requests', { cache: 'no-store' });
    if (res.ok) { const json = await res.json(); setRequests(json.requests || []); }
  }, []);

  useEffect(() => {
    if (sessionStatus !== 'authenticated') return;
    void loadHistory(); void loadRequests();
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') { void loadHistory(); void loadRequests(); } }, 15000);
    return () => window.clearInterval(t);
  }, [sessionStatus, loadHistory, loadRequests]);

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

  const punchesByDay = useMemo(() => {
    const map = new Map<string, Punch[]>();
    for (const p of data?.punches ?? []) {
      const key = shortDate.format(new Date(p.timestamp));
      map.set(key, [...(map.get(key) ?? []), p]);
    }
    return map;
  }, [data]);

  async function submitAbsence(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setLoading(true); setAbsenceMsg(''); setError('');
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
    const reason = String(form.get('reason') || '');
    const details = [startTime && endTime ? `Horário: ${startTime}–${endTime}` : null, String(form.get('note') || '') || null].filter(Boolean).join(' · ');
    const response = await fetch('/api/employee/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'AUSENCIA', startDate, endDate, reason, details: details || null,
        classification: isHours ? 'POR_HORAS' : 'POR_DIAS',
        documentName: documentFile?.name || null, documentMime: documentFile?.type || null, documentData,
      }),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) setError(json.error || 'Não foi possível enviar a solicitação.');
    else { setAbsenceMsg('Solicitação enviada. Aguarde a análise da administração.'); (e.target as HTMLFormElement).reset(); await loadRequests(); }
    setLoading(false);
  }

  if (sessionStatus !== 'authenticated') {
    return (
      <main className="emp-app emp-login">
        <div className="emp-login-card">
          <div className="emp-brand">
            <div className="emp-logo" aria-hidden />
            <h1>Ponto <span>Progredir</span></h1>
            <p>Consulte seus pontos e horários de trabalho</p>
          </div>
          <form onSubmit={login} className="emp-form">
            <label>
              Matrícula
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

  const emp = data?.employee;

  return (
    <main className="emp-app">
      <header className="emp-top">
        <div>
          <span className="emp-greet">{emp ? `Olá, ${emp.name.split(' ')[0]}` : 'Carregando…'}</span>
          <small>{dateFmt.format(new Date())}</small>
        </div>
        <button type="button" className="emp-icon-btn" aria-label="Notificações" onClick={() => setTab('absences')}>🔔</button>
      </header>

      <div className="emp-content">
        {tab === 'home' && (
          <section className="emp-section">
            <div className="emp-card">
              <span className="emp-label">Jornada prevista</span>
              <strong className="emp-big">{emp?.scheduleStart || '--:--'} às {emp?.scheduleEnd || '--:--'}</strong>
            </div>
            <div className="emp-card">
              <div className="emp-card-head">
                <h2>Marcações de hoje</h2>
                <button type="button" className="emp-link" onClick={() => void loadHistory()}>Atualizar</button>
              </div>
              {!todayPunches.length ? <p className="emp-muted">Nenhuma marcação registrada hoje ainda.</p> : (
                <ul className="emp-timeline">
                  {todayPunches.map((p) => (
                    <li key={p.id}>
                      <span className="emp-time">{timeFmt.format(new Date(p.timestamp))}</span>
                      <span>{TYPE_LABEL[p.type] || p.type}</span>
                      <span className="emp-pill ok">Registrado</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="emp-grid-2">
              <div className="emp-card compact"><span className="emp-label">Status</span><strong className="emp-status ok">● Em andamento</strong></div>
              <div className="emp-card compact"><span className="emp-label">Batidas hoje</span><strong className="emp-big">{todayPunches.length}</strong></div>
            </div>
          </section>
        )}

        {tab === 'journey' && (
          <section className="emp-section">
            <div className="emp-card">
              <span className="emp-label">Horário previsto</span>
              <strong className="emp-big">{emp?.scheduleStart || '--:--'}–{emp?.scheduleEnd || '--:--'}</strong>
              <p className="emp-muted">{emp?.workDays || 'Dias não informados'}</p>
            </div>
            <div className="emp-card">
              <h2>Batidas de hoje</h2>
              <ul className="emp-timeline">
                {todayPunches.map((p) => (
                  <li key={p.id}>
                    <span className="emp-time">{timeFmt.format(new Date(p.timestamp))}</span>
                    <span>{TYPE_LABEL[p.type] || p.type}</span>
                    <span className="emp-pill ok">Registrado</span>
                  </li>
                ))}
                {!todayPunches.length ? <li className="emp-muted">Sem registros hoje</li> : null}
              </ul>
            </div>
            <div className="emp-grid-2">
              <div className="emp-card compact"><span className="emp-label">Horas trabalhadas</span><strong className="emp-big">{minutesLabel(data?.summary?.workedMinutes)}</strong></div>
              <div className="emp-card compact"><span className="emp-label">Horas previstas</span><strong className="emp-big">{minutesLabel(data?.summary?.plannedMinutes)}</strong></div>
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
                <label>Data {absenceMode === 'DIAS' ? 'inicial' : ''}<input name="startDate" type="date" required /></label>
                {absenceMode === 'DIAS' ? (
                  <label>Data final<input name="endDate" type="date" required /></label>
                ) : (
                  <div className="emp-grid-2">
                    <label>Hora inicial<input name="startTime" type="time" required /></label>
                    <label>Hora final<input name="endTime" type="time" required /></label>
                  </div>
                )}
                <label>Motivo<input name="reason" required maxLength={200} placeholder="Ex.: Consulta médica" /></label>
                <label>Observação<textarea name="note" rows={2} maxLength={500} placeholder="Opcional" /></label>
                <label>Anexo (PDF, JPG ou PNG)<input name="document" type="file" accept=".pdf,image/jpeg,image/png" /></label>
                <button type="submit" className="emp-btn primary" disabled={loading}>{loading ? 'Enviando…' : 'Enviar solicitação'}</button>
                {absenceMsg ? <p className="emp-success">{absenceMsg}</p> : null}
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
              <div className="emp-avatar">{(emp?.name || '?').slice(0, 1)}</div>
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
