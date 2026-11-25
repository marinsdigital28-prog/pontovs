'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { brazilDateKey } from '@/lib/brazil-time';
import { QUICK_KINDS, toMinutes, type QuickKind } from '@/lib/atestado-rapido';
import './atestado-rapido.css';

type Emp = { id: string; name: string; employeeNumber: string | null; jobTitle?: string | null; workDays?: string | null; scheduleStart?: string | null; scheduleEnd?: string | null; active?: boolean };
type DayNumbers = { worked: number | null; credited: number | null; justified: number; expected: number | null; balance: number | null; situation: string; cells: (string | null)[] };
type Step = { kind: 'KEEP' | 'ADD' | 'RELABEL' | 'CERT'; text: string; time?: string; start?: string; end?: string; from?: string; to?: string };
type Preview = {
  employee: { id: string; name: string; employeeNumber: string | null; jobTitle: string | null };
  schedule: string | null; scheduled: boolean;
  punches: { id: string; time: string; type: string; label: string; originalType: string; manual: boolean }[];
  link: { id: string; status: string; reason: string; details: string | null; reviewedAt: string | null } | null;
  openPendencias: { id: string; kind: string; title: string }[];
  proposal: { partial: boolean; leave: string | null; back: string | null; abonoStart: string | null; abonoEnd: string | null; steps: Step[]; warnings: string[] };
  before: { day: DayNumbers }; after: { day: DayNumbers }; ready: boolean;
};

const clock = (m: number | null | undefined) => (m === null || m === undefined ? '—' : `${Math.floor(Math.abs(m) / 60)}:${String(Math.abs(m) % 60).padStart(2, '0')}`);
const signed = (m: number | null | undefined) => (m === null || m === undefined ? '—' : `${m < 0 ? '−' : m > 0 ? '+' : ''}${clock(m)}`);
const initials = (n: string) => n.split(/\s+/).filter((w) => w.length > 2).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const nice = (n: string) => n.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()).replace(/ (Da|De|Do|Das|Dos|E) /g, (m) => m.toLowerCase());
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' }).replace('.', '').replace(',', '');
const shift = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const TYPE_TXT: Record<string, string> = { ENTRADA: 'Entrada', INTERVALO: 'Marcada como Intervalo', RETORNO: 'Retorno', SAIDA: 'Saída' };

