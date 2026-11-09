'use client';

import { useEffect, useRef, useState } from 'react';
import PontinhoIcon from './pontinho-icon';

type Proposal = { id: string; kind: string; title: string; employee: string; date: string; before: string[]; after: string[]; checks: { label: string; ok: boolean }[]; needsDocument: boolean };
type Msg = { role: 'user' | 'assistant'; content: string; proposals?: Proposal[] };
type Doc = { name: string; mime: string; data: string };
const QUICK = ['Quem não bateu saída ontem?', 'Quem está de atestado hoje?', 'Pendências abertas', 'Quem nunca acessou o app?'];
const fmt = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/** Foto do atestado: reduz no navegador (limite de 4,5 MB por requisição na Vercel). A foto vai só para o servidor, nunca para a IA. */
async function readDoc(file: File): Promise<Doc> {
  if (!['image/jpeg', 'image/png', 'application/pdf'].includes(file.type)) throw new Error('Aceito JPG, PNG ou PDF.');
  const asUrl = (blob: Blob) => new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => no(new Error('Não consegui ler o arquivo.')); r.readAsDataURL(blob); });
  if (file.type === 'application/pdf') { if (file.size > 3 * 1024 * 1024) throw new Error('PDF até 3 MB.'); return { name: file.name, mime: file.type, data: await asUrl(file) }; }
  const img = new Image(); img.src = URL.createObjectURL(file);
  await img.decode();
  const scale = Math.min(1, 1800 / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(img.src);
  return { name: file.name.replace(/\.\w+$/, '') + '.jpg', mime: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.85) };
}

function ProposalCard({ p, onDone }: { p: Proposal; onDone: (text: string) => void }) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [state, setState] = useState<'open' | 'busy' | 'done' | 'cancel'>('open');
  const [err, setErr] = useState('');
  async function decide(decision: 'CONFIRMAR' | 'CANCELAR') {
    setState('busy'); setErr('');
    const r = await fetch('/api/admin/assistant/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id, decision, document: doc }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setState('open'); setErr(d.error || 'Não foi possível.'); return; }
    setState(decision === 'CONFIRMAR' ? 'done' : 'cancel');
    onDone(decision === 'CONFIRMAR' ? `✔ Gravado: ${p.title} (${p.employee.split(' ')[0]}, ${fmt(p.date)}). Fica no histórico com seu nome.` : 'Ok, cancelei. Nada foi gravado.');
  }
  return <div className="ar-prop">
    <div className="t">{state === 'done' ? '✔ Gravado' : state === 'cancel' ? 'Cancelado' : '✋ Mudança proposta · nada gravado ainda'}</div>
    <div style={{ marginTop: 4 }}><b>{p.employee.split(' ').slice(0, 2).join(' ')} · {fmt(p.date)}</b> · {p.title}</div>
    <div className="ar-ba"><div className="bf"><i>Antes</i>{p.before.map((l, k) => <div key={k}>{l}</div>)}</div><div className="af"><i>Depois</i>{p.after.map((l, k) => <div key={k}>{l}</div>)}</div></div>
    <div className="ar-steps">{p.checks.map((c, k) => <span key={k} className={c.ok ? '' : (/anexar/.test(c.label) ? (doc ? '' : 'q') : 'f')}>{c.ok || (/anexar/.test(c.label) && doc) ? '✔' : /anexar/.test(c.label) ? '📎' : '✖'} {c.label}</span>)}</div>
    {p.needsDocument && state === 'open' ? <label className="ar-sub" style={{ display: 'block', margin: '4px 0' }}>📎 Foto/PDF do atestado: <input type="file" accept="image/jpeg,image/png,application/pdf" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { setDoc(await readDoc(f)); setErr(''); } catch (x) { setErr((x as Error).message); } }} /></label> : null}
    {err ? <div className="ar-w ar-red">{err}</div> : null}
    {state === 'open' || state === 'busy' ? <div className="ar-acts">
      <button type="button" className="ar-btn" disabled={state === 'busy' || (p.needsDocument && !doc) || p.checks.some((c) => !c.ok && !/anexar/.test(c.label))} onClick={() => void decide('CONFIRMAR')}>✔ Confirmar</button>
      <button type="button" className="ar-btn r" disabled={state === 'busy'} onClick={() => void decide('CANCELAR')}>Cancelar</button>
    </div> : null}
  </div>;
}

export default function PontinhoChat({ adminName, badge }: { adminName: string; badge?: number }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs, busy]);

  async function send(q: string) {
    const question = q.trim(); if (!question || busy) return;
    const next: Msg[] = [...msgs, { role: 'user', content: question }];
    setMsgs(next); setText(''); setBusy(true);
    try {
      const r = await fetch('/api/admin/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: next.map((m) => ({ role: m.role, content: m.content + (m.proposals?.length ? `\n[propostas mostradas: ${m.proposals.map((p) => p.title).join('; ')}]` : '') })).slice(-12) }) });
      const d = await r.json().catch(() => ({}));
      setMsgs((m) => [...m, r.ok ? { role: 'assistant', content: d.text || (d.proposals?.length ? 'Confira a mudança abaixo:' : '…'), proposals: d.proposals || [] } : { role: 'assistant', content: `⚠ ${d.error || 'Não consegui responder agora.'}` }]);
    } catch { setMsgs((m) => [...m, { role: 'assistant', content: '⚠ Sem conexão. Tente de novo.' }]); }
    setBusy(false);
  }

  return <>
    {!open ? <div className="ar-hello">Oi! Precisa de ajuda? 😊</div> : null}
    <button type="button" className="ar-fab" aria-label="Abrir Pontinho" onClick={() => setOpen((v) => !v)}><PontinhoIcon size={50} />{badge ? <span className="ar-badge" style={{ top: -2, right: -2 }}>{badge}</span> : null}</button>
    {open ? <div className="ar-chat" role="dialog" aria-label="Pontinho">
      <div className="ar-ch"><PontinhoIcon size={40} /><div><div className="n">Pontinho</div><div className="s">seu assistente do ponto · online</div></div><button type="button" aria-label="Fechar" onClick={() => setOpen(false)}>✕</button></div>
      <div className="ar-msgs">
        <div className="ar-m b">Oi, {adminName.split(' ')[0]}! 👋 Pergunte qualquer coisa sobre o ponto. Se quiser mudar algo, eu te mostro antes e só gravo quando você confirmar.</div>
        {msgs.map((m, i) => <div key={i} style={{ display: 'contents' }}>
          <div className={`ar-m ${m.role === 'user' ? 'u' : 'b'}`}>{m.content}</div>
          {m.proposals?.map((p) => <ProposalCard key={p.id} p={p} onDone={(t) => setMsgs((x) => [...x, { role: 'assistant', content: t }])} />)}
        </div>)}
        {busy ? <div className="ar-m b">Pensando… 🤔</div> : null}
        <div ref={end} />
      </div>
      <div className="ar-sugs">{QUICK.map((q) => <button key={q} type="button" disabled={busy} onClick={() => void send(q)}>{q}</button>)}</div>
      <form className="ar-inp" onSubmit={(e) => { e.preventDefault(); void send(text); }}><input value={text} onChange={(e) => setText(e.target.value)} placeholder="Pergunte ao Pontinho…" maxLength={1500} /><button type="submit" className="ar-btn" disabled={busy || !text.trim()}>➤</button></form>
      <div className="ar-lock">🔒 Só administradores · toda ação fica no histórico com seu nome</div>
    </div> : null}
  </>;
}
