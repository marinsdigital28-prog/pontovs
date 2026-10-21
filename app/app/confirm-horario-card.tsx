'use client';

import { useState } from 'react';

const LABEL: Record<string, string> = { ENTRADA: 'Entrada', INTERVALO: 'Saída intervalo', RETORNO: 'Retorno intervalo', SAIDA: 'Saída' };
type P = { type: string; time: string };

export function parseConfirm(details?: string | null): { punches: P[]; correction?: P[] | null } | null {
  try { const v = JSON.parse(details || ''); return v && Array.isArray(v.punches) ? v : null; } catch { return null; }
}

/** Pedido do gestor para o colaborador confirmar um horário esquecido. A batida só é criada ao confirmar. */
export default function ConfirmHorarioCard({ id, details, status, onDone }: { id: string; details?: string | null; status: string; onDone: () => void | Promise<void> }) {
  const data = parseConfirm(details);
  const [mode, setMode] = useState<'view' | 'fix'>('view');
  const [times, setTimes] = useState<P[]>(data?.punches || []);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  if (!data) return null;
  if (status !== 'PENDENTE') {
    const shown = status === 'CONTESTADO' && data.correction?.length ? data.correction : data.punches;
    return <p className="emp-muted">{shown.map((p) => `${LABEL[p.type] || p.type} ${p.time}`).join(' · ')}{status === 'CONTESTADO' ? ' · correção enviada, aguardando a administração' : ''}</p>;
  }
  async function send(action: 'CONFIRMAR' | 'CORRIGIR') {
    setBusy(true); setMsg('');
    const res = await fetch('/api/employee/requests', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action, ...(action === 'CORRIGIR' ? { punches: times, note: note || null } : {}) }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setMsg(json.error || 'Não foi possível enviar.'); return; }
    await onDone();
  }
  return (
    <div className="emp-confirm">
      <p>A administração pede que você confirme {data.punches.length > 1 ? 'os horários' : 'o horário'}:</p>
      {mode === 'view' ? (
        <ul>{data.punches.map((p) => <li key={p.type}><strong>{LABEL[p.type] || p.type}</strong> às <strong>{p.time}</strong></li>)}</ul>
      ) : (
        <div className="emp-confirm-fix">
          {times.map((p, i) => (
            <label key={p.type}>{LABEL[p.type] || p.type}
              <input type="time" value={p.time} onChange={(e) => setTimes((list) => list.map((x, j) => (j === i ? { ...x, time: e.target.value } : x)))} />
            </label>
          ))}
          <label>Observação (opcional)<input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: saí mais cedo com autorização" /></label>
        </div>
      )}
      <div className="emp-confirm-actions">
        {mode === 'view' ? (
          <>
            <button type="button" className="emp-btn primary" disabled={busy} onClick={() => send('CONFIRMAR')}>Confirmar</button>
            <button type="button" className="emp-btn" disabled={busy} onClick={() => setMode('fix')}>Corrigir</button>
          </>
        ) : (
          <>
            <button type="button" className="emp-btn primary" disabled={busy} onClick={() => send('CORRIGIR')}>Enviar correção</button>
            <button type="button" className="emp-btn" disabled={busy} onClick={() => setMode('view')}>Voltar</button>
          </>
        )}
      </div>
      {msg ? <p className="emp-error">{msg}</p> : null}
    </div>
  );
}
