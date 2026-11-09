'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { label as typeLabel, roundLunchTime } from '../../lib/day-guards';
import './employee-day.css';

type Emp = { id: string; name: string; employeeNumber: string | null; active?: boolean };
type DayPunch = { id: string; type: string; timestamp: string; status: string; origin: string; manual: boolean; hasPhoto: boolean };
type DayCert = { id: string; type: string; startDate: string; endDate: string; startTime: string | null; endTime: string | null; status: string; observation: string | null; documentName: string | null; cancelReason: string | null };
type DayReq = { id: string; type: string; status: string; reason: string; details: string | null; launchedAt: string | null; documentName: string | null };
type DayData = {
  employee: Emp; date: string; weekday: string; scheduled: boolean; schedule: { start: string; end: string } | null;
  weekSchedule: { code: string; scheduled: boolean; start: string | null; end: string | null }[];
  punches: DayPunch[]; certificates: DayCert[]; requests: DayReq[]; warnings: string[];
  ocorrencias?: { id: string; kind: string; source: string; detail: string; status: string; cancelReason: string | null }[];
  monthOcorrencias?: number;
  adjustments?: { id: string; punchId: string; type: string; time: string; status: string; reason: string }[];
  punchWarnings?: { id: string; message: string; shownCount: number; firstShownAt: string | null; lastShownAt: string | null; ackAt: string | null }[];
  pendencias?: { id: string; kind: string; title: string; detail: string; status: string; resolution: string | null; dryRun: boolean }[];
};
const dt = (v: string | null) => v ? new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
type Conflict = { body: Record<string, unknown>; overlaps: { id: string; type: string; startTime: string | null; endTime: string | null }[]; message: string };

const CERT_LABEL: Record<string, string> = { DIA_INTEGRAL: 'Atestado dia inteiro', PERIODO_DIAS: 'Atestado (período)', HORAS: 'Declaração por horas', PERIODO_HORAS: 'Declaração por horas', CONSULTA_MEDICA: 'Consulta médica', SAIDA_MEDICA: 'Saída médica', TRABALHO_EXTERNO: 'Trabalho/Evento externo', TRABALHO_EXTERNO_HORAS: 'Trabalho externo (horas)', OUTRO: 'Abono', DIA_EXTRA: 'Dia extra (fora da escala)' };
const ACTIVE = ['ATIVO', 'APROVADO'];
const clock = (v: string) => new Date(v).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const hm = (v: string) => clock(v).slice(0, 5);
const todayKey = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const fmtDay = (d: string, wd: string) => `${wd.toLowerCase()} ${d.slice(8, 10)}/${d.slice(5, 7)}`;

