'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Missing = { type: string; label: string; time: string; confidence: 'ALTA' | 'MEDIA' | 'BAIXA'; source: string; detail: string };
type Item = {
  key: string; kind: string; userId: string; date: string; weekday: number;
  user: { id: string; name: string; employeeNumber?: string | null; jobTitle?: string | null; hasPhone?: boolean };
  schedule: { start: string; end: string; mode: string } | null;
  actualPunches: Array<{ id: string; type: string; time: string; manual?: boolean }>;
  missing: Missing[]; confidence: 'ALTA' | 'MEDIA' | 'BAIXA'; ordered: boolean;
  context: Array<{ type: string; samples: number; times: string[] }>;
  requestIds: string[]; informedNote: string | null;
  awaiting: { requestId: string; status: string; sentAt: string; correction?: Array<{ type: string; time: string }> | null; correctionNote?: string | null } | null;
};
type Action = 'ACCEPT' | 'ABSENCE' | 'CONFIRM';

const ORDER = ['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA'];
const LABEL: Record<string, string> = { ENTRADA: 'Entrada', INTERVALO: 'Saída intervalo', RETORNO: 'Retorno', SAIDA: 'Saída' };
const WEEKDAY = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const CONF: Record<string, { label: string; cls: string }> = { ALTA: { label: 'Confiança alta', cls: 'ok' }, MEDIA: { label: 'Confiança média', cls: 'warn' }, BAIXA: { label: 'Confiança baixa', cls: 'off' } };
const SOURCE: Record<string, string> = { COLABORADOR: 'informado pelo colaborador', HISTORICO: 'padrão dos últimos dias', JORNADA: 'jornada cadastrada', REGRA_ALMOCO: 'regra do almoço' };
const KIND: Record<string, string> = { PEDIDO: 'Pedido do colaborador', INCONSISTENCIA: 'Batida faltando', AUSENCIA: 'Sem nenhuma batida', SAIDA_PENDENTE: 'Saída pendente hoje' };
const BULK_REASON = 'Inclusão em lote de batidas esquecidas com sugestão de confiança alta (horário informado pelo colaborador ou padrão estável dos últimos 10 dias), revisadas pelo gestor.';

function fmtDate(date: string) { const [y, m, d] = date.split('-'); return `${d}/${m}/${y}`; }


export function defaultReason(item: Item, action: Action, times: Record<string, string>) {
  const list = item.missing.map((m) => `${LABEL[m.type]} ${times[m.type] || m.time}`).join(', ');
  if (action === 'ABSENCE') return `Falta confirmada em ${fmtDate(item.date)}: colaborador não compareceu e não há justificativa.`;
  if (action === 'CONFIRM') return `Pedido de confirmação ao colaborador: ${list} em ${fmtDate(item.date)}.`;
  const sources = Array.from(new Set(item.missing.map((m) => SOURCE[m.source] || m.source))).join(' / ');
  return `${item.requestIds.length ? 'Batida esquecida informada pelo colaborador' : 'Batida esquecida'}: inclusão de ${list} (${sources}).`;
}

