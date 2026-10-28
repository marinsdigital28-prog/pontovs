'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildSuggestions, type AdjustEmployee, type AdjustSuggestion } from '@/lib/auto-adjust';
import { localDateKey, localMinutes } from '@/lib/attendance-analytics';

type Rec = { id: string; type: string; timestamp: string; origin: string; user: { id: string } };
const TYPE_PT: Record<string, string> = { ENTRADA: 'Entrada', INTERVALO: 'Saída almoço', RETORNO: 'Retorno', SAIDA: 'Saída' };
const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const wd = (d: string) => ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][new Date(`${d}T12:00:00-03:00`).getUTCDay()];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function AutoAdjustReview({ employees }: { employees: AdjustEmployee[] }) {
  const today = localDateKey(new Date());
  const month = today.slice(0, 7);
  const [records, setRecords] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<Record<string, 'aprovado' | 'recusado' | 'confirmado'>>({});
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const storeKey = `ponto-ajustes-${month}`;

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const last = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
    try {
      const r = await fetch(`/api/admin/punches?from=${month}-01&to=${month}-${last}&status=VALID`, { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Não foi possível carregar as marcações do mês.');
      setRecords(Array.isArray(j.records) ? j.records : []);
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao carregar.'); }
    setLoading(false);
  }, [month]);
  useEffect(() => { void load(); try { setDone(JSON.parse(localStorage.getItem(storeKey) || '{}')); } catch { /* */ } }, [load, storeKey]);
  const mark = (k: string, v: 'aprovado' | 'recusado' | 'confirmado') => setDone((d) => { const n = { ...d, [k]: v }; try { localStorage.setItem(storeKey, JSON.stringify(n)); } catch { /* */ } return n; });

  const suggestions = useMemo(() => buildSuggestions(employees, records.map((r) => ({ userId: r.user?.id, date: localDateKey(new Date(r.timestamp)), type: r.type, minutes: localMinutes(new Date(r.timestamp)), manual: r.origin === 'ADJUSTED' })), { untilDate: today }), [employees, records, today]);
  const pending = suggestions.filter((s) => !done[s.key]);
  const fillsOf = (s: AdjustSuggestion, useLunch = false) => (useLunch ? s.lunchAlternative : s.fills).map((f) => ({ ...f, time: edits[s.key]?.[f.type] || f.time }));

  async function apply(s: AdjustSuggestion, useLunch = false) {
    const fills = fillsOf(s, useLunch);
    for (const f of fills) {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const r = await fetch('/api/admin/punches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: s.employee.id, type: f.type, date: s.date, time: f.time, reason: `Ajuste do fechamento aprovado pelo gestor: ${f.reason}` }) });
        if (r.status === 429) { await sleep(20000); continue; }
        if (!r.ok && r.status !== 409) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'Falha ao lançar inclusão.'); }
        break;
      }
    }
  }
  async function approve(s: AdjustSuggestion, useLunch = false) {
    setBusy(s.key); setMsg('');
    try { await apply(s, useLunch); mark(s.key, 'aprovado'); setMsg(`Inclusão lançada para ${s.employee.name} em ${br(s.date)} (marcada com *).`); await load(); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Falha.'); }
    setBusy(''); setEditing(null);
  }
  async function approveAll() {
    const list = pending.filter((s) => s.kind === 'COMPLETAR');
    if (!list.length || !window.confirm(`Lançar ${list.reduce((n, s) => n + s.fills.length, 0)} inclusões manuais (*) em ${list.length} dias? As marcações originais não são alteradas.`)) return;
    setBusy('all');
    let ok = 0;
    for (const s of list) { try { setMsg(`Lançando ${ok + 1} de ${list.length}…`); await apply(s); mark(s.key, 'aprovado'); ok += 1; } catch (e) { setMsg(e instanceof Error ? e.message : 'Falha.'); break; } }
    setMsg(`${ok} dias ajustados. Os "eventos externos" continuam aguardando sua confirmação.`);
    setBusy(''); await load();
  }

  return <div className="card adm2-card adm2-adjust">
    <div className="hd"><h2>Ajuste inteligente de marcações incompletas</h2><span className="note">{loading ? 'analisando…' : `${pending.length} sugestões para revisar`}</span><span className="adm2-sp" />
      <button type="button" className="ghost-btn" onClick={() => void load()} disabled={loading}>Reanalisar</button>
      <button type="button" className="primary-btn" disabled={!!busy || !pending.some((s) => s.kind === 'COMPLETAR')} onClick={() => void approveAll()}>Aprovar todas as completações</button></div>
    <div className="adm2-adjust-legend">Nada é aplicado sem sua aprovação. Cada aprovação cria uma <strong>nova marcação manual (*)</strong> — a marcação original nunca é alterada (Portaria 671).</div>
    {error ? <div className="status-msg">{error}</div> : null}
    {msg ? <div className="status-msg">{msg}</div> : null}
    <div className="adm2-table-wrap"><table className="adm2-table">
      <thead><tr><th>Pessoa</th><th>Dia</th><th>Marcações registradas</th><th>Sugestão</th><th>Horas</th><th /></tr></thead>
      <tbody>{pending.map((s) => <tr key={s.key} className={s.kind === 'EXTERNO_SEM_ALMOCO' ? 'ext' : ''}>
        <td><div className="person"><span className="av">{s.employee.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase()}</span><div><strong>{s.employee.name}</strong><small>Mat. {s.employee.employeeNumber || '—'} · escala {s.schedule}</small></div></div></td>
        <td className="num">{br(s.date)} <small>({wd(s.date)})</small></td>
        <td><div className="punch-line">{s.punches.map((p, i) => <span key={i} className="pp">{TYPE_PT[p.type] || p.type} <b>{p.time}{p.manual ? '*' : ''}</b></span>)}</div></td>
        <td>{s.kind === 'EXTERNO_SEM_ALMOCO'
          ? <><span className="tag info">Evento externo sem almoço?</span><small className="why">{s.note}</small></>
          : <div className="punch-line">{fillsOf(s).map((f) => <span key={f.type} className="pp new">+ {TYPE_PT[f.type]} {editing === s.key ? <input type="time" value={f.time} onChange={(e) => setEdits((x) => ({ ...x, [s.key]: { ...(x[s.key] || {}), [f.type]: e.target.value } }))} /> : <b>{f.time}*</b>}</span>)}<small className="why">{s.note}</small></div>}</td>
        <td className="num">{hm(s.workedMinutes)}</td>
        <td className="act">{s.kind === 'EXTERNO_SEM_ALMOCO'
          ? <div className="btns"><button type="button" className="primary-btn" disabled={!!busy} onClick={() => mark(s.key, 'confirmado')}>Confirmar {hm(s.workedMinutes)}</button>{s.lunchAlternative.length ? <button type="button" className="ghost-btn" disabled={!!busy} onClick={() => void approve(s, true)}>Lançar almoço {s.lunchAlternative.map((f) => f.time).join('–')}</button> : null}</div>
          : <div className="btns"><button type="button" className="primary-btn" disabled={!!busy} onClick={() => void approve(s)}>{busy === s.key ? 'Lançando…' : 'Aprovar'}</button><button type="button" className="ghost-btn" disabled={!!busy} onClick={() => setEditing(editing === s.key ? null : s.key)}>{editing === s.key ? 'Ok' : 'Editar'}</button><button type="button" className="ghost-btn" disabled={!!busy} onClick={() => mark(s.key, 'recusado')}>Recusar</button></div>}</td>
      </tr>)}</tbody>
    </table>{!loading && !pending.length ? <p className="small-muted adm2-empty">Nenhuma marcação incompleta para ajustar neste mês. 👍</p> : null}</div>
  </div>;
}