export default function EmployeeDayPanel({ employees, focus }: { employees: Emp[]; focus?: { userId: string; date: string; nonce: number } | null }) {
  const list = useMemo(() => [...employees].filter((e) => e.active !== false).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')), [employees]);
  const [userId, setUserId] = useState('');
  const [date, setDate] = useState(todayKey());
  const [data, setData] = useState<DayData | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'red' | 'amb'; text: string } | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [replaceMode, setReplaceMode] = useState(false);
  const [removing, setRemoving] = useState<{ kind: 'cert' | 'req'; id: string; title: string } | null>(null);
  const [removeReason, setRemoveReason] = useState('');
  const [hFrom, setHFrom] = useState('');
  const [hTo, setHTo] = useState('');
  const [obs, setObs] = useState('');
  const [newPunch, setNewPunch] = useState({ type: 'SAIDA', time: '', reason: '' });
  useEffect(() => { if (focus?.userId && focus.date) { setUserId(focus.userId); setDate(focus.date); } }, [focus?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    if (!userId || !date) { setData(null); return; }
    setBusy(true);
    const res = await fetch(`/api/admin/employee-day?userId=${encodeURIComponent(userId)}&date=${date}`, { cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setMsg({ tone: 'red', text: json.error || 'Não foi possível carregar o dia.' }); setData(null); return; }
    setData(json);
    const valid = (json.punches as DayPunch[]).filter((p) => p.status === 'VALID');
    setHFrom(valid.length ? hm(valid[valid.length - 1].timestamp) : (json.schedule?.start || ''));
    setHTo(json.schedule?.end || '');
  }, [userId, date]);
  useEffect(() => { setConflict(null); setRemoving(null); setReplaceMode(false); void load(); }, [load]);

  const activeCerts = (data?.certificates || []).filter((c) => ACTIVE.includes(c.status));
  const valid = (data?.punches || []).filter((p) => p.status === 'VALID');
  const hasExtra = activeCerts.some((c) => c.type === 'DIA_EXTRA');

  async function markExtra() {
    if (!data) return;
    const reason = window.prompt('Contar este dia como trabalhado fora da escala (as batidas reais viram horas trabalhadas). Motivo:', 'Dia trabalhado fora da escala');
    if (reason === null) return;
    if (reason.trim().length < 5) { setMsg({ tone: 'amb', text: 'Informe o motivo (mínimo 5 letras).' }); return; }
    if (!window.confirm(`Confirmar dia extra para ${data.employee.name} em ${data.date.split('-').reverse().join('/')}? A escala da ficha não muda e as batidas não são alteradas.`)) return;
    await createEntry({ type: 'DIA_EXTRA', observation: reason.trim() }, 'Dia extra (fora da escala)');
  }

  async function createEntry(body: Record<string, unknown>, okText: string) {
    if (!data) return;
    const full: Record<string, unknown> = { userId: data.employee.id, startDate: data.date, ...body };
    if (replaceMode && activeCerts.length) {
      if (!window.confirm(`Substituir: cancelar ${activeCerts.length} lançamento(s) do dia e criar "${okText}"? O histórico fica guardado.`)) return;
      full.replaceIds = activeCerts.map((c) => c.id);
      full.replaceReason = `Substituído por: ${okText}`;
    }
    setBusy(true); setMsg(null);
    const res = await fetch('/api/admin/certificates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(full) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.status === 409 && json.canReplace) { setConflict({ body: full, overlaps: json.overlaps || [], message: json.error }); return; }
    if (!res.ok) { setMsg({ tone: 'red', text: json.error || 'Não foi possível lançar.' }); return; }
    setConflict(null); setReplaceMode(false); setObs('');
    setMsg({ tone: 'ok', text: `${okText} lançado.` });
    await load();
  }

  async function substituteNow() {
    if (!conflict) return;
    if (!window.confirm('Cancelar o(s) lançamento(s) que se sobrepõem e criar o novo em um passo? O histórico fica guardado.')) return;
    const body = { ...conflict.body, replaceIds: conflict.overlaps.map((o) => o.id), replaceReason: 'Substituído no Dia do colaborador' };
    setBusy(true);
    const res = await fetch('/api/admin/certificates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setMsg({ tone: 'red', text: json.error || 'Não foi possível substituir.' }); return; }
    setConflict(null); setMsg({ tone: 'ok', text: 'Substituído. O lançamento anterior ficou como cancelado.' });
    await load();
  }

  async function confirmRemove() {
    if (!removing) return;
    if (removeReason.trim().length < 5) { setMsg({ tone: 'amb', text: 'Informe o motivo (mínimo 5 letras).' }); return; }
    setBusy(true);
    const res = removing.kind === 'cert'
      ? await fetch('/api/admin/certificates', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: removing.id, action: 'cancel', reason: removeReason.trim() }) })
      : await fetch('/api/admin/requests', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: removing.id, action: 'RETIRAR_DA_FOLHA' }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setMsg({ tone: 'red', text: json.error || 'Não foi possível remover.' }); return; }
    setRemoving(null); setRemoveReason('');
    setMsg({ tone: 'ok', text: 'Removido. O lançamento fica como cancelado com motivo, autor e data.' });
    await load();
  }

  async function launchRequest(id: string) {
    setBusy(true);
    const res = await fetch('/api/admin/requests', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action: 'LANCAR' }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    setMsg(res.ok ? { tone: 'ok', text: 'Solicitação lançada na folha.' } : { tone: 'red', text: json.error || 'Não foi possível lançar.' });
    if (res.ok) await load();
  }

  async function undoAuto(adjustmentId: string) {
    const reason = window.prompt('Desfazer o ajuste automático (*). A batida ajustada fica cancelada com histórico. Motivo:');
    if (!reason || reason.trim().length < 5) return;
    setBusy(true);
    const res = await fetch('/api/admin/auto-close', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'undo', adjustmentId, reason: reason.trim() }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    setMsg(res.ok ? { tone: 'ok', text: 'Ajuste automático desfeito (registro guardado).' } : { tone: 'red', text: json.error || 'Não foi possível desfazer.' });
    if (res.ok) await load();
  }

  async function cancelOcorrencia(id: string) {
    const reason = window.prompt('Retirar esta ocorrência do colaborador. Motivo:');
    if (!reason || reason.trim().length < 5) return;
    setBusy(true);
    const res = await fetch('/api/admin/ocorrencias', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, reason: reason.trim() }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    setMsg(res.ok ? { tone: 'ok', text: 'Ocorrência retirada (fica no histórico).' } : { tone: 'red', text: json.error || 'Não foi possível retirar.' });
    if (res.ok) await load();
  }

  async function changeType(p: DayPunch, type: string) {
    if (type === p.type) return;
    const reason = window.prompt(`Motivo para mudar ${typeLabel(p.type)} → ${typeLabel(type)} (${clock(p.timestamp)}). O horário e os segundos são mantidos:`);
    if (!reason || reason.trim().length < 5) return;
    setBusy(true);
    const res = await fetch(`/api/admin/punches/${p.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, reason: reason.trim() }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    setMsg(res.ok ? { tone: 'ok', text: `Tipo alterado. Horário mantido: ${clock(p.timestamp)} (segundos preservados).` } : { tone: 'red', text: json.error || 'Não foi possível mudar o tipo.' });
    if (res.ok) await load();
  }

  async function cancelPunch(p: DayPunch) {
    const reason = window.prompt(`Motivo para cancelar a batida ${typeLabel(p.type)} ${clock(p.timestamp)}${p.manual ? '*' : ''}:`);
    if (!reason || reason.trim().length < 5) return;
    setBusy(true);
    const res = await fetch(`/api/admin/punches/${p.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: reason.trim() }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    setMsg(res.ok ? { tone: 'ok', text: 'Batida cancelada (registro preservado).' } : { tone: 'red', text: json.error || 'Não foi possível cancelar.' });
    if (res.ok) await load();
  }

  async function addPunch() {
    if (!data) return;
    let time = newPunch.time;
    if (!/^\d{2}:\d{2}$/.test(time)) { setMsg({ tone: 'amb', text: 'Informe o horário (HH:MM).' }); return; }
    if (newPunch.type === 'INTERVALO' || newPunch.type === 'RETORNO') time = roundLunchTime(time);
    if (newPunch.reason.trim().length < 5) { setMsg({ tone: 'amb', text: 'Informe o motivo (mínimo 5 letras).' }); return; }
    setBusy(true);
    const res = await fetch('/api/admin/punches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: data.employee.id, date: data.date, time, type: newPunch.type, reason: newPunch.reason.trim() }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setMsg({ tone: 'red', text: json.error || 'Não foi possível lançar a batida.' }); return; }
    setNewPunch({ type: 'SAIDA', time: '', reason: '' });
    setMsg({ tone: 'ok', text: `Ajuste ${typeLabel(newPunch.type)} ${time}* lançado (batidas originais não são alteradas).` });
    await load();
  }

  const scheduledDays = data?.weekSchedule.filter((d) => d.scheduled).map((d) => d.code).join(', ') || '—';

  return <section className="card">
    <span className="eyebrow">ERRO ZERO</span>
    <h2>Dia do colaborador</h2>
    <p className="small-muted">Escolha a pessoa e o dia: batidas com foto, abonos ativos e ações rápidas. Nada vai para a folha sem você lançar.</p>
    <div className="dc-pick">
      <label>Colaborador<select value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">Selecione…</option>{list.map((e) => <option key={e.id} value={e.id}>{e.name}{e.employeeNumber ? ` · ${e.employeeNumber}` : ''}</option>)}</select></label>
      <label>Dia<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <button className="dc-btn o" type="button" disabled={!userId || busy} onClick={() => void load()}>Atualizar</button>
    </div>
    {msg ? <div className={`dc-w dc-${msg.tone}`} role="status">{msg.text}</div> : null}
    {data ? <div className="dc-wrap">
      <div className="dc-card">
        <h2>{data.employee.name.split(' ')[0]} — {fmtDay(data.date, data.weekday)}</h2>
        <div className="dc-sub">{data.scheduled && data.schedule ? `Escala ${data.weekday} ${data.schedule.start}–${data.schedule.end}` : `Folga na ficha (trabalha: ${scheduledDays})`}</div>
        <h3>Escala da ficha</h3>
        <div className="dc-sched">{data.weekSchedule.filter((d) => d.code !== 'DOM').map((d) => <div key={d.code} className={`dc-d${d.scheduled ? ' on' : ''}${d.code === data.weekday ? ' hl' : ''}`}>{d.code}{d.scheduled && d.start ? ` ${d.start.slice(0, 5)}–${d.end?.slice(0, 5)}` : ''}</div>)}</div>
        {!data.scheduled && !hasExtra ? <div className="dc-w dc-amb">⚠ Dia fora da escala ({scheduledDays}). Contar como:<span className="dc-right"><button className="dc-btn g sm" type="button" disabled={busy} onClick={() => void createEntry({ type: 'TRABALHO_EXTERNO', observation: 'Passeio da escola' }, 'Passeio')}>Passeio</button><button className="dc-btn o sm" type="button" disabled={busy} onClick={() => void markExtra()}>Extra</button></span></div> : null}
        <h3>Batidas do dia (com foto)</h3>
        {!data.punches.length ? <div className="dc-p">Nenhuma batida neste dia.</div> : null}
        {data.punches.map((p) => <div key={p.id} className={`dc-p${p.status !== 'VALID' ? ' x' : ''}`}>
          {p.hasPhoto ? <a href={`/api/admin/punches/${p.id}/photo`} target="_blank" rel="noreferrer"><img className="dc-ph" src={`/api/admin/punches/${p.id}/photo`} alt="foto da batida" loading="lazy" /></a> : <div className="dc-ph none" />}
          <span className="dc-t">{clock(p.timestamp)} · {typeLabel(p.type)}{p.manual ? '*' : ''}{p.status !== 'VALID' ? ' (cancelada)' : ''}</span>
          {p.hasPhoto ? <span className="dc-chip">foto</span> : null}
          {p.status === 'VALID' ? <span className="dc-right">
            <select aria-label="Mudar tipo" value={p.type} disabled={busy} onChange={(e) => void changeType(p, e.target.value)} style={{ width: 'auto' }}>{['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA'].map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}</select>
            <button className="dc-btn r sm" type="button" disabled={busy} onClick={() => void cancelPunch(p)}>Cancelar</button>
          </span> : null}
        </div>)}
        {data.warnings.map((w) => <div key={w} className="dc-w dc-red">✖ {w}</div>)}
        {(data.adjustments || []).map((a) => <div key={a.id} className={`dc-w ${a.status === 'ACTIVE' ? 'dc-amb' : ''}`}>🤖 {a.reason}: {typeLabel(a.type)} {a.time}*{a.status !== 'ACTIVE' ? ' (desfeito)' : ''}{a.status === 'ACTIVE' ? <button className="dc-btn r sm dc-right" type="button" disabled={busy} onClick={() => void undoAuto(a.id)}>↩ Desfazer</button> : null}</div>)}
        <h3>Ocorrências · {data.monthOcorrencias ?? 0} no mês</h3>
        {!(data.ocorrencias || []).length ? <div className="dc-p">Nenhuma ocorrência neste dia.</div> : null}
        {(data.ocorrencias || []).map((o) => <div key={o.id} className={`dc-p${o.status !== 'ATIVA' ? ' x' : ''}`}>
          <span className="dc-t">📌 Esqueceu de bater · {o.detail}{o.status !== 'ATIVA' ? ` (retirada: ${o.cancelReason || ''})` : ''}</span>
          {o.status === 'ATIVA' ? <button className="dc-btn o sm dc-right" type="button" disabled={busy} onClick={() => void cancelOcorrencia(o.id)}>Retirar</button> : null}
        </div>)}
        {(data.punchWarnings || []).map((w) => <div key={w.id} className={`dc-w ${w.ackAt ? 'dc-ok' : 'dc-amb'}`}>🔔 Aviso no ponto: “{w.message}” · mostrado {w.shownCount}x (1ª {dt(w.firstShownAt)}) · {w.ackAt ? `Ciente em ${dt(w.ackAt)}` : 'ainda sem Ciente'}</div>)}
        {(data.pendencias || []).map((x) => <div key={x.id} className="dc-p"><span className="dc-t">🔔 Pendência 17:20: {x.title} · {x.status === 'OPEN' ? 'aberta' : x.status === 'IGNORED' ? 'ignorada' : `resolvida${x.resolution ? ` (${x.resolution})` : ''}`}</span></div>)}
        <h3>Ajuste de batida *</h3>
        <div className="dc-row">
          <div><label>Tipo</label><select value={newPunch.type} onChange={(e) => setNewPunch({ ...newPunch, type: e.target.value })}>{['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA'].map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}</select></div>
          <div><label>Horário{newPunch.type === 'INTERVALO' || newPunch.type === 'RETORNO' ? ' (almoço: redondo)' : ''}</label><input type="time" value={newPunch.time} onChange={(e) => setNewPunch({ ...newPunch, time: e.target.value })} /></div>
        </div>
        {(newPunch.type === 'INTERVALO' || newPunch.type === 'RETORNO') && newPunch.time && roundLunchTime(newPunch.time) !== newPunch.time ? <div className="dc-w dc-amb">Almoço será lançado em horário redondo: {roundLunchTime(newPunch.time)}*</div> : null}
        <label>Motivo</label><input value={newPunch.reason} onChange={(e) => setNewPunch({ ...newPunch, reason: e.target.value })} placeholder="Ex.: esqueceu de bater a saída" />
        <div style={{ marginTop: 8 }}><button className="dc-btn o" type="button" disabled={busy} onClick={() => void addPunch()}>Lançar ajuste *</button></div>
      </div>

      <div className="dc-card">
        <h2>Atestados / declarações / solicitações</h2>
        <div className="dc-sub">Só conta na folha o que estiver ativo aqui.</div>
        <h3>Lançamentos do dia</h3>
        {!data.certificates.length && !data.requests.length ? <div className="dc-p">Nenhum lançamento neste dia.</div> : null}
        {data.certificates.map((c) => <div key={c.id} className={`dc-p${ACTIVE.includes(c.status) ? '' : ' x'}`}>
          <span className="dc-t">📄 {CERT_LABEL[c.type] || c.type}{c.startTime && c.endTime ? ` ${c.startTime.slice(0, 5)}–${c.endTime.slice(0, 5)}` : ' · dia'}{c.observation ? ` · ${c.observation}` : ''}</span>
          {c.documentName ? <span className="dc-chip">documento</span> : <span className="dc-chip warn">sem documento</span>}
          {!ACTIVE.includes(c.status) ? <span className="small-muted">cancelado{c.cancelReason ? `: ${c.cancelReason}` : ''}</span> : <button className="dc-btn r sm dc-right" type="button" onClick={() => { setRemoving({ kind: 'cert', id: c.id, title: CERT_LABEL[c.type] || c.type }); setRemoveReason(''); }}>Remover</button>}
          {ACTIVE.includes(c.status) && c.endTime && data.schedule && c.endTime.slice(0, 5) > data.schedule.end.slice(0, 5) ? <div className="dc-w dc-amb" style={{ width: '100%' }}>⚠ Fora do expediente (escala termina {data.schedule.end.slice(0, 5)})</div> : null}
        </div>)}
        {data.requests.map((r) => <div key={r.id} className="dc-p">
          <span className="dc-t">📱 App: {r.reason} · {r.status === 'PENDENTE' ? 'pendente' : r.launchedAt ? 'lançada na folha' : 'aprovada, fora da folha'}</span>
          {r.status === 'APROVADO' && ['AUSENCIA', 'TROCA_DIA'].includes(r.type) ? (r.launchedAt
            ? <button className="dc-btn r sm dc-right" type="button" onClick={() => { setRemoving({ kind: 'req', id: r.id, title: `Solicitação: ${r.reason}` }); setRemoveReason(''); }}>Retirar da folha</button>
            : <button className="dc-btn sm dc-right" type="button" disabled={busy} onClick={() => void launchRequest(r.id)}>Lançar na folha</button>) : null}
        </div>)}
        <h3>Ações rápidas</h3>
        {replaceMode ? <div className="dc-w dc-amb">⇄ Modo Substituir: a próxima ação cancela os {activeCerts.length} lançamento(s) ativos do dia e cria o novo.<button className="dc-btn o sm" type="button" onClick={() => setReplaceMode(false)}>Sair</button></div> : null}
        <div className="dc-acts">
          <button className="dc-btn" type="button" disabled={busy} onClick={() => void createEntry({ type: 'DIA_INTEGRAL', observation: obs || null }, 'Atestado dia inteiro')}>🩺 Atestado dia inteiro</button>
          <button className="dc-btn o" type="button" disabled={busy} onClick={() => void createEntry({ type: 'HORAS', startTime: hFrom, endTime: hTo, observation: obs || null }, `Declaração ${hFrom}–${hTo}`)}>⏱ Declaração por horas</button>
          <button className="dc-btn o" type="button" disabled={busy} onClick={() => void createEntry({ type: 'TRABALHO_EXTERNO', observation: obs || 'Trabalho/Evento externo' }, 'Trabalho/Evento externo')}>🏢 Trabalho/Evento externo</button>
          <button className="dc-btn o" type="button" disabled={busy} onClick={() => void createEntry({ type: 'TRABALHO_EXTERNO', observation: obs || 'Passeio da escola' }, 'Passeio da escola')}>🚌 Passeio da escola</button>
          <button className="dc-btn r" type="button" disabled={busy || !activeCerts.length} onClick={() => { const c = activeCerts[0]; if (c) { setRemoving({ kind: 'cert', id: c.id, title: CERT_LABEL[c.type] || c.type }); setRemoveReason(''); } }}>↩ Remover abono/atestado</button>
          <button className="dc-btn g" type="button" disabled={busy || !activeCerts.length} onClick={() => setReplaceMode((v) => !v)}>⇄ Substituir</button>
        </div>
        <h3>Declaração por horas</h3>
        <div className="dc-row"><div><label>De (última batida)</label><input type="time" value={hFrom} onChange={(e) => setHFrom(e.target.value)} /></div><div><label>Até (fim da escala)</label><input type="time" value={hTo} onChange={(e) => setHTo(e.target.value)} /></div></div>
        <label>Observação (opcional)</label><input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: acompanhamento filho, Bioparque…" />
        {conflict ? <div className="dc-w dc-red">✖ {conflict.message} ({conflict.overlaps.map((o) => `${CERT_LABEL[o.type] || o.type}${o.startTime ? ` ${o.startTime.slice(0, 5)}–${o.endTime?.slice(0, 5)}` : ''}`).join(', ')})<button className="dc-btn g sm" type="button" disabled={busy} onClick={() => void substituteNow()}>Substituir em 1 passo</button></div> : null}
      </div>

      <div className="dc-card">
        <h2>Remover abono</h2>
        <div className="dc-sub">Um clique · registro preservado no histórico</div>
        {removing ? <>
          <h3>{removing.title}</h3>
          <label>Motivo (obrigatório)</label>
          <input value={removeReason} onChange={(e) => setRemoveReason(e.target.value)} placeholder="Ex.: saiu antes por vontade própria — sem atestado" />
          <div className="dc-w dc-ok">✔ O lançamento fica como &quot;cancelado&quot; com motivo, autor e data</div>
          <div className="dc-row"><button className="dc-btn r" type="button" disabled={busy} onClick={() => void confirmRemove()} style={{ flex: 1 }}>Confirmar remoção</button><button className="dc-btn o" type="button" onClick={() => setRemoving(null)}>Voltar</button></div>
        </> : <div className="dc-p">Clique em &quot;Remover&quot; num lançamento para tirá-lo da folha.</div>}
        <h3>Proteções erro zero</h3>
        {['Sobreposição → oferece Substituir', 'Batida duplicada (mesmo tipo < 2 min)', 'Sequência de tipos (Saída antes de Intervalo)', 'Dia fora da escala → Extra ou Passeio', 'Trocar tipo mantém os segundos', 'Batida original nunca alterada · ajustes com *', 'Solicitação do app só conta depois de “Lançar na folha”'].map((t) => <div key={t} className="dc-p">✔ {t}</div>)}
      </div>
    </div> : null}
  </section>;
}
