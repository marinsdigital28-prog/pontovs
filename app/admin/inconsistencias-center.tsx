'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import './inconsistencias.css';

type Fill = { type: string; time: string; reason: string };
type Day = { date: string; schedule: string; issues: Array<{ code: string; label: string }>; punches: Array<{ type: string; time: string; manual: boolean }>; fills: Fill[] };
type Emp = { id: string; name: string; employeeNumber: string | null; groups: Record<string, number>; days: Day[] };
type Data = { period: string; closed: boolean; lunchMinutes: number; employees: Emp[]; total: number; fillable: number };

const TYPE_SHORT: Record<string, string> = { ENTRADA: 'Ent', INTERVALO: 'Int', RETORNO: 'Ret', SAIDA: 'Saí' };
const LABEL: Record<string, string> = { SEM_MARCACAO: 'Sem marcação', ENTRADA_FALTANDO: 'Entrada faltando', SAIDA_FALTANDO: 'Saída faltando', SEM_INTERVALO: 'Sem almoço', INTERVALO_INCOMPLETO: 'Intervalo incompleto', INTERVALO_CURTO: 'Intervalo < mínimo', MARCACOES_IMPARES: 'Marcações ímpares', JORNADA_EXCEDIDA: 'Jornada > limite' };
const fmtDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const thisPeriod = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).slice(0, 7);
const k = (userId: string, date: string) => `${userId}|${date}`;

function PunchLine({ punches, fills }: { punches: Day['punches']; fills?: Fill[] }) {
  const all = [...punches.map((p) => ({ ...p, added: false })), ...(fills || []).map((f) => ({ type: f.type, time: f.time, manual: true, added: true }))].sort((a, b) => a.time.localeCompare(b.time));
  if (!all.length) return <span className="inc-muted">sem marcações</span>;
  return <span className="inc-punches">{all.map((p, i) => <span key={i} className={`inc-p ${p.added ? 'is-added' : ''}`} title={p.added ? 'Inclusão proposta (manual, marcada com * na folha)' : p.manual ? 'Inclusão manual (*)' : 'Marcação original'}>{TYPE_SHORT[p.type] || p.type} {p.time}{p.manual ? '*' : ''}</span>)}</span>;
}