export default function ForgottenQueue({ onOpenAbsences }: { onOpenAbsences?: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [waLinks, setWaLinks] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [action, setAction] = useState<Action>('ACCEPT');
  const [times, setTimes] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [reasonTouched, setReasonTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkReason, setBulkReason] = useState(BULK_REASON);
  const rootRef = useRef<HTMLDivElement>(null);
  const firstTimeRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const res = await fetch('/api/admin/forgotten-queue', { cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) setError(json.error || 'Não foi possível carregar a fila.');
    else setItems(json.items || []);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const item = items[Math.min(index, Math.max(0, items.length - 1))] as Item | undefined;
  const highItems = useMemo(() => items.filter((i) => i.confidence === 'ALTA' && i.awaiting?.status !== 'PENDENTE' && i.missing.every((m) => m.time)), [items]);

  useEffect(() => {
    if (!item) return;
    const t = Object.fromEntries(item.missing.map((m) => [m.type, m.time]));
    const first: Action = item.kind === 'AUSENCIA' ? 'ABSENCE' : 'ACCEPT'; setTimes(t); setAction(first); setReasonTouched(false); setReason(defaultReason(item, first, t));
  }, [item?.key, item?.date, item?.userId]); // eslint-disable-line react-hooks/exhaustive-deps

  function choose(next: Action) { setAction(next); if (item && !reasonTouched) setReason(defaultReason(item, next, times)); }
  function setTime(type: string, value: string) { const t = { ...times, [type]: value }; setTimes(t); if (item && !reasonTouched) setReason(defaultReason(item, action, t)); }
  function skip() { if (items.length) setIndex((i) => (i + 1) % items.length); }

  async function submit(payloadItems: Item[], act: Action, why: string, overrideTimes?: Record<string, string>) {
    if (why.trim().length < 5) { setError('A justificativa é obrigatória (mínimo 5 caracteres).'); return; }
    setBusy(true); setError(''); setNotice(''); setWaLinks([]);
    const body = { action: act, reason: why.trim(), items: payloadItems.map((i) => ({ key: i.key, userId: i.userId, date: i.date, requestIds: i.requestIds, confirmRequestId: i.awaiting?.requestId || null, punches: act === 'ABSENCE' ? [] : i.missing.map((m) => ({ type: m.type, time: (overrideTimes && payloadItems.length === 1 ? overrideTimes[m.type] : null) || m.time })).filter((p) => /^\d{2}:\d{2}$/.test(p.time)) })) };
    const res = await fetch('/api/admin/forgotten-queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(json.error || 'Não foi possível concluir.'); return; }
    if (act === 'CONFIRM') { setNotice('Pedido de confirmação enviado. O colaborador verá em "Minhas solicitações" no app.'); setWaLinks((json.links || []).map((l: any) => l.whatsapp).filter(Boolean)); }
    else setNotice(act === 'ABSENCE' ? 'Falta confirmada e registrada na auditoria.' : `${json.created} marcação(ões) incluída(s) em ${json.resolved} dia(s). Originais preservados, justificativa na auditoria.`);
    setBulkOpen(false);
    const done = new Set(payloadItems.map((i) => `${i.userId}|${i.date}`));
    setItems((list) => list.filter((i) => !done.has(`${i.userId}|${i.date}`) || act === 'CONFIRM'));
    if (act === 'CONFIRM') void load();
  }

  const timesValid = item ? item.missing.every((m) => /^\d{2}:\d{2}$/.test(times[m.type] || '')) : false;
  const run = () => { if (!item || busy) return; if (action === 'ACCEPT' && !timesValid) { setError('Preencha todos os horários antes de aceitar.'); return; } void submit([item], action, reason, times); };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!rootRef.current || !item || bulkOpen) return;
      const target = e.target as HTMLElement;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); return; }
      if (typing || e.altKey || e.ctrlKey || e.metaKey) return;
      const k = e.key.toLowerCase();
      if (k === 'a') { e.preventDefault(); choose('ACCEPT'); }
      else if (k === 'e') { e.preventDefault(); choose('ACCEPT'); firstTimeRef.current?.focus(); }
      else if (k === 'f') { e.preventDefault(); choose('ABSENCE'); }
      else if (k === 't') { e.preventDefault(); onOpenAbsences?.(); }
      else if (k === 'c') { e.preventDefault(); choose('CONFIRM'); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); skip(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const timeline = item ? ORDER.filter((t) => item.schedule || item.actualPunches.some((p) => p.type === t) || item.missing.some((m) => m.type === t)).filter((t) => item.schedule?.mode !== 'HALF' || !['INTERVALO', 'RETORNO'].includes(t) || item.actualPunches.some((p) => p.type === t) || item.missing.some((m) => m.type === t)).map((type) => {
    const actual = item.actualPunches.filter((p) => p.type === type);
    const miss = item.missing.find((m) => m.type === type);
    const expected = type === 'ENTRADA' ? item.schedule?.start : type === 'SAIDA' ? item.schedule?.end : null;
    return { type, actual, miss, expected };
  }) : [];

  return (
    <div className="card fq" ref={rootRef}>
      <div className="section-heading">
        <div>
          <span className="eyebrow">FILA DE RESOLUÇÃO</span>
          <h3>Resolver marcações esquecidas</h3>
          <p className="summary">{loading ? 'Carregando…' : items.length ? `${items.length} dia(s) para revisar · um de cada vez, com sugestão e justificativa prontas.` : 'Nada pendente. Tudo em dia.'}</p>
        </div>
        <div className="fq-head-actions">
          <button type="button" className="primary-btn" disabled={!highItems.length || busy} onClick={() => { setBulkReason(BULK_REASON); setBulkOpen(true); }}>Aceitar todas com confiança alta ({highItems.length})</button>
          <button type="button" className="ghost-btn" onClick={() => void load()} disabled={loading}>Atualizar</button>
        </div>
      </div>

      {error ? <p className="fq-msg bad" role="alert">{error}</p> : null}
      {notice ? <p className="fq-msg ok" role="status">{notice} {waLinks.map((l, i) => <a key={i} href={l} target="_blank" rel="noreferrer" className="fq-wa">Avisar no WhatsApp (opcional)</a>)}</p> : null}

      {bulkOpen ? (
        <div className="fq-bulk" role="dialog" aria-label="Aceitar em lote">
          <strong>Aceitar {highItems.length} dia(s) com confiança alta</strong>
          <ul>{highItems.slice(0, 12).map((i) => <li key={`${i.userId}|${i.date}`}>{i.user.name} · {fmtDate(i.date)} · {i.missing.map((m) => `${LABEL[m.type]} ${m.time}`).join(', ')}</li>)}{highItems.length > 12 ? <li>… e mais {highItems.length - 12}</li> : null}</ul>
          <label>Justificativa única (gravada em cada item na auditoria)<textarea rows={2} value={bulkReason} onChange={(e) => setBulkReason(e.target.value)} /></label>
          <p className="fq-hint">Tudo em uma única transação: se um item falhar, nada é gravado.</p>
          <div className="fq-row"><button type="button" className="primary-btn" disabled={busy || bulkReason.trim().length < 5} onClick={() => void submit(highItems, 'ACCEPT', bulkReason)}>Confirmar lote</button><button type="button" className="ghost-btn" onClick={() => setBulkOpen(false)}>Cancelar</button></div>
        </div>
      ) : null}

      {loading && !items.length ? <div className="skeleton" style={{ height: 180 }} /> : null}
      {!loading && !items.length ? <div className="empty-state">Nenhuma marcação esquecida no período. 🎉</div> : null}

      {item ? (
        <div className="fq-item">
          <div className="fq-item-head">
            <div>
              <strong className="fq-name">{item.user.name}</strong>
              <span className="fq-meta">Mat. {item.user.employeeNumber || '—'} · {WEEKDAY[item.weekday]}, {fmtDate(item.date)}{item.schedule ? ` · jornada ${item.schedule.start}–${item.schedule.end}` : ''}</span>
            </div>
            <div className="fq-badges">
              <span className="status-pill warn">{KIND[item.kind] || item.kind}</span>
              <span className={`status-pill ${CONF[item.confidence].cls}`}>{CONF[item.confidence].label}</span>
              <span className="fq-pos">{Math.min(index, items.length - 1) + 1} de {items.length}</span>
            </div>
          </div>

          {item.awaiting ? <p className="fq-msg warn">{item.awaiting.status === 'PENDENTE' ? `Aguardando o colaborador confirmar no app (enviado em ${new Date(item.awaiting.sentAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}).` : `O colaborador corrigiu o horário no app${item.awaiting.correctionNote ? `: “${item.awaiting.correctionNote}”` : ''}. Revise e aceite.`}</p> : null}
          {item.kind === 'AUSENCIA' ? <p className="fq-msg warn">Nenhuma batida neste dia. Verifique se foi falta (F) ou se há atestado/ausência (T) antes de incluir horários.</p> : null}
          {item.informedNote ? <p className="fq-note">Motivo informado pelo colaborador: “{item.informedNote}”</p> : null}

          <div className="fq-timeline" aria-label="Linha do tempo do dia">
            {timeline.map((slot) => (
              <div key={slot.type} className={`fq-slot ${slot.miss ? 'missing' : 'done'}`}>
                <span className="fq-slot-label">{LABEL[slot.type]}</span>
                {slot.expected ? <span className="fq-expected">previsto {slot.expected}</span> : <span className="fq-expected">&nbsp;</span>}
                {slot.actual.map((p) => <span key={p.id} className="fq-actual">{p.time}{p.manual ? '*' : ''}</span>)}
                {slot.miss ? (
                  <>
                    <input ref={item.missing[0]?.type === slot.type ? firstTimeRef : undefined} className={`fq-time conf-${slot.miss.confidence}`} type="time" value={times[slot.type] || ''} aria-label={`Horário sugerido para ${LABEL[slot.type]}`} onChange={(e) => setTime(slot.type, e.target.value)} />
                    <span className={`fq-source conf-${slot.miss.confidence}`}>{SOURCE[slot.miss.source] || slot.miss.source}</span>
                  </>
                ) : null}
              </div>
            ))}
          </div>
          {!item.ordered ? <p className="fq-msg warn">Atenção: a sugestão fica fora da ordem das batidas reais. Confira os horários.</p> : null}

          <div className="fq-context">
            {item.missing.map((m) => {
              const ctx = item.context.find((c) => c.type === m.type);
              return <p key={m.type}><strong>{LABEL[m.type]}:</strong> {m.detail}{ctx?.times.length ? <> · últimos dias: <span className="fq-hist">{ctx.times.join(' · ')}</span></> : null}</p>;
            })}
          </div>

          <div className="fq-actions" role="group" aria-label="Ações">
            <button type="button" className={action === 'ACCEPT' ? 'primary-btn' : 'ghost-btn'} onClick={() => choose('ACCEPT')}><kbd>A</kbd> Aceitar sugestão</button>
            <button type="button" className="ghost-btn" onClick={() => { choose('ACCEPT'); firstTimeRef.current?.focus(); }}><kbd>E</kbd> Editar horário</button>
            <button type="button" className={action === 'ABSENCE' ? 'primary-btn danger' : 'ghost-btn'} onClick={() => choose('ABSENCE')}><kbd>F</kbd> Foi falta</button>
            <button type="button" className="ghost-btn" onClick={() => onOpenAbsences?.()}><kbd>T</kbd> Tem atestado/ausência</button>
            <button type="button" className={action === 'CONFIRM' ? 'primary-btn' : 'ghost-btn'} onClick={() => choose('CONFIRM')}><kbd>C</kbd> Pedir confirmação</button>
            <button type="button" className="ghost-btn" onClick={skip}><kbd>→</kbd> Pular</button>
          </div>

          <label className="fq-reason">Justificativa (obrigatória, vai para a auditoria)
            <textarea rows={2} value={reason} onChange={(e) => { setReason(e.target.value); setReasonTouched(true); }} />
          </label>
          <div className="fq-row">
            <button type="button" className="primary-btn" disabled={busy || reason.trim().length < 5} onClick={run}>{action === 'ACCEPT' ? 'Incluir marcação' : action === 'ABSENCE' ? 'Confirmar falta' : 'Enviar ao colaborador'} <kbd>Ctrl+Enter</kbd></button>
            <span className="fq-hint">{action === 'ACCEPT' ? 'Cria marcação manual (*) — nada é sobrescrito.' : action === 'ABSENCE' ? 'Nenhuma batida é criada; o dia fica como falta.' : 'A batida só é criada quando o colaborador confirmar no app.'}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}