export default function AtestadoRapido({ employees, initialEmployeeId, initialDate, initialNonce }: { employees: Emp[]; initialEmployeeId?: string; initialDate?: string; initialNonce?: number }) {
  const today = brazilDateKey(new Date());
  const pick = () => employees.find((e) => e.id === initialEmployeeId) || null;
  const [emp, setEmp] = useState<Emp | null>(pick);
  const [q, setQ] = useState('');
  const [date, setDate] = useState(initialDate || shift(today, -1));
  const [kind, setKind] = useState<QuickKind>('ATESTADO_MEDICO');
  const [partial, setPartial] = useState(true);
  const [docStart, setDocStart] = useState('');
  const [docEnd, setDocEnd] = useState('');
  const [mode, setMode] = useState<'GAP' | 'DOC'>('GAP');
  const [leave, setLeave] = useState('');
  const [doc, setDoc] = useState<{ name: string; mime: string; data: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [docOnly, setDocOnly] = useState<Preview | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!initialNonce && !initialEmployeeId) return;
    const e = pick();
    if (e) { setEmp(e); setQ(''); }
    if (initialDate) setDate(initialDate);
    setDone(''); setErr(''); setPreview(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialNonce, initialEmployeeId, initialDate]);

  const hits = useMemo(() => {
    const t = q.trim().toLowerCase(); if (!t) return [];
    return employees.filter((e) => e.active !== false && (e.name.toLowerCase().includes(t) || String(e.employeeNumber || '').includes(t))).slice(0, 8);
  }, [q, employees]);

  const params = (m: 'GAP' | 'DOC') => new URLSearchParams({ employeeId: emp?.id || '', date, kind, partial: String(partial), docStart, docEnd, mode: m, ...(leave && m === 'GAP' ? { leave } : {}) });
  useEffect(() => {
    if (!emp) { setPreview(null); return; }
    if (partial && (!/^\d{2}:\d{2}$/.test(docStart) || !/^\d{2}:\d{2}$/.test(docEnd))) { setErr(''); }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const [a, b] = await Promise.all([
          fetch(`/api/admin/atestado-rapido?${params(mode)}`, { cache: 'no-store', signal: ctl.signal }).then((r) => r.json()),
          partial ? fetch(`/api/admin/atestado-rapido?${params(mode === 'GAP' ? 'DOC' : 'GAP')}`, { cache: 'no-store', signal: ctl.signal }).then((r) => r.json()) : Promise.resolve(null),
        ]);
        if (a.error) { setErr(a.error); setPreview(null); return; }
        setErr(''); setPreview(a); setDocOnly(b && !b.error ? b : null);
      } catch { /* abortado */ }
    }, 250);
    return () => { clearTimeout(t); ctl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emp?.id, date, kind, partial, docStart, docEnd, mode, leave, done]);

  const gap = mode === 'GAP' ? preview : docOnly; const only = mode === 'DOC' ? preview : docOnly;
  const docLabel = QUICK_KINDS[kind].docLabel;

  async function confirm() {
    if (!emp || !preview?.ready) return;
    setBusy(true); setErr('');
    const res = await fetch('/api/admin/atestado-rapido', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ employeeId: emp.id, date, kind, partial, docStart, docEnd, mode, leave: leave || undefined, documentName: doc?.name, documentMime: doc?.mime, documentData: doc?.data }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setErr(j.error || 'Não foi possível lançar.'); return; }
    setDone(`Lançado: ${docLabel} de ${nice(emp.name)} em ${fmtDay(date)} · saldo do dia ${signed(j.after?.day?.balance)}. Tudo registrado na auditoria.`);
    setDoc(null);
  }
  function onFile(f?: File) {
    if (!f) return;
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(f.type) || f.size > 10 * 1024 * 1024) { setErr('Anexo: PDF, JPG ou PNG até 10 MB.'); return; }
    const r = new FileReader(); r.onload = () => setDoc({ name: f.name, mime: f.type, data: String(r.result) }); r.readAsDataURL(f);
  }

  // linha do tempo 07h–18h
  const T0 = 7 * 60, T1 = 18 * 60; const pct = (m: number) => `${(((Math.min(T1, Math.max(T0, m)) - T0) / (T1 - T0)) * 100).toFixed(2)}%`;
  const wid = (a: number, b: number) => `${(((Math.min(T1, b) - Math.max(T0, a)) / (T1 - T0)) * 100).toFixed(2)}%`;
  const tl = useMemo(() => {
    if (!preview) return null;
    const cells = preview.after.day.cells.map((c) => (c ? toMinutes(c) : null));
    const [e, i, r, s] = cells; const segs: { a: number; b: number; c: string }[] = [];
    if (e !== null && i !== null) segs.push({ a: e, b: i, c: 'w' }); if (r !== null && s !== null) segs.push({ a: r, b: s, c: 'w' });
    if (!segs.length && e !== null && s !== null) segs.push({ a: e, b: s, c: 'w' });
    const as = toMinutes(preview.proposal.abonoStart), ae = toMinutes(preview.proposal.abonoEnd);
    if (as !== null && ae !== null) {
      const lunchIn = as < 13 * 60 && ae > 12 * 60;
      if (lunchIn) { if (as < 12 * 60) segs.push({ a: as, b: 12 * 60, c: 'a' }); segs.push({ a: Math.max(as, 12 * 60), b: Math.min(ae, 13 * 60), c: 'l' }); if (ae > 13 * 60) segs.push({ a: 13 * 60, b: ae, c: 'a' }); }
      else segs.push({ a: as, b: ae, c: 'a' });
    }
    const [ss, se] = (preview.schedule || '').split('–').map((x) => toMinutes(x));
    return { segs, marks: preview.after.day.cells.filter(Boolean) as string[], ss, se };
  }, [preview]);

  const steps = preview?.proposal.steps || [];
  const icon = (s: Step) => s.kind === 'KEEP' ? ['✓', 'var(--gl)', 'var(--g)'] : s.kind === 'ADD' ? ['+', 'var(--goldl)', '#8a6a00'] : s.kind === 'RELABEL' ? ['↺', 'var(--bluel)', 'var(--blue)'] : ['⚖', 'var(--goldl)', '#8a6a00'];
  const sub = (s: Step) => s.kind === 'KEEP' ? 'batida original' : s.kind === 'ADD' ? 'marcação incluída pelo gestor · fica com * na folha e no histórico' : s.kind === 'RELABEL' ? `era “${TYPE_TXT[s.from || ''] || s.from}” · só reinterpretação, a batida original fica igual` : (mode === 'GAP' ? 'abono das horas fora, descontando o almoço' : 'abono só do horário do documento');
  const nAdj = steps.filter((s) => s.kind !== 'KEEP').length;

  return <div className="aq">
    <p className="aq-sub">Escolha a pessoa e o dia — o sistema lê as batidas e já monta os ajustes. Você só confere e confirma.</p>
    {done ? <div className="aq-ok">✓ {done}</div> : null}
    <div className="aq-grid">
      <div>
        <div className="aq-card">
          <p className="aq-step"><i>1</i> Quem e quando</p>
          <div className="aq-field"><label>Funcionário</label>
            {emp ? <div className="aq-who"><div className="aq-av">{initials(emp.name)}</div><div><b>{nice(emp.name)}</b><small>Mat. {emp.employeeNumber || '—'}{emp.jobTitle ? ` · ${nice(emp.jobTitle)}` : ''}{emp.scheduleStart ? ` · ${emp.scheduleStart}–${emp.scheduleEnd}` : ''}</small></div><button type="button" aria-label="Trocar funcionário" onClick={() => { setEmp(null); setPreview(null); setDone(''); }}>✕</button></div>
              : <div className="aq-search"><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome ou matrícula…" aria-label="Buscar funcionário" onKeyDown={(e) => { if (e.key === 'Enter' && hits[0]) { setEmp(hits[0]); setQ(''); setDone(''); } }} />
                {hits.length ? <ul>{hits.map((h) => <li key={h.id}><button type="button" onClick={() => { setEmp(h); setQ(''); setDone(''); }}><span className="aq-av" style={{ width: 28, height: 28, fontSize: 11 }}>{initials(h.name)}</span><span>{nice(h.name)} <small>· mat. {h.employeeNumber || '—'}</small></span></button></li>)}</ul> : null}</div>}
          </div>
          <div className="aq-field" style={{ margin: 0 }}><label>Data</label>
            <div className="aq-pills">
              <button type="button" className={`aq-pill ${date === today ? 'on' : ''}`} onClick={() => setDate(today)}>Hoje {fmtDay(today).split(' ')[1]}</button>
              <button type="button" className={`aq-pill ${date === shift(today, -1) ? 'on' : ''}`} onClick={() => setDate(shift(today, -1))}>Ontem · {fmtDay(shift(today, -1))}</button>
              <label className={`aq-pill ${date !== today && date !== shift(today, -1) ? 'on' : ''}`}>📅 <input type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Outra data" /></label>
            </div></div>
        </div>
        <div className="aq-card">
          <p className="aq-step"><i>2</i> Documento</p>
          <div className="aq-field"><label>Tipo</label>
            <div className="aq-pills">{(Object.keys(QUICK_KINDS) as QuickKind[]).map((k) => <button key={k} type="button" className={`aq-pill ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>{k === 'PERICIA_JUDICIAL' ? '⚖️ ' : ''}{QUICK_KINDS[k].label}</button>)}</div></div>
          <div className="aq-field"><label>Duração</label><div className="aq-seg"><button type="button" className={!partial ? 'on' : ''} onClick={() => setPartial(false)}>Dia inteiro</button><button type="button" className={partial ? 'on' : ''} onClick={() => setPartial(true)}>Parcial (horas)</button></div></div>
          {partial ? <>
            <div className="aq-field"><label>Horário do documento</label>
              <div className="aq-times"><label className="aq-inp"><small>Das</small><input type="time" value={docStart} onChange={(e) => setDocStart(e.target.value)} /></label><label className="aq-inp"><small>Até</small><input type="time" value={docEnd} onChange={(e) => setDocEnd(e.target.value)} /></label></div></div>
            {preview && docStart && docEnd ? <div className="aq-field"><label>O que abonar</label>
              <button type="button" className={`aq-opt ${mode === 'GAP' ? 'on' : ''}`} onClick={() => setMode('GAP')}><span className="r" /><div><b>Ausência inteira {gap?.proposal.abonoStart || '—'} → {gap?.proposal.abonoEnd || '—'} <span className="aq-tag aq-tg">RECOMENDADO</span></b><small>Da saída até a volta registrada. Almoço 12:00–13:00 não entra.</small></div><span className="v">+{clock(gap?.after.day.justified ?? 0)}</span></button>
              <button type="button" className={`aq-opt ${mode === 'DOC' ? 'on' : ''}`} onClick={() => setMode('DOC')}><span className="r" /><div><b>Só o horário do documento {docStart} → {docEnd}</b><small>{(only?.after.day.justified ?? 0) === 0 ? 'Cai dentro do almoço ou do horário trabalhado — não abona nada.' : 'Batidas ficam como estão.'}</small></div><span className={`v ${(only?.after.day.justified ?? 0) === 0 ? 'mutd' : ''}`}>+{clock(only?.after.day.justified ?? 0)}</span></button>
              {mode === 'GAP' ? <div className="aq-times" style={{ marginTop: 4 }}><label className="aq-inp"><small>Saída (ajuste se precisar)</small><input type="time" value={leave || preview.proposal.leave || ''} onChange={(e) => setLeave(e.target.value)} /></label><div className="aq-inp"><small>Volta (batida real)</small><b style={{ fontSize: 15 }}>{preview.proposal.back || '—'}</b></div></div> : null}
            </div> : null}
          </> : null}
          <div className="aq-field" style={{ margin: 0 }}><label>Anexo (opcional)</label>
            <div className="aq-drop" role="button" tabIndex={0} onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files[0]); }}>📎 <div>{doc ? <><b>{doc.name}</b><br />toque para trocar</> : <><b>Arraste a foto ou PDF da declaração</b><br />ou tire foto pelo celular · pode anexar depois</>}</div><input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png" capture="environment" onChange={(e) => onFile(e.target.files?.[0])} /></div></div>
        </div>
      </div>
      <div>
        {!emp ? <div className="aq-card"><div className="aq-empty">Escolha o funcionário para ler as batidas do dia.</div></div> : !preview ? <div className="aq-card"><div className="aq-empty">{err || 'Lendo as batidas…'}</div></div> : <>
          <div className="aq-card">
            <div className="aq-ttl"><h3>Batidas reais de {fmtDay(date)}</h3><span>lidas agora · originais nunca são alteradas</span></div>
            {preview.punches.length ? <div className="aq-punches">{preview.punches.map((p) => <div key={p.id} className="aq-pc" style={p.manual ? { borderColor: '#e7cf7d', background: '#fffaf0' } : undefined}><small>{TYPE_TXT[p.originalType] || p.originalType}</small><b>{p.time}{p.manual ? '*' : ''}</b><em>{p.type !== p.originalType ? `vale como ${p.label}` : p.manual ? 'lançada pelo gestor' : 'original'}</em></div>)}</div> : <div className="aq-empty">Nenhuma batida neste dia.</div>}
            {preview.link ? <div className="aq-linked">🔗 <div><b>Pedido do app {preview.link.status === 'APROVADO' ? 'já aprovado' : 'pendente'}:</b> “{preview.link.reason}{preview.link.details ? ` · ${preview.link.details}` : ''}”. {preview.link.status === 'APROVADO' ? 'Vai ser vinculado a este lançamento (sem abonar em dobro).' : 'Aprove o pedido para vincular.'}{preview.openPendencias.length ? ` ${preview.openPendencias.length === 1 ? 'A pendência do dia fecha' : `As ${preview.openPendencias.length} pendências do dia fecham`} sozinha${preview.openPendencias.length === 1 ? '' : 's'}.` : ''}</div></div> : preview.openPendencias.length ? <div className="aq-linked">🔔 <div>{preview.openPendencias.length} pendência(s) do dia fecham com este lançamento.</div></div> : null}
          </div>
          <div className="aq-card">
            <div className="aq-ttl"><h3>✨ O sistema propõe</h3><span>a partir das batidas + escala {preview.schedule || '—'}</span></div>
            {tl ? <><div className="aq-tl"><div className="axis" />
              {tl.ss != null && tl.se != null ? <div className="sch" style={{ left: pct(tl.ss), width: wid(tl.ss, tl.se) }} /> : null}
              {tl.segs.map((s, i) => <div key={i} className={`s ${s.c}`} style={{ left: pct(s.a), width: wid(s.a, s.b) }} />)}
              {tl.marks.map((m, i) => <div key={i} className="mk" style={{ left: pct(toMinutes(m) || 0), color: m.endsWith('*') ? '#9a7400' : 'var(--g)' }}>{m}</div>)}
              {partial && docStart && docEnd ? <div className="mk b" style={{ left: pct(((toMinutes(docStart) || 0) + (toMinutes(docEnd) || 0)) / 2), color: 'var(--blue)' }}>{docLabel.toLowerCase().split(' ')[0]} {docStart}–{docEnd}</div> : null}
            </div><div className="aq-hours">{Array.from({ length: 12 }, (_, i) => <span key={i}>{String(7 + i).padStart(2, '0')}{i === 0 || i === 11 ? 'h' : ''}</span>)}</div>
            <div className="aq-legend"><span style={{ ['--c' as string]: 'var(--g)' }}>trabalhado {clock(preview.after.day.worked)}</span><span style={{ ['--c' as string]: '#f1d77a' }}>abonado {clock(preview.after.day.justified)}</span><span style={{ ['--c' as string]: '#d9dfda' }}>almoço</span></div></> : null}
            <div style={{ marginTop: 8 }}>{steps.map((s, i) => { const [ic, bg, fg] = icon(s); return <div key={i} className="aq-prop"><span className="aq-pi" style={{ background: bg, color: fg }}>{ic}</span><div><b>{s.text}{s.kind === 'ADD' ? <span className="aq-tag aq-ty">GESTOR *</span> : null}{s.kind === 'CERT' && preview.after.day.justified ? <span className="aq-tag aq-tg">+{clock(preview.after.day.justified)}</span> : null}</b><small>{sub(s)}</small></div><span className="ck">✓</span></div>; })}</div>
            {preview.proposal.warnings.map((w, i) => <div key={i} className="aq-warn">⚠ {w}</div>)}
          </div>
          <div className="aq-card">
            <div className="aq-ttl"><h3>Prévia do dia {fmtDay(date).split(' ')[1]}</h3><span>como vai sair na folha</span></div>
            <div className="aq-ba">
              <div className="h">&nbsp;</div><div className="h n">Antes</div><div className="h n aft">Depois</div>
              <div>Batidas</div><div className="n mutd" style={{ fontWeight: 500 }}>{preview.before.day.cells.map((c) => c || '—').join(' · ')}</div><div className="n aft" style={{ fontWeight: 500 }}>{preview.after.day.cells.map((c) => c || '—').join(' · ')}</div>
              <div>Trabalhado</div><div className="n">{clock(preview.before.day.worked)}</div><div className="n aft">{clock(preview.after.day.worked)}</div>
              <div>Abonado</div><div className={`n ${preview.before.day.justified ? 'pos' : 'mutd'}`}>{preview.before.day.justified ? `+${clock(preview.before.day.justified)}` : '0:00'}</div><div className={`n aft ${preview.after.day.justified ? 'pos' : 'mutd'}`}>{preview.after.day.justified ? `+${clock(preview.after.day.justified)}` : '0:00'}</div>
              <div>Previsto</div><div className="n">{clock(preview.before.day.expected)}</div><div className="n aft">{clock(preview.after.day.expected)}</div>
              <div className="last"><b>Saldo do dia</b></div><div className={`n last ${(preview.before.day.balance ?? 0) < 0 ? 'neg' : 'pos'}`}>{signed(preview.before.day.balance)}</div><div className={`n last aft ${(preview.after.day.balance ?? 0) < 0 ? 'neg' : 'pos'}`}>{signed(preview.after.day.balance)}</div>
            </div>
            {preview.ready && preview.after.day.balance !== null && preview.after.day.balance !== 0 ? <div className="aq-tip">💡 O saldo que sobra ({signed(preview.after.day.balance)}) vem das batidas reais fora da ausência (atraso na entrada ou saída antes/depois do horário).</div> : null}
          </div>
        </>}
      </div>
    </div>
    {err && preview ? <div className="aq-warn">⚠ {err}</div> : null}
    <div className="aq-cta"><div className="txt"><b>{nAdj} ajuste{nAdj === 1 ? '' : 's'} · 1 documento</b><small>Tudo vai para a auditoria (quem, quando, por quê). Batidas originais intactas — Portaria 671.</small></div>
      <button type="button" className="big" disabled={!preview?.ready || busy} onClick={() => void confirm()}>{busy ? 'Lançando…' : '✓ Confirmar e lançar'}</button></div>
  </div>;
}
