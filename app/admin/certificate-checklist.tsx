'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildChecklist, verificationState, canClose, fmtHours, STATUS_LABEL, type Occurrence, type ChecklistStatus, type ChecklistCertificate, type ChecklistRequest } from '@/lib/certificate-checklist';
import type { AdjustEmployee } from '@/lib/auto-adjust';
import { localDateKey, localMinutes } from '@/lib/attendance-analytics';
import { resolveDaySchedule } from '@/lib/day-schedule';
import './certificate-checklist.css';

type Rec = { id: string; type: string; timestamp: string; origin: string; user: { id: string } };
type Ev = { id: string; action: string; key?: string; note?: string; count?: number; actorName: string; createdAt: string };
const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const shift = (m: string, n: number) => { const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const ST_CLASS: Record<ChecklistStatus, string> = { COBERTO: 'ok', SEM_DOCUMENTO: 'bad', PARCIAL: 'warn', FORA_JORNADA: 'mut', AJUSTE_CONFLITA: 'pur', AJUSTE_OK: 'mut' };
const FILTERS: { k: 'ALL' | ChecklistStatus; t: string }[] = [{ k: 'ALL', t: 'Todos' }, { k: 'SEM_DOCUMENTO', t: 'Sem documento' }, { k: 'PARCIAL', t: 'Parcial' }, { k: 'AJUSTE_CONFLITA', t: 'Conflito *' }, { k: 'FORA_JORNADA', t: 'Fora da jornada' }, { k: 'AJUSTE_OK', t: 'Ajuste *' }, { k: 'COBERTO', t: 'Coberto' }];
const ACTION_PT: Record<string, string> = { CHECKLIST_VERIFIED: 'marcou como verificado', CHECKLIST_UNVERIFIED: 'desfez a verificação de', CHECKLIST_CHARGED: 'registrou cobrança de documento de', CHECKLIST_CLOSED: 'fechou a auditoria do mês', CHECKLIST_REOPENED: 'reabriu a auditoria do mês', CHECKLIST_CROSSED: 'cruzou as ocorrências' };
const initials = (n: string) => n.split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

export default function CertificateChecklist({ employees, onGo }: { employees: AdjustEmployee[]; onGo: (tab: string) => void }) {
  const today = localDateKey(new Date());
  const [month, setMonth] = useState(today.slice(0, 7));
  const [records, setRecords] = useState<Rec[]>([]);
  const [certs, setCerts] = useState<ChecklistCertificate[]>([]);
  const [reqs, setReqs] = useState<ChecklistRequest[]>([]);
  const [events, setEvents] = useState<Ev[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [filter, setFilter] = useState<'ALL' | ChecklistStatus>('ALL');
  const [who, setWho] = useState('');
  const [person, setPerson] = useState<string | null>(null);
  const [busy, setBusy] = useState('');

  const loadEvents = useCallback(async () => { const r = await fetch(`/api/admin/certificate-checklist?month=${month}`, { cache: 'no-store' }); const j = await r.json().catch(() => ({})); if (r.ok) setEvents(j.events || []); }, [month]);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    const last = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
    try {
      const [p, c, q] = await Promise.all([fetch(`/api/admin/punches?from=${month}-01&to=${month}-${last}&status=VALID`, { cache: 'no-store' }), fetch('/api/admin/certificates', { cache: 'no-store' }), fetch('/api/admin/requests', { cache: 'no-store' })]);
      const [pj, cj, qj] = await Promise.all([p.json().catch(() => ({})), c.json().catch(() => ({})), q.json().catch(() => ({}))]);
      if (!p.ok) throw new Error(pj.error || 'Não foi possível carregar as marcações.');
      setRecords(Array.isArray(pj.records) ? pj.records : []);
      setCerts((cj.certificates || []).map((x: any) => ({ ...x, startDate: String(x.startDate).slice(0, 10), endDate: String(x.endDate).slice(0, 10) })));
      setReqs((qj.requests || []).filter((x: any) => ['AUSENCIA', 'AVISO_ATRASO', 'ESQUECI_PONTO'].includes(x.type)).map((x: any) => ({ id: x.id, employeeId: x.employeeId, type: x.type, status: x.status, startDate: String(x.startDate).slice(0, 10), endDate: String(x.endDate).slice(0, 10), reason: x.reason })));
      await loadEvents();
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao carregar.'); }
    setLoading(false);
  }, [month, loadEvents]);
  useEffect(() => { void load(); }, [load]);

  const occ = useMemo<Occurrence[]>(() => buildChecklist({
    employees, month, untilDate: month < today.slice(0, 7) ? '9999-12-31' : today, certificates: certs, requests: reqs,
    punches: records.map((r) => { const t = new Date(r.timestamp); return { userId: r.user.id, date: localDateKey(t), type: r.type, minutes: localMinutes(t), manual: r.origin === 'ADJUSTED' }; }),
  }), [employees, month, today, certs, reqs, records]);
  const state = useMemo(() => verificationState(events), [events]);
  const closed = useMemo(() => { const c = events.filter((e) => e.action === 'CHECKLIST_CLOSED' || e.action === 'CHECKLIST_REOPENED').at(-1); return c?.action === 'CHECKLIST_CLOSED' ? c : null; }, [events]);
  const verified = occ.filter((o) => state[o.key]?.verified).length;
  const count = (s: ChecklistStatus) => occ.filter((o) => o.status === s).length;
  const list = occ.filter((o) => (filter === 'ALL' || o.status === filter) && (!who || o.employeeId === who) && (!person || o.employeeId === person));
  const ready = canClose(occ, state);

  const post = async (action: string, keys: string[] = [], extra: Record<string, unknown> = {}) => {
    setBusy(keys[0] || action); setMsg('');
    const r = await fetch('/api/admin/certificate-checklist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month, action, keys, ...extra }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) setMsg(j.error || 'Não foi possível registrar.'); else await loadEvents();
    setBusy('');
  };
  const charge = async (o: Occurrence) => {
    const text = `Olá, ${o.employeeName.split(' ')[0]}! No fechamento do ponto de ${MONTHS[Number(month.slice(5)) - 1].toLowerCase()} consta "${o.label.toLowerCase()}" em ${br(o.date)} (${o.window}). Se houver atestado ou declaração, por favor entregue a foto/documento ao RH até o fechamento. Obrigado!`;
    try { await navigator.clipboard.writeText(text); setMsg(`Mensagem de cobrança copiada para ${o.employeeName}. Nada foi enviado automaticamente.`); } catch { setMsg(text); }
    await post('CHECKLIST_CHARGED', [o.key], { note: 'Cobrança de documento (texto copiado, não enviado)' });
  };

  const actionBtn = (o: Occurrence) => {
    const st = state[o.key];
    if (st?.verified) return <button type="button" className="ck-done" title={`por ${st.by} em ${st.at ? new Date(st.at).toLocaleString('pt-BR') : ''}`} disabled={!!closed || busy === o.key} onClick={() => void post('CHECKLIST_UNVERIFIED', [o.key])}>✓ Verificado</button>;
    const verify = (main = false) => <button type="button" className={main ? 'ck-btn' : 'ck-btn ck-ic'} title="Marcar verificado" aria-label="Marcar verificado" disabled={!!closed || busy === o.key} onClick={() => void post('CHECKLIST_VERIFIED', [o.key])}>{main ? 'Marcar verificado' : '✓'}</button>;
    if (o.status === 'SEM_DOCUMENTO') return <div className="ck-acts">{st?.charged ? <button type="button" className="ck-btn" onClick={() => onGo('ausencias')}>Cobrado · lançar</button> : <button type="button" className="ck-btn pri" disabled={!!closed} onClick={() => void charge(o)}>Cobrar funcionário</button>}{verify()}</div>;
    if (o.status === 'PARCIAL') return <div className="ck-acts"><button type="button" className="ck-btn" onClick={() => onGo('ausencias')}>Anexar foto</button>{verify()}</div>;
    if (o.status === 'AJUSTE_CONFLITA') return <div className="ck-acts"><button type="button" className="ck-btn" onClick={() => onGo('ausencias')}>Lançar / recalcular</button>{verify()}</div>;
    if (o.status === 'FORA_JORNADA') return <div className="ck-acts"><button type="button" className="ck-btn" onClick={() => onGo('ausencias')}>Revisar abono</button>{verify()}</div>;
    return verify(true);
  };
  const doc = (o: Occurrence) => o.documentLabel ? <span className="ck-doc"><i className="th" />{o.documentLabel}</span> : <span className="ck-doc"><i className="th add">+</i>—</span>;
  const pill = (s: ChecklistStatus) => <span className={`ck-pill ${ST_CLASS[s]}`}>{STATUS_LABEL[s]}</span>;
  const monthLabel = `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
  const emp = person ? employees.find((e) => e.id === person) : null;
  const empOcc = person ? occ.filter((o) => o.employeeId === person) : [];
  const empSchedule = (() => { if (!emp) return ''; const s = resolveDaySchedule(emp.scheduleByDay, emp.workDays, emp.scheduleStart, emp.scheduleEnd, 3, emp.employeeNumber); return s ? `${s.start}–${s.end}` : 'sem jornada'; })();
  const conflicts = empOcc.filter((o) => o.status === 'AJUSTE_CONFLITA');
  const peopleWithOcc = [...new Map(occ.map((o) => [o.employeeId, o.employeeName])).entries()];

  return <div className="ck">
    <div className="ck-head">
      <div><span className="ck-eyebrow">{person && emp ? <><button type="button" className="linkish" onClick={() => setPerson(null)}>Checklist</button> › {emp.name} · {monthLabel}</> : 'Auditoria mensal · prova contra contestações'}</span></div>
      <span className="ck-sp" />
      <div className="ck-month"><button type="button" onClick={() => setMonth(shift(month, -1))}>◀ {MONTHS[Number(shift(month, -1).slice(5)) - 1]}</button><b>{monthLabel}</b><button type="button" disabled={month >= today.slice(0, 7)} onClick={() => setMonth(shift(month, 1))}>{MONTHS[Number(shift(month, 1).slice(5)) - 1]} ▶</button></div>
    </div>
    {error ? <div className="status-msg error">{error}</div> : null}
    {msg ? <div className="status-msg ck-msg">{msg}</div> : null}

    {!person ? <section className="card ck-sum">
      <div className="ck-sumtop">
        <div><span className="ck-eyebrow gold">Auditoria de {MONTHS[Number(month.slice(5)) - 1].toLowerCase()}</span><h2>{loading ? 'Cruzando ponto, atestados e solicitações…' : `${verified} de ${occ.length} ocorrências verificadas`}</h2></div>
        <span className="ck-sp" />
        <div className="ck-close">
          {closed ? <><span className="ck-pill ok">🔒 Auditoria fechada por {closed.actorName} · {new Date(closed.createdAt).toLocaleString('pt-BR')}</span><button type="button" className="ck-btn sm" onClick={() => { if (window.confirm('Reabrir a auditoria deste mês? Fica registrado na trilha.')) void post('CHECKLIST_REOPENED'); }}>Reabrir</button></>
            : <><button type="button" className="ck-btn pri lg" disabled={!ready || !!busy} onClick={() => { if (window.confirm(`Fechar a auditoria de ${monthLabel}? Fica registrado quem fechou e quando.`)) void post('CHECKLIST_CLOSED', [], { count: occ.length }); }}>🔒 Fechar auditoria</button><small>Libera quando {occ.length} de {occ.length} estiverem verificadas</small></>}
        </div>
      </div>
      <div className="ck-prog"><i style={{ width: `${occ.length ? (verified / occ.length) * 100 : 0}%` }} /></div>
      <div className="ck-kpis">
        {(['COBERTO', 'SEM_DOCUMENTO', 'PARCIAL', 'FORA_JORNADA', 'AJUSTE_CONFLITA'] as ChecklistStatus[]).map((s) => <button type="button" key={s} className={`ck-kpi ${ST_CLASS[s]}${filter === s ? ' on' : ''}`} onClick={() => setFilter(filter === s ? 'ALL' : s)}>{pill(s)}<strong>{count(s)}</strong></button>)}
      </div>
    </section> : null}

    {person && emp ? <section className="card ck-emp">
      <div className="ck-emptop"><span className="ck-av">{initials(emp.name)}</span><div><h2>{emp.name}</h2><small>Matrícula {emp.employeeNumber || '—'} · Jornada {empSchedule} · {empOcc.length} ocorrências no mês</small></div><span className="ck-sp" /><button type="button" className="ck-btn" onClick={() => onGo('folha')}>Abrir folha</button><button type="button" className="ck-btn pri" onClick={() => void (async () => { for (const o of empOcc.filter((x) => x.status === 'SEM_DOCUMENTO' && !state[x.key]?.charged)) await charge(o); })()}>Cobrar documentos ({empOcc.filter((x) => x.status === 'SEM_DOCUMENTO').length})</button></div>
      <div className="ck-kpis four">
        <div className="ck-kpi ok"><small>Coberto</small><strong>{empOcc.filter((o) => o.status === 'COBERTO').length} · {fmtHours(empOcc.filter((o) => o.status === 'COBERTO').reduce((a, o) => a + o.abonoMinutes, 0))} abonadas</strong></div>
        <div className="ck-kpi bad"><small>Sem documento</small><strong>{empOcc.filter((o) => o.status === 'SEM_DOCUMENTO').length} · {fmtHours(empOcc.filter((o) => o.status === 'SEM_DOCUMENTO').reduce((a, o) => a + o.gapMinutes, 0))} em aberto</strong></div>
        <div className="ck-kpi pur"><small>Conflito com ajuste *</small><strong>{conflicts.length}</strong></div>
        <div className="ck-kpi"><small>Solicitações no app</small><strong>{reqs.filter((r) => r.employeeId === emp.id && r.status === 'PENDENTE').length} pendentes</strong></div>
      </div>
    </section> : null}

    <section className="card ck-list">
      {!person ? <div className="ck-filters">
        {FILTERS.map((f) => <button type="button" key={f.k} className={filter === f.k ? 'on' : ''} onClick={() => setFilter(f.k)}>{f.t} ({f.k === 'ALL' ? occ.length : count(f.k)})</button>)}
        <span className="ck-sp" />
        <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Funcionário"><option value="">Funcionário: Todos</option>{peopleWithOcc.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
        <span className="ck-chip">Cruza: faltas · atrasos · saídas · ajustes * · app</span>
      </div> : <span className="ck-eyebrow gold">Linha do tempo</span>}
      <table className="ck-table">
        <thead><tr>{!person ? <th>Funcionário</th> : null}<th>Data</th><th>Ocorrência</th><th>Horário</th><th>Documento</th><th>Abono</th><th>Status</th><th>Ação</th></tr></thead>
        <tbody>{list.map((o) => <tr key={o.key} className={state[o.key]?.verified ? 'vf' : ''}>
          {!person ? <td data-l="Funcionário"><button type="button" className="ck-name" onClick={() => { setPerson(o.employeeId); window.scrollTo({ top: 0 }); }}>{o.employeeName}</button></td> : null}
          <td data-l="Data">{br(o.date)}</td>
          <td data-l="Ocorrência" title={o.detail}>{o.label}</td>
          <td data-l="Horário">{o.window}</td>
          <td data-l="Documento">{doc(o)}</td>
          <td data-l="Abono">{o.abonoMinutes ? fmtHours(o.abonoMinutes) : '—'}</td>
          <td data-l="Status">{pill(o.status)}</td>
          <td data-l="Ação">{actionBtn(o)}</td>
        </tr>)}</tbody>
      </table>
      {!loading && !list.length ? <p className="small-muted">Nenhuma ocorrência neste filtro.</p> : null}
    </section>

    {person ? conflicts.map((o) => <section key={o.key} className="card ck-conflict"><span className="ck-eyebrow">Conflito detectado · {br(o.date)}</span><p>{o.label} foi lançado como ajuste, mas há <b>{o.documentLabel}</b>. Sugestão: cancelar o ajuste * e abonar pelo atestado. A batida original não é alterada (Portaria 671).</p><div className="ck-acts"><button type="button" className="ck-btn pri" onClick={() => onGo('ponto')}>Aplicar sugestão no Ponto</button><button type="button" className="ck-btn" onClick={() => void post('CHECKLIST_VERIFIED', [o.key], { note: 'Manter ajuste' })}>Manter ajuste</button></div></section>) : null}

    {!person ? <section className="card ck-log"><span className="ck-eyebrow gold">Registro de auditoria</span>
      {events.length ? [...events].reverse().slice(0, 40).map((e) => <div key={e.id}><b>{e.actorName}</b> {ACTION_PT[e.action] || e.action}{e.key ? <> {occ.find((o) => o.key === e.key)?.employeeName || ''} {br(e.key.split('|')[1] || '')}</> : ''}{e.note ? ` — ${e.note}` : ''} · {new Date(e.createdAt).toLocaleString('pt-BR')}</div>) : <p className="small-muted">Nenhuma ação registrada neste mês ainda. Cada verificação, cobrança e fechamento fica registrado com autor, data e hash encadeado.</p>}
    </section> : null}
  </div>;
}
