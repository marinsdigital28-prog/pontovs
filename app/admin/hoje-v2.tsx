'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { shortName } from '@/lib/short-name';
import { isLate14Suggestion, kpiGroups, pendenciaCounts } from '@/lib/hoje-kpis';
import HojeKpiDrawers, { type DrawerKey } from './hoje-drawers';

/* Tela "Hoje" do painel v2 — fiel à arte aprovada. Só lê dados reais de /api/admin/hoje.
 * Ações usam as rotas existentes (pendências e pedidos). Nenhuma batida original é alterada (Portaria 671). */

type P = { id: string; time: string; type: string; originalType: string; manual: boolean; rejected: boolean };
type Person = { id: string; name: string; employeeNumber: string | null; jobTitle: string | null; scheduled: boolean; schedule: { start: string; end: string; mode: string; lunchStart: string | null; lunchEnd: string | null } | null; punches: P[]; lastType: string | null; absence: { reason: string; classification: string | null } | null };
type Sug = { kind: string; text: string; punches?: { type: string; time: string }[]; relabels?: { punchId: string; time: string; from: string; to: string }[]; confidence?: number; level?: string; resultingDay?: string; requestId?: string; learnedNote?: string | null };
export type Pend = { id: string; userId: string; date: string; kind: string; title: string; detail: string; dryRun: boolean; suggestion: Sug | null; level: 'ALTA' | 'MEDIA' | 'DUVIDA' | 'CONFERIR'; employee: { name: string; jobTitle: string | null } | null };
type Absence = { id: string; employeeId: string; name: string; status: string; start: string; end: string; reason: string; details: string | null; classification: string | null; launched: boolean };
export type HojeData = {
  now: string; today: string; nowMin: number; weekday: string; week: { from: string; to: string };
  people: Person[]; pendencias: Pend[]; openCount: number; late14: number; autoClosed: { name: string; date: string }[];
  absences: Absence[]; pedidosPendentes: number; pendDays: Record<string, { schedule: string | null; punches: P[] }>;
  closing: { lastDay: string; businessDays: number; monthLabel: string };
};