export default function InconsistenciasCenter({ onCount }: { onCount?: (n: number) => void }) {
  const [period, setPeriod] = useState(thisPeriod());
  const [lunch, setLunch] = useState(60);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState('');
  const [closing, setClosing] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [applied, setApplied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const r = await fetch(`/api/admin/inconsistencias?period=${period}&lunch=${lunch}`, { cache: 'no-store' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) setError(d.error || 'Falha ao carregar.'); else { setData(d); if (period === thisPeriod()) onCount?.(d.total || 0); }
    setLoading(false);
  }, [period, lunch, onCount]);
  useEffect(() => { void load(); }, [load]);

  const fillDays = useMemo(() => (data?.employees || []).flatMap((e) => e.days.filter((d) => d.fills.length).map((d) => ({ e, d }))), [data]);
  const totalsByType = useMemo(() => { const t: Record<string, number> = {}; for (const e of data?.employees || []) for (const [c, n] of Object.entries(e.groups)) t[c] = (t[c] || 0) + n; return t; }, [data]);
  const shown = (data?.employees || []).filter((e) => !filter || e.groups[filter]);

  const startClosing = () => { setSel(new Set(fillDays.map(({ e, d }) => k(e.id, d.date)))); setClosing(true); setMsg(null); setApplied(false); };
  const toggle = (key: string) => setSel((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const toggleEmp = (e: Emp, on: boolean) => setSel((s) => { const n = new Set(s); for (const d of e.days) if (d.fills.length) on ? n.add(k(e.id, d.date)) : n.delete(k(e.id, d.date)); return n; });
  const selectedFills = fillDays.filter(({ e, d }) => sel.has(k(e.id, d.date))).reduce((a, { d }) => a + d.fills.length, 0);

  const apply = async () => {
    setBusy(true); setMsg(null);
    const items = fillDays.filter(({ e, d }) => sel.has(k(e.id, d.date))).map(({ e, d }) => ({ userId: e.id, date: d.date }));
    const r = await fetch('/api/admin/inconsistencias', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ period, reason, lunchMinutes: lunch, items }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg({ text: d.error || 'Falha ao aplicar.', error: true }); return; }
    setApplied(true); setMsg({ text: `${d.created} marcação(ões) incluída(s) em ${d.days} dia(s), todas com * e trilha de auditoria.` });
    await load();
  };
  const closePeriod = async () => {
    setBusy(true); setMsg(null);
    const r = await fetch('/api/admin/period-closure', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ period, action: 'CLOSE', reason }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg({ text: `${d.error || 'Não foi possível fechar.'}${Array.isArray(d.checks) ? ' ' + d.checks.filter((c: any) => !c.ok).map((c: any) => c.label).join(' · ') : ''}`, error: true }); return; }
    setMsg({ text: `Competência ${period} fechada.` }); setClosing(false); await load();
  };

  return (
    <div className="card inc-card" id="inconsistencias">
      <div className="inc-head">
        <div><span className="eyebrow">ALERTAS POR PROFISSIONAL</span><h2>Inconsistências</h2><p className="small-muted">Agrupadas por tipo, por competência. Nenhuma marcação original é alterada.</p></div>
        <div className="inc-controls">
          <label>Competência <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></label>
          <label>Almoço padrão <span className="inc-lunch"><input type="number" min={15} max={180} step={5} value={lunch} onChange={(e) => setLunch(Number(e.target.value) || 60)} /> min</span></label>
          <button type="button" className="primary-btn" disabled={!data || data.closed || loading} onClick={startClosing}>Fechar o ponto…</button>
        </div>
      </div>
      {data?.closed ? <div className="inc-banner is-locked">🔒 Competência {period} fechada/assinada — ajustes bloqueados. Reabra o fechamento para corrigir.</div> : null}
      {error ? <div className="inc-banner is-error">{error}</div> : null}
      {msg && !closing ? <div className={`inc-banner ${msg.error ? 'is-error' : 'is-ok'}`}>{msg.text}</div> : null}
      <div className="inc-chips">
        <button type="button" className={!filter ? 'active' : ''} onClick={() => setFilter('')}>Todos <b>{data?.total ?? '…'}</b></button>
        {Object.entries(totalsByType).map(([c, n]) => <button key={c} type="button" className={filter === c ? 'active' : ''} onClick={() => setFilter(c)}>{LABEL[c] || c} <b>{n}</b></button>)}
      </div>
      {loading && !data ? <p className="inc-muted">Carregando…</p> : null}
      {data && !data.employees.length ? <p className="inc-empty">✅ Nenhuma inconsistência nesta competência.</p> : null}
      <div className="inc-list">
        {shown.map((e) => {
          const count = Object.values(e.groups).reduce((a, b) => a + b, 0);
          const isOpen = open[e.id];
          return (
            <div key={e.id} className="inc-emp">
              <button type="button" className="inc-emp-head" aria-expanded={!!isOpen} onClick={() => setOpen((o) => ({ ...o, [e.id]: !o[e.id] }))}>
                <span className="inc-bell-dot" aria-hidden>{count}</span>
                <strong>{e.name}</strong><span className="inc-muted">{e.employeeNumber || ''}</span>
                <span className="inc-tags">{Object.entries(e.groups).map(([c, n]) => <span key={c} className={`inc-tag t-${c}`}>{LABEL[c] || c} · {n}</span>)}</span>
                <span className="inc-caret">{isOpen ? '▾' : '▸'}</span>
              </button>
              {isOpen ? <table className="inc-table"><thead><tr><th>Dia</th><th>Escala</th><th>Alertas</th><th>Marcações</th><th>Sugestão</th></tr></thead><tbody>
                {e.days.filter((d) => !filter || d.issues.some((i) => i.code === filter)).map((d) => <tr key={d.date}><td>{fmtDate(d.date)}</td><td>{d.schedule}</td><td>{d.issues.map((i) => <span key={i.code} className={`inc-tag t-${i.code}`}>{LABEL[i.code] || i.label}</span>)}</td><td><PunchLine punches={d.punches} /></td><td>{d.fills.length ? d.fills.map((f) => `${TYPE_SHORT[f.type]} ${f.time}*`).join(', ') : <span className="inc-muted">revisão manual</span>}</td></tr>)}
              </tbody></table> : null}
            </div>
          );
        })}
      </div>

      {closing && data ? (
        <div className="inc-modal-backdrop" role="presentation" onClick={() => !busy && setClosing(false)}>
          <div className="inc-modal" role="dialog" aria-modal="true" aria-labelledby="inc-close-title" onClick={(ev) => ev.stopPropagation()}>
            <h3 id="inc-close-title">Fechar o ponto — {period.slice(5)}/{period.slice(0, 4)}</h3>
            <p className="inc-muted">{data.total} inconsistência(s) em {data.employees.length} profissional(is). {fillDays.length} dia(s) podem ser ajustados automaticamente (inclusões marcadas com *; originais preservadas). Almoço: {lunch} min.</p>
            <div className="inc-preview">
              {data.employees.filter((e) => e.days.some((d) => d.fills.length)).map((e) => {
                const days = e.days.filter((d) => d.fills.length);
                const allOn = days.every((d) => sel.has(k(e.id, d.date)));
                return (
                  <div key={e.id} className="inc-pv-emp">
                    <label className="inc-pv-emp-head"><input type="checkbox" checked={allOn} onChange={(ev) => toggleEmp(e, ev.target.checked)} /> <strong>{e.name}</strong> <span className="inc-muted">{days.length} dia(s)</span></label>
                    <table className="inc-table"><thead><tr><th></th><th>Dia</th><th>Antes</th><th>Depois</th></tr></thead><tbody>
                      {days.map((d) => <tr key={d.date} className={sel.has(k(e.id, d.date)) ? '' : 'is-off'}><td><input type="checkbox" aria-label={`Incluir ${fmtDate(d.date)}`} checked={sel.has(k(e.id, d.date))} onChange={() => toggle(k(e.id, d.date))} /></td><td>{fmtDate(d.date)}<div className="inc-muted">{d.issues.map((i) => LABEL[i.code]).join(', ')}</div></td><td><PunchLine punches={d.punches} /></td><td><PunchLine punches={d.punches} fills={d.fills} /></td></tr>)}
                    </tbody></table>
                  </div>
                );
              })}
              {data.employees.some((e) => e.days.some((d) => !d.fills.length)) ? <p className="inc-muted">Dias sem sugestão segura (ex.: sem nenhuma marcação, ordem incoerente) continuam pendentes para revisão manual.</p> : null}
            </div>
            <label className="inc-reason">Justificativa (obrigatória, vai para a auditoria)<textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: Ajuste de fechamento — intervalos não registrados conforme escala" /></label>
            {msg ? <div className={`inc-banner ${msg.error ? 'is-error' : 'is-ok'}`}>{msg.text}</div> : null}
            <div className="inc-modal-actions">
              <button type="button" className="ghost-btn" disabled={busy} onClick={() => setClosing(false)}>Cancelar</button>
              <button type="button" className="ghost-btn" disabled={busy || reason.trim().length < 5} onClick={() => void closePeriod()}>{applied ? 'Fechar competência' : 'Fechar sem ajustar'}</button>
              <button type="button" className="primary-btn" disabled={busy || !selectedFills || reason.trim().length < 5} onClick={() => void apply()}>Aplicar {selectedFills} inclusão(ões)</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function InconsistenciasBell({ onOpen, onCount }: { onOpen: () => void; onCount?: (n: number) => void }) {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    const load = () => fetch(`/api/admin/inconsistencias?summary=1&period=${thisPeriod()}`, { cache: 'no-store' }).then((r) => r.ok ? r.json() : null).then((d) => { if (d) { setN(d.total); onCount?.(d.total); } }).catch(() => {});
    load(); const t = window.setInterval(() => { if (document.visibilityState === 'visible') load(); }, 60000);
    const onUpd = (e: Event) => setN((e as CustomEvent).detail);
    window.addEventListener('inconsistencias:count', onUpd);
    return () => { window.clearInterval(t); window.removeEventListener('inconsistencias:count', onUpd); };
  }, [onCount]);
  return <button type="button" className="inc-bell" onClick={onOpen} aria-label={`Inconsistências: ${n ?? 0} pendente(s)`} title="Inconsistências do mês"><svg viewBox="0 0 24 24" aria-hidden><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>{n ? <span className="inc-bell-badge">{n > 99 ? '99+' : n}</span> : null}</button>;
}
