'use client';

import { useState } from 'react';
import { COMPANIES, COMPANY_CODES, type CompanyFilter } from '@/lib/company';

type P = { id: string; name: string; employeeNumber: string | null; punches: number };
type Preview = { targets: P[]; withoutPunches: P[]; alreadyCovered: P[] };
const TYPES: Array<[string, string]> = [['PASSEIO', 'Passeio da escola'], ['EVENTO_EXTERNO', 'Evento externo'], ['AUSENCIA', 'Ausência']];

export default function AbsenceBatch() {
  const [company, setCompany] = useState<CompanyFilter>('ESPACO_EDUCACIONAL_PROGREDIR');
  const [date, setDate] = useState('');
  const [type, setType] = useState('PASSEIO');
  const [reason, setReason] = useState('');
  const [pv, setPv] = useState<Preview | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function loadPreview() {
    setBusy(true); setMsg(''); setPv(null);
    const r = await fetch(`/api/admin/absence-batch?company=${company}&date=${date}&type=${type}`, { cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) setMsg(j.error || 'Não foi possível montar a prévia.');
    else { setPv(j); setSel(new Set((j.targets || []).map((t: P) => t.id))); }
    setBusy(false);
  }
  async function confirm() {
    if (!pv || !sel.size) return;
    if (!window.confirm(`Lançar "${TYPES.find((t) => t[0] === type)?.[1]}" em ${date.split('-').reverse().join('/')} para ${sel.size} pessoa(s)? Fica aguardando aprovação.`)) return;
    setBusy(true);
    const r = await fetch('/api/admin/absence-batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company, date, type, reason: reason || undefined, employeeIds: [...sel] }) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? `${j.created} lançamento(s) criados, aguardando aprovação em Pendências. Nenhuma batida foi alterada.` : j.error || 'Falha ao lançar.');
    if (r.ok) setPv(null);
    setBusy(false);
  }
  const row = (p: P, check: boolean) => <li key={p.id} className="batch-row">
    {check ? <input type="checkbox" checked={sel.has(p.id)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(p.id); else n.delete(p.id); setSel(n); }} /> : <span className="batch-x">—</span>}
    <span>{p.name}</span><small className="small-muted">{p.employeeNumber || '—'} · {p.punches} marcação(ões)</small></li>;

  return <div className="card adm2-card batch-card">
    <div className="hd"><h2>Lançar em lote</h2><span className="note">Só entra quem é da empresa e tem marcação no dia</span></div>
    <div className="bd">
      <div className="form-two-col">
        <label className="small-muted">Empresa<select className="input" value={company} onChange={(e) => { setCompany(e.target.value as CompanyFilter); setPv(null); }}>
          <option value="ALL">Todas</option>{COMPANY_CODES.map((c) => <option key={c} value={c}>{COMPANIES[c].shortName}</option>)}</select></label>
        <label className="small-muted">Data<input className="input" type="date" value={date} onChange={(e) => { setDate(e.target.value); setPv(null); }} /></label>
      </div>
      <div className="form-two-col">
        <label className="small-muted">Tipo<select className="input" value={type} onChange={(e) => { setType(e.target.value); setPv(null); }}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className="small-muted">Motivo (opcional)<input className="input" value={reason} placeholder="Ex.: Passeio da escola" onChange={(e) => setReason(e.target.value)} /></label>
      </div>
      <button type="button" className="ghost-btn" disabled={!date || busy} onClick={() => void loadPreview()}>Ver prévia</button>
      {pv ? <div className="batch-preview">
        <h3>Vai lançar para {sel.size} de {pv.targets.length}</h3>
        <ul>{pv.targets.map((p) => row(p, true))}</ul>
        {pv.withoutPunches.length ? <><h4 className="small-muted">Fora do lote (sem marcação no dia): {pv.withoutPunches.length}</h4><ul>{pv.withoutPunches.map((p) => row(p, false))}</ul></> : null}
        {pv.alreadyCovered.length ? <><h4 className="small-muted">Já lançados: {pv.alreadyCovered.length}</h4><ul>{pv.alreadyCovered.map((p) => row(p, false))}</ul></> : null}
        <button type="button" className="primary-btn" disabled={!sel.size || busy} onClick={() => void confirm()}>Confirmar lançamento ({sel.size})</button>
      </div> : null}
      {msg ? <p className="status-msg">{msg}</p> : null}
    </div>
  </div>;
}
