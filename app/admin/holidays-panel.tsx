'use client';

import { useCallback, useEffect, useState } from 'react';

type H = { date: string; name: string; scope: string; scopeLabel: string; source: 'AUTO' | 'GESTOR'; active: boolean; movable?: boolean };
const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
function fmt(d: string) { const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y}`; }

/** Feriados automáticos (nacional, SP estado e capital) e feriados locais do gestor. */
export default function HolidaysPanel() {
  const [year, setYear] = useState(() => Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric' }).format(new Date())));
  const [list, setList] = useState<H[]>([]);
  const [autoFrom, setAutoFrom] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ date: '', name: '', reason: '' });
  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/holidays?year=${year}`, { cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setError(json.error || 'Não foi possível carregar.'); return; }
    setList(json.holidays || []); setAutoFrom(json.autoFrom || ''); setError('');
  }, [year]);
  useEffect(() => { void load(); }, [load]);

  async function act(action: 'ADD' | 'REMOVE' | 'DISABLE' | 'ENABLE', date: string, name?: string) {
    const reason = action === 'ADD' ? form.reason : window.prompt('Justificativa (vai para a auditoria):', action === 'DISABLE' ? 'Unidade trabalha normalmente neste dia' : action === 'ENABLE' ? 'Dia de folga concedido a todos' : 'Lançado por engano');
    if (!reason || reason.trim().length < 5) { setError('A justificativa precisa ter pelo menos 5 caracteres.'); return; }
    setBusy(true); setError(''); setMsg('');
    const res = await fetch('/api/admin/holidays', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, date, name, reason }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(json.error || 'Não foi possível salvar.'); return; }
    setMsg('Feriados atualizados. A folha já recalcula as horas.');
    if (action === 'ADD') setForm({ date: '', name: '', reason: '' });
    window.dispatchEvent(new Event('holidays-changed'));
    await load();
  }

  return (
    <div className="card hol">
      <div className="section-heading">
        <div>
          <span className="eyebrow">CALENDÁRIO</span>
          <h3>Feriados</h3>
          <p className="summary">Nacionais, estado de SP e cidade de São Paulo, já com os móveis (Páscoa). Em feriado, quem estava escalado recebe a jornada como trabalhada, e quem trabalhou ganha extra 100%. Automáticos valem a partir de {autoFrom ? fmt(autoFrom) : '—'}. Pontos facultativos só contam se você ativar.</p>
        </div>
        <div className="hol-year"><button type="button" className="ghost-btn" onClick={() => setYear(year - 1)}>‹</button><strong>{year}</strong><button type="button" className="ghost-btn" onClick={() => setYear(year + 1)}>›</button></div>
      </div>
      {error ? <p className="fq-msg bad">{error}</p> : null}
      {msg ? <p className="fq-msg ok">{msg}</p> : null}
      <ul className="hol-list">
        {list.map((h) => (
          <li key={h.date} className={h.active ? '' : 'off'}>
            <span className="hol-date">{fmt(h.date)} <small>{WD[new Date(`${h.date}T12:00:00Z`).getUTCDay()]}</small></span>
            <span className="hol-name">{h.name}{h.movable ? <small> · móvel</small> : null}</span>
            <span className={`status-pill ${h.active ? 'ok' : 'off'}`}>{h.active ? h.scopeLabel : `${h.scopeLabel} · não aplica`}</span>
            {h.source === 'GESTOR'
              ? <button type="button" className="ghost-btn" disabled={busy} onClick={() => void act('REMOVE', h.date)}>Remover</button>
              : <button type="button" className="ghost-btn" disabled={busy} onClick={() => void act(h.active ? 'DISABLE' : 'ENABLE', h.date)}>{h.active ? 'Desativar' : 'Ativar'}</button>}
          </li>
        ))}
      </ul>
      <form className="hol-add" onSubmit={(e) => { e.preventDefault(); void act('ADD', form.date, form.name); }}>
        <strong>Adicionar feriado local</strong>
        <label>Data<input className="input" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
        <label>Nome<input className="input" required minLength={3} maxLength={120} value={form.name} placeholder="ex.: Aniversário da cidade" onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label>Justificativa<input className="input" required minLength={5} maxLength={300} value={form.reason} placeholder="ex.: Decreto municipal nº ..." onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
        <button type="submit" className="primary-btn" disabled={busy}>Adicionar</button>
      </form>
    </div>
  );
}
