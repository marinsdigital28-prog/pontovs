'use client';

import { useCallback, useEffect, useState } from 'react';

type Row = { id: string; name: string; employeeNumber?: string | null; jobTitle?: string | null; status: string; schedule: string | null; firstIn: string | null; lateMinutes: number; lastPunch: { type: string; time: string } | null; breakSince: string | null; breakMinutes: number | null };
type Data = { date: string; now: string; holiday: { name: string } | null; rows: Row[]; counts: Record<string, number>; generatedAt: string };

const GROUPS: Array<{ key: string; label: string; cls: string; statuses: string[] }> = [
  { key: 'ausentes', label: 'Ausentes', cls: 'bad', statuses: ['AUSENTE'] },
  { key: 'atrasados', label: 'Atrasados', cls: 'warn', statuses: ['ATRASADO'] },
  { key: 'intervalo', label: 'Em intervalo', cls: 'info', statuses: ['INTERVALO'] },
  { key: 'chegaram', label: 'Trabalhando', cls: 'ok', statuses: ['TRABALHANDO'] },
  { key: 'aguardando', label: 'Ainda no horário', cls: 'muted', statuses: ['AGUARDANDO'] },
  { key: 'sairam', label: 'Já saíram', cls: 'muted', statuses: ['SAIU'] },
  { key: 'justificados', label: 'Justificados', cls: 'muted', statuses: ['JUSTIFICADO'] },
];
const REFRESH_MS = 30_000;
const TYPE: Record<string, string> = { ENTRADA: 'entrada', INTERVALO: 'saída p/ intervalo', RETORNO: 'retorno', SAIDA: 'saída' };

/** Painel "Hoje" do gestor: pensado para celular, atualiza sozinho a cada 30 s. */
export default function TodayLive() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<string>('');
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/today', { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error || 'Não foi possível carregar.'); return; }
      setError(''); setData(json);
    } catch { setError('Sem conexão. Tentando de novo…'); }
  }, []);
  useEffect(() => {
    void load();
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, REFRESH_MS);
    const onVis = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [load]);

  const rows = data?.rows || [];
  const countOf = (statuses: string[]) => rows.filter((r) => statuses.includes(r.status)).length;
  const visible = GROUPS.filter((g) => !filter || g.key === filter);
  const updated = data ? new Date(data.generatedAt).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';

  return (
    <div className="card tl" aria-live="polite">
      <div className="tl-head">
        <div>
          <span className="eyebrow">AO VIVO</span>
          <h3>Hoje na equipe</h3>
          <p className="tl-sub">{data ? `${data.date.split('-').reverse().join('/')} · atualizado às ${updated} · atualiza a cada 30 s` : 'Carregando…'}</p>
        </div>
        <button type="button" className="ghost-btn" onClick={() => void load()}>Atualizar</button>
      </div>
      {data?.holiday ? <p className="tl-holiday">Feriado hoje: {data.holiday.name}</p> : null}
      {error ? <p className="tl-error" role="alert">{error}</p> : null}
      <div className="tl-chips" role="tablist" aria-label="Filtrar">
        <button type="button" className={!filter ? 'active' : ''} onClick={() => setFilter('')}>Todos <b>{rows.filter((r) => r.status !== 'FOLGA').length}</b></button>
        {GROUPS.slice(0, 5).map((g) => <button key={g.key} type="button" className={`${filter === g.key ? 'active' : ''} tl-${g.cls}`} onClick={() => setFilter(filter === g.key ? '' : g.key)}>{g.label} <b>{countOf(g.statuses)}</b></button>)}
      </div>
      {!data && !error ? <div className="skeleton" style={{ height: 160 }} /> : null}
      {visible.map((g) => {
        const list = rows.filter((r) => g.statuses.includes(r.status));
        if (!list.length) return null;
        return (
          <section key={g.key} className="tl-group">
            <h4 className={`tl-${g.cls}`}>{g.label} · {list.length}</h4>
            <ul>
              {list.map((r) => (
                <li key={r.id} className={`tl-row tl-${g.cls}`}>
                  <div className="tl-who"><strong>{r.name}</strong><small>Mat. {r.employeeNumber || '—'}{r.schedule ? ` · ${r.schedule}` : ''}</small></div>
                  <div className="tl-what">
                    {r.status === 'AUSENTE' ? <span>sem entrada</span> : null}
                    {r.status === 'ATRASADO' ? <span>chegou {r.firstIn} (+{r.lateMinutes} min)</span> : null}
                    {r.status === 'INTERVALO' ? <span>desde {r.breakSince} · {r.breakMinutes} min</span> : null}
                    {['TRABALHANDO', 'SAIU'].includes(r.status) && r.lastPunch ? <span>{TYPE[r.lastPunch.type] || r.lastPunch.type} {r.lastPunch.time}</span> : null}
                    {r.status === 'AGUARDANDO' ? <span>entra às {r.schedule?.slice(0, 5)}</span> : null}
                    {r.status === 'JUSTIFICADO' ? <span>atestado/ausência</span> : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
