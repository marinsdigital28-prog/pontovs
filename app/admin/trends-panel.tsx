'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { overtimeCost } from '@/lib/trends';

type Row = { userId: string; name: string; employeeNumber: string | null; lateDays: number; lateMinutes: number; workedDays: number; incompleteDays: number; overtime50Minutes: number; overtime100Minutes: number; overtimeMinutes: number };
const STORAGE = 'ponto.trends.hourly';
function hm(min: number) { const s = min < 0 ? '-' : ''; const a = Math.abs(min); return `${s}${Math.floor(a / 60)}h${String(a % 60).padStart(2, '0')}`; }
function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()); }
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Relatório de tendências: ranking de atrasos, horas extras e custo estimado das extras no período. */
export default function TrendsPanel() {
  const [from, setFrom] = useState(`${today().slice(0, 7)}-01`);
  const [to, setTo] = useState(today());
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState<'atrasos' | 'extras'>('atrasos');
  const [hourly, setHourly] = useState<Record<string, number>>({ default: 0 });
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem(STORAGE) || 'null'); if (v && typeof v === 'object') setHourly({ default: 0, ...v }); } catch {} }, []);
  const saveHourly = (next: Record<string, number>) => { setHourly(next); try { localStorage.setItem(STORAGE, JSON.stringify(next)); } catch {} };

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const res = await fetch(`/api/admin/trends?from=${from}&to=${to}`, { cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) setError(json.error || 'Não foi possível carregar.'); else setRows(json.rows || []);
    setLoading(false);
  }, [from, to]);
  useEffect(() => { void load(); }, [load]);

  const rateOf = (id: string) => hourly[id] > 0 ? hourly[id] : hourly.default || 0;
  const ranked = useMemo(() => {
    const list = rows.map((r) => ({ ...r, cost: overtimeCost(r, rateOf(r.userId)) }));
    return view === 'atrasos'
      ? list.filter((r) => r.lateDays > 0).sort((a, b) => b.lateMinutes - a.lateMinutes || b.lateDays - a.lateDays)
      : list.filter((r) => r.overtimeMinutes > 0).sort((a, b) => b.overtimeMinutes - a.overtimeMinutes);
  }, [rows, view, hourly]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = ranked.reduce((a, r) => ({ late: a.late + r.lateMinutes, ot: a.ot + r.overtimeMinutes, cost: a.cost + r.cost }), { late: 0, ot: 0, cost: 0 });
  const max = Math.max(1, ...ranked.map((r) => (view === 'atrasos' ? r.lateMinutes : r.overtimeMinutes)));
  const setPreset = (p: 'mes' | 'anterior' | '30') => {
    const t = today();
    if (p === 'mes') { setFrom(`${t.slice(0, 7)}-01`); setTo(t); }
    else if (p === '30') { const d = new Date(`${t}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 29); setFrom(d.toISOString().slice(0, 10)); setTo(t); }
    else { const d = new Date(`${t.slice(0, 7)}-01T12:00:00Z`); d.setUTCDate(0); setTo(d.toISOString().slice(0, 10)); setFrom(`${d.toISOString().slice(0, 7)}-01`); }
  };

  return (
    <div className="card tr">
      <div className="section-heading">
        <div>
          <span className="eyebrow">RELATÓRIOS</span>
          <h3>Tendências: atrasos e horas extras</h3>
          <p className="summary">Ranking do período, com custo estimado das extras. Feriados e domingos contam como extra 100%.</p>
        </div>
      </div>
      <div className="tr-filters">
        <label>De <input className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>Até <input className="input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        <div className="tr-presets">
          <button type="button" className="ghost-btn" onClick={() => setPreset('mes')}>Este mês</button>
          <button type="button" className="ghost-btn" onClick={() => setPreset('anterior')}>Mês anterior</button>
          <button type="button" className="ghost-btn" onClick={() => setPreset('30')}>Últimos 30 dias</button>
        </div>
      </div>
      <div className="tr-rate">
        <label>Valor-hora padrão (R$)
          <input className="input" type="number" min={0} step="0.01" inputMode="decimal" value={hourly.default || ''} placeholder="ex.: 15,00" onChange={(e) => saveHourly({ ...hourly, default: Number(e.target.value) || 0 })} />
        </label>
        <p className="tr-note">⚠️ <b>Estimativa.</b> O sistema não tem salários cadastrados. O custo usa o valor-hora que você digitar aqui (dica: salário ÷ 220). Fica salvo só neste navegador e não vai para o banco. Fórmula: extra 50% × 1,5 + extra 100% × 2. Não inclui DSR nem encargos.</p>
      </div>
      <div className="tr-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={view === 'atrasos'} className={view === 'atrasos' ? 'primary-btn' : 'ghost-btn'} onClick={() => setView('atrasos')}>Ranking de atrasos</button>
        <button type="button" role="tab" aria-selected={view === 'extras'} className={view === 'extras' ? 'primary-btn' : 'ghost-btn'} onClick={() => setView('extras')}>Horas extras e custo</button>
      </div>
      <div className="tr-kpis">
        {view === 'atrasos' ? <div><span>Atraso total</span><strong>{hm(total.late)}</strong></div> : <>
          <div><span>Horas extras</span><strong>{hm(total.ot)}</strong></div>
          <div><span>Custo estimado</span><strong>{total.cost > 0 ? brl.format(total.cost) : '—'}</strong></div>
        </>}
        <div><span>Pessoas no ranking</span><strong>{ranked.length}</strong></div>
      </div>
      {error ? <p className="fq-msg bad">{error}</p> : null}
      {loading ? <div className="skeleton" style={{ height: 120 }} /> : !ranked.length ? <div className="empty-state">{view === 'atrasos' ? 'Nenhum atraso no período. 👏' : 'Nenhuma hora extra no período.'}</div> : (
        <div className="tr-table-wrap">
          <table className="report-table tr-table">
            <thead>
              {view === 'atrasos'
                ? <tr><th>#</th><th>Colaborador</th><th>Dias com atraso</th><th>Total</th><th>Média</th><th aria-hidden /></tr>
                : <tr><th>#</th><th>Colaborador</th><th>Extra 50%</th><th>Extra 100%</th><th>Total</th><th>Valor-hora</th><th>Custo estimado</th></tr>}
            </thead>
            <tbody>
              {ranked.map((r, i) => view === 'atrasos' ? (
                <tr key={r.userId}><td>{i + 1}</td><td>{r.name}<small> · {r.employeeNumber || '—'}</small></td><td>{r.lateDays}</td><td>{hm(r.lateMinutes)}</td><td>{Math.round(r.lateMinutes / r.lateDays)} min</td><td className="tr-bar-cell"><span className="tr-bar warn" style={{ width: `${(r.lateMinutes / max) * 100}%` }} /></td></tr>
              ) : (
                <tr key={r.userId}><td>{i + 1}</td><td>{r.name}<small> · {r.employeeNumber || '—'}</small></td><td>{hm(r.overtime50Minutes)}</td><td>{hm(r.overtime100Minutes)}</td><td><strong>{hm(r.overtimeMinutes)}</strong></td>
                  <td><input className="input tr-rate-input" type="number" min={0} step="0.01" aria-label={`Valor-hora de ${r.name}`} placeholder={hourly.default ? String(hourly.default) : 'padrão'} value={hourly[r.userId] || ''} onChange={(e) => saveHourly({ ...hourly, [r.userId]: Number(e.target.value) || 0 })} /></td>
                  <td>{r.cost > 0 ? brl.format(r.cost) : <span className="tr-muted">informe o valor-hora</span>}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="tr-note">Regras: atraso = entrada mais de 15 min depois do previsto. Extra = trabalho acima da jornada, contando só quando passa de 10 min no dia (CLT art. 58 §1º). Dias com marcação incompleta ficam de fora até serem corrigidos. Marcações canceladas não contam.</p>
    </div>
  );
}
