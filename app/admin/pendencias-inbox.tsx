'use client';

import { useCallback, useEffect, useState } from 'react';

type Item = {
  id: string; userId: string; date: string; kind: string; status: string; title: string; detail: string; dryRun: boolean; resolution: string | null;
  suggestion: { kind: string; text: string } | null; employee: { name: string } | null;
  warning: { shownCount: number; firstShownAt: string | null; lastShownAt: string | null; ackAt: string | null } | null;
};
const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const fmtDay = (d: string) => `${WD[new Date(`${d}T12:00:00Z`).getUTCDay()]} ${d.slice(8, 10)}/${d.slice(5, 7)}`;
const dt = (v: string | null) => v ? new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
const CHIP: Record<string, [string, string]> = {
  AJUSTE_SUGERIDO: ['ajuste sugerido', 'y'], POUCAS_BATIDAS: ['batidas faltando', 'r'], SEM_BATIDAS: ['sem batida', 'r'], FORA_ESCALA: ['fora da escala', 'y'],
  TIPO_ERRADO: ['tipo estranho', 'r'], PEDIDO_NAO_LANCADO: ['pedido do app não lançado', 'y'], SEM_FOTO: ['sem foto', 'r'], CONFLITO: ['abono parcial', 'y'],
};

export default function PendenciasInbox({ onAdjust, onCount }: { onAdjust: (userId: string, date: string) => void; onCount?: (n: number) => void }) {
  const [status, setStatus] = useState<'OPEN' | 'RESOLVED' | 'IGNORED'>('OPEN');
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(0);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/pendencias?status=${status}`, { cache: 'no-store' });
    if (!r.ok) return;
    const d = await r.json();
    setItems(d.items || []); setOpen(d.openCount || 0); onCount?.(d.openCount || 0);
  }, [status, onCount]);
  useEffect(() => { void load(); }, [load]);

  async function act(item: Item, action: 'ACEITAR' | 'IGNORAR') {
    if (action === 'ACEITAR' && !window.confirm(`${item.employee?.name || ''} · ${fmtDay(item.date)}\n${item.suggestion?.text || ''}\n\nAplicar agora? Batidas originais não são alteradas; ajuste com * e histórico.`)) return;
    setBusy(item.id); setMsg('');
    const r = await fetch('/api/admin/pendencias', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id, action }) });
    const d = await r.json().catch(() => ({}));
    setBusy('');
    setMsg(r.ok ? (d.resolution || 'Feito.') : (d.error || 'Não foi possível.'));
    await load();
  }

  const canAccept = (i: Item) => i.status === 'OPEN' && i.suggestion && i.suggestion.kind !== 'TEXT';
  return <div className="ar-card">
    <h2>🔔 Pendências do ponto (verificação 17:20) {open ? <span className="ar-chip r">{open} abertas</span> : null}</h2>
    <div className="ar-sub">O robô não ajustou porque ficou com dúvida (ou está em modo teste). Você decide em 1 clique.</div>
    <div className="ar-tabs">{([['OPEN', `Abertas (${open})`], ['RESOLVED', 'Resolvidas'], ['IGNORED', 'Ignoradas']] as const).map(([k, l]) => <button key={k} type="button" className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{l}</button>)}</div>
    {msg ? <div className="ar-w ar-ok">{msg}</div> : null}
    {!items.length ? <div className="ar-sub" style={{ padding: 8 }}>Nada por aqui. 🎉</div> : null}
    {items.map((i) => <div key={i.id} className="ar-pend">
      <div className="h"><b>{i.employee?.name?.split(' ').slice(0, 2).join(' ') || '—'} · {fmtDay(i.date)}</b><span className={`ar-chip ${CHIP[i.kind]?.[1] || 'y'}`}>{CHIP[i.kind]?.[0] || i.kind.toLowerCase()}{i.dryRun && i.kind === 'AJUSTE_SUGERIDO' ? ' · teste' : ''}</span></div>
      <div className="ar-sub">{i.detail}</div>
      {i.suggestion?.text ? <div className="sug">💡 {i.suggestion.text}</div> : null}
      {i.warning ? <div className="ar-sub" style={{ fontSize: 12 }}>{i.warning.ackAt ? `✔ Colaborador deu Ciente no aviso do ponto em ${dt(i.warning.ackAt)}` : `🔔 Aviso mostrado no ponto ${i.warning.shownCount}x (último ${dt(i.warning.lastShownAt)}) · ainda sem Ciente`}</div> : i.status === 'OPEN' ? <div className="ar-sub" style={{ fontSize: 12 }}>Colaborador ainda não viu o aviso no ponto.</div> : null}
      {i.status !== 'OPEN' ? <div className="ar-sub" style={{ fontSize: 12 }}>{i.status === 'IGNORED' ? 'Ignorada' : `Resolvida: ${i.resolution || ''}`}</div> : null}
      {i.status === 'OPEN' ? <div className="ar-acts">
        {canAccept(i) ? <button type="button" className={`ar-btn s ${i.suggestion?.kind === 'LAUNCH_REQUEST' ? 'g' : ''}`} disabled={busy === i.id} onClick={() => void act(i, 'ACEITAR')}>{i.suggestion?.kind === 'LAUNCH_REQUEST' ? 'Lançar na folha' : i.suggestion?.kind === 'DIA_EXTRA' ? '✔ Lançar Dia extra' : '✔ Aceitar sugestão'}</button> : null}
        <button type="button" className="ar-btn o s" onClick={() => onAdjust(i.userId, i.date)}>✎ Ajustar</button>
        <button type="button" className="ar-btn r s" disabled={busy === i.id} onClick={() => void act(i, 'IGNORAR')}>Ignorar</button>
      </div> : null}
    </div>)}
  </div>;
}