const TYPES = ['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA'] as const;
const LABEL: Record<string, string> = { ENTRADA: 'Entrada', INTERVALO: 'Intervalo', RETORNO: 'Retorno', SAIDA: 'Saída' };
const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const KIND: Record<string, [string, string]> = {
  POUCAS_BATIDAS: ['Batidas faltando', 'md'], SEM_BATIDAS: ['Sem batida', 'lo'], FORA_ESCALA: ['Fora da escala', 'md'], TIPO_ERRADO: ['Tipo estranho', 'lo'],
  PEDIDO_NAO_LANCADO: ['Pedido não lançado', 'md'], SEM_FOTO: ['Sem foto', 'lo'], CONFLITO: ['Abono parcial', 'md'], DUVIDA: ['Dúvida', 'lo'], HORARIO_SUSPEITO: ['Horário suspeito', 'lo'], AJUSTE_SUGERIDO: ['Ajuste sugerido', 'md'],
};
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
export { shortName };
const initials = (full: string) => shortName(full).split(' ').map((w) => w.charAt(0)).join('').toUpperCase().slice(0, 2);
const toMin = (hm: string) => { const m = String(hm).match(/^(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
const fmtH = (min: number) => `${Math.floor(Math.abs(min) / 60)}h${String(Math.abs(min) % 60).padStart(2, '0')}`;
const fmtSaldo = (min: number) => `${min < 0 ? '−' : '+'}${Math.floor(Math.abs(min) / 60)}:${String(Math.abs(min) % 60).padStart(2, '0')}`;
const dayLabel = (key: string) => `${WD[new Date(`${key}T12:00:00Z`).getUTCDay()]} ${key.slice(8, 10)}/${key.slice(5, 7)}`;
const pct = (min: number) => `${Math.max(0, Math.min(100, ((min - 360) / 720) * 100)).toFixed(1)}%`;
const width = (a: number, b: number) => `${Math.max(0, ((Math.min(b, 1080) - Math.max(a, 360)) / 720) * 100).toFixed(1)}%`;
const PERIOD: Record<string, string> = { DIA_INTEIRO: 'dia inteiro', PARCIAL_TARDE: 'tarde', PARCIAL_MANHA: 'manhã', HORAS: 'algumas horas' };
const isMedical = (a: Absence) => /m[ée]dic|exame|consulta|sa[úu]de|dentista/i.test(`${a.reason} ${a.details || ''}`);

function resulting(s: Sug | null, schedule: string | null) {
  if (!s?.resultingDay) return null;
  const at: Record<string, number> = {};
  for (const part of s.resultingDay.split('·')) { const m = part.trim().match(/^(\d{2}:\d{2})\s+(Entrada|Intervalo|Retorno|Saída)/); if (m) at[{ Entrada: 'ENTRADA', Intervalo: 'INTERVALO', Retorno: 'RETORNO', 'Saída': 'SAIDA' }[m[2]]!] = toMin(m[1]); }
  let worked: number | null = null; let lunch: number | null = null;
  if (at.ENTRADA != null && at.SAIDA != null) {
    if (at.INTERVALO != null && at.RETORNO != null) { lunch = at.RETORNO - at.INTERVALO; worked = at.INTERVALO - at.ENTRADA + (at.SAIDA - at.RETORNO); } else worked = at.SAIDA - at.ENTRADA;
  }
  if (worked == null) return null;
  const sm = schedule?.match(/(\d{2}:\d{2})–(\d{2}:\d{2})/);
  let expected: number | null = null;
  if (sm) { const span = toMin(sm[2]) - toMin(sm[1]); expected = span > 6 * 60 ? span - 60 : span; }
  return { worked, lunch, saldo: expected == null ? null : worked - expected };
}

function whyText(s: Sug | null) {
  if (!s) return '';
  return s.text.replace(/^Sugestão \(\d+%\):\s*/, '').replace(/\s*Dia fica:[^]*$/, '').replace(/\s*Aprendido com sua[^.]*\.?/, '').trim();
}

function SuggestionCard({ p, day, busy, onAccept, onIgnore, onAdjust }: { p: Pend; day?: { schedule: string | null; punches: P[] }; busy: boolean; onAccept: () => void; onIgnore: () => void; onAdjust: () => void }) {
  const s = p.suggestion; const name = p.employee?.name || '—';
  const insert = s?.kind === 'INSERT_PUNCHES';
  const cls = p.level === 'ALTA' ? 'hi' : p.level === 'MEDIA' ? 'md' : 'lo';
  const conf = typeof s?.confidence === 'number' ? Math.round(s.confidence * 100) : null;
  const relabels = s?.relabels || [];
  const punches = (day?.punches || []).filter((x) => !x.rejected);
  const sched = day?.schedule || null;
  const res = insert ? resulting(s, sched) : null;
  const learned = s?.learnedNote || (s?.text || '').match(/Aprendido com sua[^.]*/)?.[0] || null;
  const slots = TYPES.map((t) => {
    const prop = s?.punches?.find((x) => x.type === t);
    if (prop) return <div key={t} className="slot prop"><span>{LABEL[t]}</span><b>{prop.time}*</b><i>proposta *</i></div>;
    const rel = relabels.find((r) => r.to === t);
    if (rel) return <div key={t} className="slot relab"><span>{LABEL[t]}</span><b>{rel.time}</b><i>totem: {LABEL[rel.from] || rel.from}</i></div>;
    const ex = punches.find((x) => x.type === t && !relabels.some((r) => r.punchId === x.id));
    if (ex) return <div key={t} className={`slot${ex.originalType !== ex.type ? ' relab' : ''}`}><span>{LABEL[t]}</span><b>{ex.time}{ex.manual ? '*' : ''}</b>{ex.originalType !== ex.type ? <i>totem: {LABEL[ex.originalType] || ex.originalType}</i> : null}</div>;
    return <div key={t} className="slot off"><span>{LABEL[t]}</span><b>—</b><i>{t === 'INTERVALO' || t === 'RETORNO' ? 'sem batida' : 'faltando'}</i></div>;
  });
  const acceptLabel = s?.kind === 'LAUNCH_REQUEST' ? 'Lançar na folha' : s?.kind === 'DIA_EXTRA' ? '✓ Lançar Dia extra' : '✓ Aceitar';
  const canAccept = Boolean(s && s.kind !== 'TEXT');
  return <article className={`sg ${cls}`}>
    <header><span className="av">{initials(name)}</span><div><h4>{shortName(name)}</h4><small>{dayLabel(p.date)}{sched ? ` · escala ${sched}` : ''}{p.dryRun && p.kind === 'AJUSTE_SUGERIDO' ? ' · modo teste' : ''}</small></div>
      {insert && conf != null ? <span className={`conf ${cls}`}><em style={{ ['--w' as any]: `${conf}%` }} />{p.level === 'ALTA' ? 'Alta' : p.level === 'MEDIA' ? 'Média' : 'Dúvida'} · {conf}%</span> : <span className={`conf ${KIND[p.kind]?.[1] || 'md'}`}>{KIND[p.kind]?.[0] || p.title}</span>}
    </header>
    {punches.length ? <div className="raw"><span className="k">Batidas originais</span>{punches.map((x) => <span key={x.id} className={`pc${relabels.some((r) => r.punchId === x.id) ? ' bad' : ''}`}>{x.time}{x.manual ? '*' : ''} <small>{LABEL[x.originalType] || x.originalType}</small></span>)}</div> : <div className="raw"><span className="k">Batidas originais</span><span className="pc"><small>nenhuma no dia</small></span></div>}
    {insert ? <div className="day">{slots}</div> : null}
    <p className="why">💡 {insert ? whyText(s) : `${p.title}. ${s?.text || p.detail}`}</p>
    {learned ? <p className="old">✦ <b>{learned.replace(/\.$/, '')}.</b></p> : null}
    {res ? <div className="res"><b>Dia resultante:</b> {fmtH(res.worked)} trabalhadas{res.lunch != null ? ` · almoço ${fmtH(res.lunch)}` : ''}{res.saldo != null ? <> · saldo <b>{fmtSaldo(res.saldo)}</b></> : null}</div> : null}
    <div className="acts">
      {canAccept ? <button type="button" className="ok" disabled={busy} onClick={onAccept}>{acceptLabel}</button> : null}
      <button type="button" className="adj" onClick={onAdjust}>✎ Ajustar</button>
      <button type="button" className="ign" disabled={busy} onClick={onIgnore}>Ignorar</button>
    </div>
  </article>;
}

export function SuggestionsPanel({ data, onAdjust, onChanged, limit }: { data: HojeData; onAdjust: (userId: string, date: string) => void; onChanged: () => void; limit?: number }) {
  const [filter, setFilter] = useState<'TODAS' | 'ALTA' | 'DUVIDA'>('TODAS');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [showAll, setShowAll] = useState(!limit);
  const rank: Record<string, number> = { ALTA: 0, MEDIA: 1, DUVIDA: 2, CONFERIR: 3 };
  const list = data.pendencias.filter((p) => filter === 'TODAS' || (filter === 'ALTA' ? p.level === 'ALTA' : p.level !== 'ALTA')).slice().sort((a, b) => rank[a.level] - rank[b.level] || b.date.localeCompare(a.date));
  const high = data.pendencias.filter((p) => p.level === 'ALTA' && p.suggestion?.kind === 'INSERT_PUNCHES');
  const shown = showAll ? list : list.slice(0, limit);

  async function patch(id: string, action: 'ACEITAR' | 'IGNORAR') {
    const r = await fetch('/api/admin/pendencias', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action }) });
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok, text: r.ok ? (d.resolution || 'Feito.') : (d.error || 'Não foi possível.') };
  }
  async function act(p: Pend, action: 'ACEITAR' | 'IGNORAR') {
    if (action === 'ACEITAR' && !window.confirm(`${shortName(p.employee?.name || '')} · ${dayLabel(p.date)}\n${p.suggestion?.resultingDay ? `Dia fica: ${p.suggestion.resultingDay}` : p.suggestion?.text || ''}\n\nAplicar agora? Batidas originais não são alteradas; ajuste com * e histórico.`)) return;
    setBusy(p.id); setMsg('');
    const r = await patch(p.id, action); setBusy(''); setMsg(r.text); onChanged();
  }
  async function acceptHigh() {
    if (!high.length || !window.confirm(`Aceitar as ${high.length} sugestões de alta confiança?\n\n${high.map((p) => `• ${shortName(p.employee?.name || '')} ${dayLabel(p.date)}: ${p.suggestion?.resultingDay || ''}`).join('\n')}\n\nBatidas originais não são alteradas.`)) return;
    setBusy('bulk'); setMsg('');
    let ok = 0; const fails: string[] = [];
    for (const p of high) { const r = await patch(p.id, 'ACEITAR'); if (r.ok) ok += 1; else fails.push(`${shortName(p.employee?.name || '')}: ${r.text}`); }
    setBusy(''); setMsg(`${ok} aceitas.${fails.length ? ` Não foi possível: ${fails.join('; ')}` : ''}`); onChanged();
  }

  return <section className="panel">
    <div className="ph"><h3>✦ Sugestões inteligentes</h3><span className="cnt">{data.openCount}</span><div className="r">{([['TODAS', 'Todas'], ['ALTA', 'Alta confiança'], ['DUVIDA', 'Dúvidas']] as const).map(([k, l]) => <button key={k} type="button" className={`tab${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)}>{l}</button>)}</div></div>
    {msg ? <div className="msg">{msg}</div> : null}
    {high.length && filter !== 'DUVIDA' ? <div className="bulk"><p><b>{high.length} {high.length === 1 ? 'sugestão' : 'sugestões'} de alta confiança</b> {high.length === 1 ? 'segue' : 'seguem'} a escala do dia e o padrão real da pessoa. Confira o dia resultante de cada uma e aceite.</p><button type="button" disabled={busy === 'bulk'} onClick={() => void acceptHigh()}>✓ Aceitar {high.length === 1 ? 'a de alta' : `as ${high.length} de alta`}</button></div> : null}
    {!list.length ? <p className="empty">Nada para revisar aqui. 🎉</p> : null}
    {shown.map((p) => <SuggestionCard key={p.id} p={p} day={data.pendDays[`${p.userId}|${p.date}`]} busy={busy === p.id || busy === 'bulk'} onAccept={() => void act(p, 'ACEITAR')} onIgnore={() => void act(p, 'IGNORAR')} onAdjust={() => onAdjust(p.userId, p.date)} />)}
    {!showAll && list.length > (limit || 0) ? <button type="button" className="more" onClick={() => setShowAll(true)}>Ver todas ({list.length})</button> : null}
    {data.autoClosed.length ? <p className="closed">✔ {data.autoClosed.length} {data.autoClosed.length === 1 ? 'sugestão antiga foi fechada sozinha' : 'sugestões antigas foram fechadas sozinhas'} nos últimos 7 dias: o dia já estava certo ({data.autoClosed.slice(0, 3).map((a) => `${shortName(a.name)} ${a.date.slice(8, 10)}/${a.date.slice(5, 7)}`).join(', ')}{data.autoClosed.length > 3 ? '…' : ''}).</p> : null}
    <div className="legend"><span><i style={{ background: 'var(--goldl)', border: '1.5px dashed var(--gold)' }} />proposta * (entra como ajuste)</span><span><i style={{ background: 'var(--gl)', border: '1px solid #9cc5a9' }} />rótulo entendido pelo sistema (batida original intacta)</span><span><i style={{ background: '#fafcfa', border: '1px solid var(--line)' }} />batida original</span></div>
  </section>;
}

type Row = { p: Person; status: string; cls: string; attention: boolean };
function personStatus(p: Person, nowMin: number): Row {
  const valid = p.punches.filter((x) => !x.rejected);
  const half = p.schedule?.mode === 'HALF';
  const last = valid[valid.length - 1];
  const relab = valid.find((x) => x.originalType !== x.type);
  const r = (status: string, cls: string, attention: boolean): Row => ({ p, status, cls, attention });
  if (p.punches.some((x) => x.rejected)) return r('Batida para revisar', 'r', true);
  if (p.absence) return r(last?.type === 'SAIDA' ? `Saiu ${last.time} · ausência aprovada` : 'Ausência aprovada', 'b', true);
  if (!valid.length) {
    if (!p.scheduled || !p.schedule) return r('Folga', 'm', false);
    return nowMin >= toMin(p.schedule.start) ? r('Sem registro', 'r', true) : r(`Entra às ${p.schedule.start}`, 'm', false);
  }
  if (!p.scheduled) return r('Fora da escala', 'y', true);
  if (relab) return r(`${relab.time} = ${LABEL[relab.type]} (totem: ${LABEL[relab.originalType] || relab.originalType})`, 'y', true);
  const hasLunch = valid.some((x) => x.type === 'INTERVALO' || x.type === 'RETORNO');
  const lunchDeadline = p.schedule?.lunchEnd ? toMin(p.schedule.lunchEnd) + 30 : 14 * 60;
  const span = (last?.type === 'SAIDA' ? toMin(last.time) : nowMin) - toMin(valid[0].time);
  if (!half && !hasLunch && span > 6 * 60 && nowMin >= lunchDeadline) return r('Almoço não batido', 'y', true);
  if (last.type === 'INTERVALO') return r(`No almoço desde ${last.time}`, 'g', false);
  if (last.type === 'SAIDA') return r(half ? `Meio período · saiu ${last.time}` : `Saiu ${last.time}`, 'g', false);
  return r(half ? 'Meio período' : 'Trabalhando', 'g', false);
}

function Timeline({ p, nowMin }: { p: Person; nowMin: number }) {
  const valid = p.punches.filter((x) => !x.rejected).map((x) => ({ ...x, m: toMin(x.time) }));
  const segs: { a: number; b: number; lunch?: boolean }[] = [];
  let open: number | null = null;
  for (const x of valid) {
    if (x.type === 'ENTRADA' || x.type === 'RETORNO') open = x.m;
    else if (open != null) { segs.push({ a: open, b: x.m }); open = null; if (x.type === 'INTERVALO') { const back = valid.find((y) => y.type === 'RETORNO' && y.m > x.m); if (!back) segs.push({ a: x.m, b: nowMin, lunch: true }); } }
  }
  if (open != null) segs.push({ a: open, b: Math.max(open + 5, nowMin) });
  return <div className="tl">
    {p.schedule ? <span className="sc" style={{ left: pct(toMin(p.schedule.start)), width: width(toMin(p.schedule.start), toMin(p.schedule.end)) }} /> : null}
    {segs.map((s, i) => <span key={i} className={`w${s.lunch ? ' l' : ''}`} style={{ left: pct(s.a), width: width(s.a, s.b) }} />)}
  </div>;
}

export function AttentionPanel({ data, onOpen }: { data: HojeData; onOpen: (userId: string) => void }) {
  const [mode, setMode] = useState<'ATENCAO' | 'TODOS'>('ATENCAO');
  const rows = useMemo(() => data.people.map((p) => personStatus(p, data.nowMin)), [data]);
  const todayRows = rows.filter((r) => r.p.scheduled || r.p.punches.length);
  const att = rows.filter((r) => r.attention);
  const order: Record<string, number> = { r: 0, y: 1, b: 2, g: 3, m: 4 };
  const list = (mode === 'ATENCAO' ? att : todayRows).slice().sort((a, b) => order[a.cls] - order[b.cls] || a.p.name.localeCompare(b.p.name, 'pt-BR'));
  return <section className="panel">
    <div className="ph"><h3>Hoje, quem precisa de atenção</h3><div className="r"><button type="button" className={`tab${mode === 'ATENCAO' ? ' on' : ''}`} onClick={() => setMode('ATENCAO')}>Atenção {att.length}</button><button type="button" className={`tab${mode === 'TODOS' ? ' on' : ''}`} onClick={() => setMode('TODOS')}>Todos {todayRows.length}</button></div></div>
    {!list.length ? <p className="empty">Ninguém precisa de atenção agora. 🎉</p> : <table><thead><tr><th>Pessoa</th><th className="hide-m">Escala</th><th>Dia (06h–18h)</th><th>Situação</th></tr></thead><tbody>
      {list.map(({ p, status, cls }) => <tr key={p.id} onClick={() => onOpen(p.id)} style={{ cursor: 'pointer' }} title="Abrir o dia no Ponto">
        <td><b>{shortName(p.name)}</b><br /><small>{p.jobTitle ? cap(p.jobTitle.toLowerCase()) : '—'}</small></td>
        <td className="hide-m">{p.schedule ? `${p.schedule.start}–${p.schedule.end}` : 'folga'}</td>
        <td><Timeline p={p} nowMin={data.nowMin} /></td>
        <td><span className={`st ${cls}`}>{status}</span></td>
      </tr>)}
    </tbody></table>}
  </section>;
}

const PontinhoFace = ({ size = 30 }: { size?: number }) => <svg width={size} height={Math.round(size * 32 / 30)} viewBox="0 0 120 130" aria-hidden="true">
  <line x1="60" y1="6" x2="60" y2="20" stroke="#0b5c42" strokeWidth="4" strokeLinecap="round" /><circle cx="60" cy="6" r="6" fill="#c9a227" />
  <rect x="8" y="50" width="12" height="26" rx="6" fill="#0b5c42" /><rect x="100" y="44" width="12" height="26" rx="6" fill="#0b5c42" transform="rotate(-25 106 57)" />
  <rect x="30" y="92" width="60" height="30" rx="12" fill="#0b5c42" /><rect x="48" y="100" width="24" height="12" rx="4" fill="#c9a227" />
  <circle cx="60" cy="60" r="42" fill="#fff" stroke="#0b5c42" strokeWidth="7" />
  <g stroke="#9cc5a9" strokeWidth="3" strokeLinecap="round"><line x1="60" y1="24" x2="60" y2="30" /><line x1="60" y1="90" x2="60" y2="96" /><line x1="24" y1="60" x2="30" y2="60" /><line x1="90" y1="60" x2="96" y2="60" /></g>
  <ellipse cx="46" cy="54" rx="6" ry="8" fill="#143d1f" /><ellipse cx="74" cy="54" rx="6" ry="8" fill="#143d1f" />
  <circle cx="48" cy="51" r="2" fill="#fff" /><circle cx="76" cy="51" r="2" fill="#fff" />
  <circle cx="36" cy="68" r="5" fill="#f4b6a6" opacity=".8" /><circle cx="84" cy="68" r="5" fill="#f4b6a6" opacity=".8" />
  <path d="M48 72 Q60 82 72 72" stroke="#143d1f" strokeWidth="4" fill="none" strokeLinecap="round" />
  <line x1="60" y1="60" x2="60" y2="36" stroke="#c9a227" strokeWidth="3" strokeLinecap="round" opacity=".55" /><line x1="60" y1="60" x2="78" y2="62" stroke="#c9a227" strokeWidth="3" strokeLinecap="round" opacity=".55" />
</svg>;

function PontinhoPaused({ data, go }: { data: HojeData; go: (tab: string) => void }) {
  const lunch = data.people.filter((p) => p.lastType === 'INTERVALO').length;
  const abs = data.absences.length;
  return <section className="chat">
    <div className="ch"><PontinhoFace /><div><b>Pontinho</b><small><span className="on" />pausado · sem custo de IA</small></div></div>
    <div className="msgs">
      <div className="m a">Estou pausado para não gerar custo. Enquanto isso, o resumo de agora:<br />• <b>{lunch ? `${lunch} no almoço` : 'Ninguém no almoço'}</b> neste momento.<br />• <b>{data.openCount} sugestões</b> esperando você (o mesmo número do sino).<br />• <b>{abs} {abs === 1 ? 'ausência' : 'ausências'}</b> na semana.</div>
    </div>
    <div className="qs"><button type="button" onClick={() => go('sugestoes')}>Ver sugestões</button><button type="button" onClick={() => go('ausencias')}>Ausências da semana</button><button type="button" onClick={() => go('folha')}>Gerar folha de {data.closing.monthLabel}</button></div>
    <div className="inp"><div>Pontinho pausado (sem custo)</div><button type="button" disabled aria-label="Enviar">➤</button></div>
  </section>;
}

function AbsencesPanel({ data, onChanged, go }: { data: HojeData; onChanged: () => void; go: (tab: string) => void }) {
  const [busy, setBusy] = useState(''); const [msg, setMsg] = useState('');
  async function decide(a: Absence, decision: 'APROVAR' | 'REJEITAR') {
    if (decision === 'REJEITAR' && !window.confirm(`Recusar o pedido de ${shortName(a.name)} (${a.reason})?`)) return;
    setBusy(a.id); setMsg('');
    const r = await fetch('/api/admin/requests', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: a.id, decision, reviewNote: null }) });
    const d = await r.json().catch(() => ({})); setBusy('');
    setMsg(r.ok ? (d.message || 'Feito.') : (d.error || 'Não foi possível.')); onChanged();
  }
  const f = data.week.from, t = data.week.to;
  return <section className="panel">
    <div className="ph"><h3>📅 Ausências da semana</h3><small style={{ color: 'var(--mut)' }}>{f.slice(8, 10)}–{t.slice(8, 10)}/{t.slice(5, 7)}</small></div>
    {msg ? <div className="msg">{msg}</div> : null}
    {!data.absences.length ? <p className="empty">Nenhuma ausência marcada nesta semana.</p> : null}
    {data.absences.map((a) => <div className="ab" key={a.id}>
      <div className="d"><small>{WD[new Date(`${a.start}T12:00:00Z`).getUTCDay()]}</small><b>{a.start.slice(8, 10)}</b></div>
      <p><b>{shortName(a.name)}</b>{a.classification && PERIOD[a.classification] ? ` · ${PERIOD[a.classification]}` : ''}<br /><small>{isMedical(a) ? '🩺 ' : ''}{a.reason}{a.end !== a.start ? ` · até ${a.end.slice(8, 10)}/${a.end.slice(5, 7)}` : ''}{a.status === 'APROVADO' ? (a.launched ? ' · lançado na folha' : ' · ainda não lançado na folha') : ''}</small></p>
      {a.status === 'APROVADO' ? <span className="st g">Aprovado</span> : <div className="mini"><button type="button" className="ok" disabled={busy === a.id} onClick={() => void decide(a, 'APROVAR')}>Aprovar</button><button type="button" disabled={busy === a.id} onClick={() => void decide(a, 'REJEITAR')}>Recusar</button></div>}
    </div>)}
    <div className="mail">📄 Aprovar não lança na folha: o lançamento continua sendo seu, em <u style={{ cursor: 'pointer' }} onClick={() => go('ausencias')}>Ausências</u>.</div>
  </section>;
}

export function useHojeData(enabled: boolean) {
  const [data, setData] = useState<HojeData | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/hoje', { cache: 'no-store' });
      if (!r.ok) { setError('Não foi possível carregar o painel agora.'); return; }
      setData(await r.json()); setError('');
    } catch { setError('Sem conexão com o servidor.'); }
  }, []);
  useEffect(() => {
    if (!enabled) return;
    void load();
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 60_000);
    return () => window.clearInterval(t);
  }, [enabled, load]);
  return { data, error, reload: load };
}

export default function HojeV2({ data, error, reload, onAdjust, onOpenPerson, go, onOpenAtestado, onOpenFolha }: { data: HojeData | null; error: string; reload: () => void; onAdjust: (userId: string, date: string) => void; onOpenPerson: (userId: string) => void; go: (tab: string) => void; onOpenAtestado: (userId: string, date: string) => void; onOpenFolha: (userId?: string) => void }) {
  const [drawer, setDrawer] = useState<DrawerKey | null>(null);
  if (!data) return <div className="pvh"><div className="panel">{error || 'Carregando o dia…'}</div></div>;
  const people = data.people;
  const groups = kpiGroups(people, data.nowMin);
  const { today, working, inLunch, left, leftHalf, leftAbs, noRecord } = groups;
  const { alta, media, conferir } = pendenciaCounts(data.pendencias);
  const open = (k: DrawerKey) => setDrawer(k);
  return <div className="pvh">
    <div className="smart"><PontinhoFace /><p><b>Classificação inteligente ligada.</b> Cada batida é lida pela <b>escala do dia</b> e pelo <b>padrão real da pessoa (até 90 dias)</b> — nunca só pela ordem. A batida original nunca é alterada (Portaria 671): o sistema só propõe o rótulo e os ajustes *.</p>{data.late14 > 0 ? <button type="button" className="tag btn" onClick={() => open('late14')}>“Retorno 14:00” recalculadas · {data.late14} {data.late14 === 1 ? 'restante' : 'restantes'}</button> : <span className="tag">“Retorno 14:00” recalculadas · 0 restantes</span>}</div>
    {error ? <div className="msg">{error}</div> : null}
    <section className="kpis">
      <button type="button" className={`kpi${drawer === 'trabalhando' ? ' open' : ''}`} onClick={() => open('trabalhando')}><small>Trabalhando agora</small><b>{working.length} / {today.length}</b><span>{inLunch.length ? `${inLunch.length} no almoço agora` : data.nowMin >= 13 * 60 ? 'todos já voltaram do almoço' : 'ninguém no almoço agora'}</span><i className="go" aria-hidden="true">›</i></button>
      <button type="button" className={`kpi${drawer === 'sairam' ? ' open' : ''}`} onClick={() => open('sairam')}><small>Já saíram</small><b>{left.length}</b><span>{leftHalf.length} meio período · {leftAbs.length} ausência aprovada</span><i className="go" aria-hidden="true">›</i></button>
      <button type="button" className={`kpi warn${drawer === 'sem-registro' ? ' open' : ''}`} onClick={() => open('sem-registro')}><small>Sem registro hoje</small><b>{noRecord.length}</b><span>{noRecord.length ? noRecord.slice(0, 3).map((p) => shortName(p.name)).join(' · ') + (noRecord.length > 3 ? ` +${noRecord.length - 3}` : '') : 'todos bateram'}</span><i className="go" aria-hidden="true">›</i></button>
      <button type="button" className={`kpi gold${drawer === 'sugestoes' ? ' open' : ''}`} onClick={() => open('sugestoes')}><small>Sugestões para revisar</small><b>{data.openCount}</b><span>{alta} alta · {media} média · {conferir} para conferir</span><i className="go" aria-hidden="true">›</i></button>
      <button type="button" className={`kpi${drawer === 'fechamento' ? ' open' : ''}`} onClick={() => open('fechamento')}><small>Fechamento de {data.closing.monthLabel}</small><b>{data.closing.businessDays} {data.closing.businessDays === 1 ? 'dia útil' : 'dias úteis'}</b><span>folha fecha em {data.closing.lastDay.slice(8, 10)}/{data.closing.lastDay.slice(5, 7)}</span><i className="go" aria-hidden="true">›</i></button>
    </section>
    <div className="grid"><div>
      <SuggestionsPanel data={data} onAdjust={onAdjust} onChanged={reload} limit={5} />
      <AttentionPanel data={data} onOpen={onOpenPerson} />
    </div><div>
      <PontinhoPaused data={data} go={go} />
      <AbsencesPanel data={data} onChanged={reload} go={go} />
    </div></div>
    <HojeKpiDrawers data={data} open={drawer} late14Only={drawer === 'late14'} onClose={() => setDrawer(null)} onOpenDay={(userId, date) => { setDrawer(null); onAdjust(userId, date); }} onOpenAtestado={(userId, date) => { setDrawer(null); onOpenAtestado(userId, date); }} onOpenFolha={(userId) => { setDrawer(null); onOpenFolha(userId); }} onChanged={reload} />
  </div>;
}
