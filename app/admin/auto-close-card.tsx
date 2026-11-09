'use client';

import { useCallback, useEffect, useState } from 'react';

type Run = { id: string; date: string; phase: string; mode: string; createdAt: string; summary: { total: number; ok: number; skip: number; defer: number; auto: number; pendencias: number } | null; applied: number };
type Adj = { id: string; userId: string; date: string; type: string; time: string; status: string; reason: string; name: string; originals: { type: string; timestamp: string }[] };
type ReportRow = { employeeId: string; name: string; outcome: string; reason: string; punches: string; proposal: { type: string; time: string } | null; pendencia: { kind: string; title: string; suggestion: string | null } | null; checks: { label: string; ok: boolean }[] };
const LABEL: Record<string, string> = { ENTRADA: 'Entrada', INTERVALO: 'Ida almoço', RETORNO: 'Volta almoço', SAIDA: 'Saída' };
const hm = (v: string) => new Date(v).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
const todayKey = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const CHECKS = ['Fotos das 3 batidas', 'Tipo de cada batida (ex.: saída marcada como Intervalo)', 'Escala do dia', 'Sobreposição e duplicadas', 'Atestados e abonos', 'Pedidos do app não lançados', 'Almoço em horário redondo'];

export default function AutoCloseCard({ onAdjust }: { onAdjust: (userId: string, date: string) => void }) {
  const [date, setDate] = useState(todayKey());
  const [data, setData] = useState<{ mode: 'DRY_RUN' | 'REAL'; runs: Run[]; adjustments: Adj[] } | null>(null);
  const [sim, setSim] = useState<{ date: string; summary: any; report: ReportRow[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/auto-close?date=${date}`, { cache: 'no-store' });
    if (r.ok) setData(await r.json());
  }, [date]);
  useEffect(() => { void load(); }, [load]);

  async function post(body: any) {
    setBusy(true); setMsg('');
    const r = await fetch('/api/admin/auto-close', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg(d.error || 'Não foi possível.'); return null; }
    return d;
  }
  async function toggleMode() {
    if (!data) return;
    const next = data.mode === 'DRY_RUN' ? 'REAL' : 'DRY_RUN';
    if (!window.confirm(next === 'REAL' ? 'Ligar o ajuste de verdade? A partir de hoje às 17:20 o robô GRAVA a batida que falta (com *) quando tudo estiver conferido. Batidas originais nunca são alteradas e tudo pode ser desfeito.' : 'Voltar ao modo teste? O robô só vai sugerir, sem gravar nada.')) return;
    if (await post({ action: 'setMode', mode: next })) await load();
  }
  async function simulate() { const d = await post({ action: 'simulate', date }); if (d) setSim({ date, summary: d.summary, report: d.report }); }
  async function undo(a: Adj) {
    const reason = window.prompt(`Desfazer ${LABEL[a.type]} ${a.time}* de ${a.name}? A batida ajustada fica cancelada, com histórico. Motivo:`);
    if (!reason || reason.trim().length < 5) return;
    if (await post({ action: 'undo', adjustmentId: a.id, reason: reason.trim() })) { setMsg('Ajuste desfeito.'); await load(); }
  }

  const run = data?.runs.find((r) => r.date === date && r.phase !== 'MANHA') || null;
  const s = sim?.date === date ? sim.summary : run?.summary;
  const dd = `${date.slice(8, 10)}/${date.slice(5, 7)}`;
  return <div className="ar-card">
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <h2>🤖 Verificação automática · {date === todayKey() ? 'Hoje' : dd} 17:20</h2>
      {data ? <button type="button" className={`ar-mode ${data.mode === 'REAL' ? 'real' : 't'}`} style={{ border: 'none', cursor: 'pointer' }} onClick={() => void toggleMode()} title="Trocar modo">{data.mode === 'REAL' ? '● Ajustando de verdade' : '◐ Modo teste: só sugere, não grava'}</button> : null}
    </div>
    <div className="ar-sub">Roda todo dia às 17:20 (horário de Brasília) · quem sai depois das 17:20 é conferido às 08:00 do dia seguinte · nenhuma batida original é alterada (Portaria 671)</div>
    <div className="ar-acts" style={{ marginTop: 8 }}>
      <input type="date" value={date} onChange={(e) => { setDate(e.target.value); setSim(null); }} style={{ padding: 6, borderRadius: 8, border: '1px solid #cfdcd2' }} />
      <button type="button" className="ar-btn o s" disabled={busy} onClick={() => void simulate()}>{busy ? 'Conferindo…' : 'Simular este dia (não grava)'}</button>
    </div>
    {msg ? <div className="ar-w ar-red">{msg}</div> : null}
    {s ? <div className="ar-kpis">
      <div className="ar-k g"><b>{data?.mode === 'REAL' && !sim ? (run?.applied ?? 0) : s.auto}</b><span>{data?.mode === 'REAL' && !sim ? 'dias fechados automaticamente' : 'dias que o robô fecharia'}</span></div>
      <div className="ar-k y"><b>{s.pendencias}</b><span>pendências para você revisar</span></div>
      <div className="ar-k n"><b>{s.ok}</b><span>dias completos, nada a fazer</span></div>
    </div> : <div className="ar-w ar-amb">Ainda não rodou para {dd}. Use “Simular este dia” para ver o que o robô faria.</div>}
    {s?.defer ? <div className="ar-sub" style={{ marginTop: 6 }}>⏳ {s.defer} pessoa(s) com escala depois das 17:20: conferidas amanhã às 08:00.</div> : null}

    {data?.adjustments.length ? <>
      <h3>Ajustes automáticos feitos (com *)</h3>
      <table className="ar-table"><thead><tr><th>Colaborador</th><th>Batidas originais</th><th>Ajuste</th><th>Motivo</th><th /></tr></thead><tbody>
        {data.adjustments.map((a) => <tr key={a.id} style={a.status !== 'ACTIVE' ? { opacity: .5, textDecoration: 'line-through' } : undefined}>
          <td><b>{a.name.split(' ').slice(0, 2).join(' ')}</b></td><td>{a.originals.map((o) => hm(o.timestamp)).join(' · ')}</td>
          <td>{LABEL[a.type]} <span className="ar-star">{a.time}*</span></td><td>{a.reason}</td>
          <td>{a.status === 'ACTIVE' ? <button type="button" className="ar-btn r s" disabled={busy} onClick={() => void undo(a)}>↩ Desfazer</button> : 'desfeito'}</td>
        </tr>)}
      </tbody></table>
      <div className="ar-w ar-ok">✔ Desfazer cancela só o ajuste * e guarda o registro no histórico (motivo, autor, data)</div>
    </> : null}

    {sim?.date === date ? <>
      <h3>Simulação de {dd} · nada foi gravado</h3>
      <table className="ar-table"><thead><tr><th>Colaborador</th><th>Batidas</th><th>O robô faria</th></tr></thead><tbody>
        {sim.report.filter((r) => r.outcome !== 'OK').map((r) => <tr key={r.employeeId}>
          <td><b>{r.name.split(' ').slice(0, 2).join(' ')}</b></td><td>{r.punches}</td>
          <td>{r.outcome === 'AUTO' && r.proposal ? <>Lança {LABEL[r.proposal.type]} <span className="ar-star">{r.proposal.time}*</span></> : r.outcome === 'PENDENCIA' ? <>🔔 {r.pendencia?.title}{r.pendencia?.suggestion ? <div className="ar-sub">{r.pendencia.suggestion}</div> : null}</> : r.outcome === 'DEFER' ? '⏳ confere amanhã 08:00' : r.reason}
            {r.outcome !== 'SKIP' ? <div><button type="button" className="ar-btn o s" style={{ marginTop: 4 }} onClick={() => onAdjust(r.employeeId, date)}>✎ Abrir dia</button></div> : null}</td>
        </tr>)}
      </tbody></table>
    </> : null}
    <h3>O que o robô confere antes de ajustar</h3>
    <div className="ar-steps">{CHECKS.map((c) => <span key={c}>✔ {c}</span>)}</div>
  </div>;
}
