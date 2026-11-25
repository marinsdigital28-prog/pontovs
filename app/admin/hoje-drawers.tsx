'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { shortName } from '@/lib/short-name';
import {
  capJob, entradaOf, expectedMinutes, fmtH, isLate14Suggestion, kpiGroups, pendenciaCounts, workStatus, workedMinutes,
} from '@/lib/hoje-kpis';
import type { HojeData, Pend } from './hoje-v2';

export type DrawerKey = 'trabalhando' | 'sairam' | 'sem-registro' | 'sugestoes' | 'fechamento' | 'late14';

type ClosingPerson = {
  id: string; name: string; jobTitle: string | null; employeeNumber: string | null; ok: boolean;
  items: { kind: string; label: string; days?: string[]; detail?: { reason: string; dates: string }[] }[];
};
type ClosingData = {
  today: string; month: string; monthLabel: string; lastDay: string; businessDays: string[];
  businessDaysCount: number; holidaysNote: string;
  totals: Record<string, number>;
  people: ClosingPerson[];
};

const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const dayLabel = (key: string) => `${WD[new Date(`${key}T12:00:00Z`).getUTCDay()]} ${key.slice(8, 10)}/${key.slice(5, 7)}`;
const initials = (full: string) => shortName(full).split(' ').map((w) => w.charAt(0)).join('').toUpperCase().slice(0, 2);

function jobOf(title: string | null | undefined) { return capJob(title); }

export default function HojeKpiDrawers({
  data, open, late14Only, onClose, onOpenDay, onOpenAtestado, onOpenFolha, onChanged,
}: {
  data: HojeData;
  open: DrawerKey | null;
  late14Only?: boolean;
  onClose: () => void;
  onOpenDay: (userId: string, date: string) => void;
  onOpenAtestado: (userId: string, date: string) => void;
  onOpenFolha: (userId?: string) => void;
  onChanged: () => void;
}) {
  const [closing, setClosing] = useState<ClosingData | null>(null);
  const [closingErr, setClosingErr] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (open !== 'fechamento') return;
    let alive = true;
    setClosingErr('');
    fetch('/api/admin/hoje/fechamento', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error('falha')))
      .then((d) => { if (alive) setClosing(d); })
      .catch(() => { if (alive) setClosingErr('Não foi possível carregar o checklist de fechamento.'); });
    return () => { alive = false; };
  }, [open, data.today]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const groups = kpiGroups(data.people, data.nowMin);
  const counts = pendenciaCounts(data.pendencias);
  const wide = open === 'sugestoes' || open === 'late14' || open === 'fechamento';

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

  let title = '';
  let count: string | number = '';
  let subtitle = '';
  let body: ReactNode = null;

  if (open === 'trabalhando') {
    title = 'Trabalhando agora';
    count = `${groups.working.length}/${groups.today.length}`;
    subtitle = `${groups.working.length} ${groups.working.length === 1 ? 'pessoa' : 'pessoas'} com o dia em andamento · ${groups.inLunch.length ? `${groups.inLunch.length} no almoço agora` : data.nowMin >= 13 * 60 ? 'todos já voltaram do almoço' : 'ninguém no almoço agora'}`;
    const rows = [...groups.working].sort((a, b) => shortName(a.name).localeCompare(shortName(b.name), 'pt-BR'));
    body = <div className="kd-list">{rows.map((p) => {
      const st = workStatus(p);
      const hours = fmtH(workedMinutes(p.punches, data.nowMin));
      return <button type="button" className="kd-row" key={p.id} onClick={() => onOpenDay(p.id, data.today)}>
        <span className="av">{initials(p.name)}</span>
        <div className="meta"><b>{shortName(p.name)}</b><small>{jobOf(p.jobTitle)}</small></div>
        <div className="facts">
          <span>Entrada <b>{entradaOf(p) || '—'}</b></span>
          <span className={`pill-st ${st.key === 'em_intervalo' ? 'in' : 'back'}`}>{st.label}</span>
          <span className="hrs">{hours} no dia</span>
        </div>
        <i className="chev">›</i>
      </button>;
    })}</div>;
  }

  if (open === 'sairam') {
    title = 'Já saíram';
    count = groups.left.length;
    subtitle = `${groups.leftHalf.length} meio período · ${groups.leftAbs.length} ausência aprovada`;
    const rows = [...groups.left].sort((a, b) => (a.schedule?.mode === 'HALF' ? 0 : 1) - (b.schedule?.mode === 'HALF' ? 0 : 1) || shortName(a.name).localeCompare(shortName(b.name), 'pt-BR'));
    body = <div className="kd-list">{rows.map((p) => {
      const half = p.schedule?.mode === 'HALF';
      const exp = expectedMinutes(p.schedule);
      const hours = fmtH(workedMinutes(p.punches, data.nowMin, false));
      const saida = [...p.punches].reverse().find((x) => !x.rejected && x.type === 'SAIDA')?.time || p.lastType;
      return <button type="button" className="kd-row" key={p.id} onClick={() => onOpenDay(p.id, data.today)}>
        <span className="av">{initials(p.name)}</span>
        <div className="meta"><b>{shortName(p.name)}</b><small>{jobOf(p.jobTitle)}</small></div>
        <div className="facts">
          <span>Saiu <b>{saida}</b></span>
          <span className={`pill-st ${half ? 'half' : p.absence ? 'abs' : 'out'}`}>{half ? 'Meio período' : p.absence ? 'Ausência aprovada' : 'Expediente encerrado'}</span>
          <span className="hrs">{hours} trabalhadas{exp != null ? ` · previsto ${fmtH(exp)}` : ''}</span>
        </div>
        <i className="chev">›</i>
      </button>;
    })}</div>;
  }

  if (open === 'sem-registro') {
    title = 'Sem registro hoje';
    count = groups.noRecord.length;
    const names = groups.noRecord.map((p) => shortName(p.name));
    subtitle = names.length === 0 ? 'Todos bateram' : names.length === 1 ? `Só ${names[0]} ainda não bateu o ponto` : `${names.length} pessoas sem batida hoje`;
    body = <div>{groups.noRecord.map((p) => {
      const sch = p.schedule!;
      const hasDoc = Boolean(p.absence);
      return <div className="kd-person" key={p.id}>
        <div className="pc-top"><span className="av warn">{initials(p.name)}</span><div><b>{shortName(p.name)}</b><small>{jobOf(p.jobTitle)}{p.employeeNumber ? ` · matrícula ${p.employeeNumber}` : ''}</small></div></div>
        <dl className="kv">
          <div><dt>Escala prevista hoje</dt><dd>{sch.start}–{sch.end}{sch.mode === 'HALF' ? ' · meio expediente' : ' · jornada integral (almoço 1h)'}</dd></div>
          <div><dt>Atestado, folga ou pedido</dt><dd className={hasDoc ? '' : 'warn-t'}>{hasDoc && p.absence ? `${(p.absence as { reason: string }).reason}` : 'Nenhum lançamento neste dia'}</dd></div>
          <div><dt>Situação</dt><dd>Dia de trabalho, já passou das {sch.start}, e não há batida.</dd></div>
        </dl>
        <div className="kd-acts big">
          <button type="button" className="ok" onClick={() => onOpenAtestado(p.id, data.today)}>+ Lançar atestado</button>
          <button type="button" className="adj" onClick={() => onOpenDay(p.id, data.today)}>Ver folha</button>
        </div>
        <p className="kd-note">Abre o menu rápido de atestado. A folha abre o dia {data.today.slice(8, 10)}/{data.today.slice(5, 7)} dela, sem alterar batida original.</p>
      </div>;
    })}</div>;
  }

  if (open === 'sugestoes' || open === 'late14') {
    const all = data.pendencias;
    const list = late14Only ? all.filter((p) => isLate14Suggestion(p.suggestion)) : all;
    title = late14Only ? '“Retorno 14:00” recalculadas' : 'Sugestões para revisar';
    count = late14Only ? list.length : data.openCount;
    subtitle = late14Only
      ? `${list.length} ${list.length === 1 ? 'restante' : 'restantes'} · o mesmo critério do selo`
      : `${counts.alta} alta · ${counts.media} média · ${counts.conferir} para conferir — o mesmo ${data.openCount} do sino`;
    body = <div className="kd-sugs">
      {msg ? <div className="kd-msg">{msg}</div> : null}
      {!list.length ? <p className="kd-empty">Nada para revisar aqui.</p> : null}
      {list.map((p) => <SugRow key={p.id} p={p} busy={busy === p.id} onAccept={() => void act(p, 'ACEITAR')} onIgnore={() => void act(p, 'IGNORAR')} onAdjust={() => onOpenDay(p.userId, p.date)} onAtestado={() => onOpenAtestado(p.userId, p.date)} />)}
    </div>;
  }

  if (open === 'fechamento') {
    title = `Fechamento de ${data.closing.monthLabel}`;
    count = `${data.closing.businessDays} ${data.closing.businessDays === 1 ? 'dia útil' : 'dias úteis'}`;
    const last = `${data.closing.lastDay.slice(8, 10)}/${data.closing.lastDay.slice(5, 7)}`;
    const until = addDayLabel(data.today, -1);
    subtitle = closing
      ? `Folha fecha em ${last} · ${closing.totals.peopleWithIssues} pessoas com algo pendente · ${closing.totals.peopleOk} em dia`
      : `Folha fecha em ${last}`;
    const T = closing?.totals;
    const issuePeople = (closing?.people || []).filter((p) => !p.ok);
    const okPeople = (closing?.people || []).filter((p) => p.ok);
    body = <div>
      {closingErr ? <p className="kd-msg">{closingErr}</p> : null}
      {!closing && !closingErr ? <p className="kd-empty">Carregando o checklist…</p> : null}
      {closing && T ? <>
        <ul className="kd-chips">
          <li><b>{closing.businessDaysCount}</b> dias úteis restantes<small>{closing.businessDays.map((d) => dayLabel(d)).join(', ')}</small></li>
          <li className="r"><b>{T.faltas}</b> faltas até {until}</li>
          <li className="y"><b>{T.incompletos}</b> dias incompletos</li>
          <li className="y"><b>{T.ausenciasNaoLancadas}</b> ausências aprovadas não lançadas</li>
          <li><b>{T.pedidosPendentes}</b> pedidos pendentes</li>
          <li className="gold"><b>{T.sugestoes}</b> sugestões abertas</li>
        </ul>
        <p className="kd-holiday">{closing.holidaysNote}</p>
        <button type="button" className="kd-preview" onClick={() => onOpenFolha()}>Prévia da folha de {data.closing.monthLabel}</button>
        <div className="kd-list">
          {issuePeople.map((p) => {
            const details: string[] = [];
            for (const i of p.items) {
              if (i.kind === 'troca') continue;
              if (i.days?.length) details.push(i.days.map(dayLabel).join(', '));
              if (i.detail) for (const d of i.detail) {
                const [a, b] = d.dates.split('–');
                details.push(`${d.reason} (${a === b ? dayLabel(a) : `${dayLabel(a)}–${dayLabel(b)}`})`);
              }
            }
            return <button type="button" className="kd-row close-row" key={p.id} onClick={() => onOpenFolha(p.id)}>
              <span className="av">{initials(p.name)}</span>
              <div className="meta">
                <b>{shortName(p.name)}</b>
                {details.length ? <small>{details.join(' · ')}</small> : null}
                <div className="bads">{p.items.filter((i) => i.kind !== 'troca').map((i, idx) => <span key={idx} className={`bdg ${badgeCls(i.kind)}`}>{i.label}</span>)}</div>
              </div>
              <i className="chev">›</i>
            </button>;
          })}
        </div>
        {okPeople.length ? <p className="kd-okline">✔ Já em dia para fechar: {okPeople.map((p) => shortName(p.name)).join(', ')}.</p> : null}
      </> : null}
    </div>;
  }

  return <>
    <div className="kd-bg" onClick={onClose} />
    <aside className={`kd-drawer${wide ? ' wide' : ''}`} role="dialog" aria-label={title}>
      <header className="kd-dh">
        <div>
          <small>Hoje · {data.today.slice(8, 10)}/{data.today.slice(5, 7)}</small>
          <h2>{title} <em>{count}</em></h2>
          <p>{subtitle}</p>
        </div>
        <button type="button" className="kd-x" aria-label="Fechar" onClick={onClose}>✕</button>
      </header>
      {body}
      <footer className="kd-df">
        <span>Cada nome abre a folha da pessoa. Os números são os mesmos do card.</span>
      </footer>
    </aside>
  </>;
}


function badgeCls(kind: string) {
  if (kind === 'falta') return 'r';
  if (kind === 'sugestao') return 'gold';
  if (kind === 'incompleto' || kind === 'pedido_pendente' || kind === 'nao_lancado' || kind === 'atestado_pendente') return 'y';
  return '';
}

function addDayLabel(key: string, n: number) {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  const k = d.toISOString().slice(0, 10);
  return `${k.slice(8, 10)}/${k.slice(5, 7)}`;
}

function SugRow({ p, busy, onAccept, onIgnore, onAdjust, onAtestado }: { p: Pend; busy: boolean; onAccept: () => void; onIgnore: () => void; onAdjust: () => void; onAtestado: () => void }) {
  const s = p.suggestion;
  const kind = s?.kind || 'TEXT';
  const why = (s?.text || '').trim();
  const canAccept = Boolean(s && s.kind !== 'TEXT');
  let a1: { label: string; cls: string; fn: () => void } | null = null;
  let a2 = { label: 'Corrigir no dia', fn: onAdjust };
  if (kind === 'LAUNCH_REQUEST') a1 = { label: 'Lançar na folha', cls: 'ok', fn: onAccept };
  else if (canAccept) a1 = { label: '✓ Aceitar', cls: 'ok', fn: onAccept };
  else if (/Aprove ou recuse/i.test(why)) a1 = { label: 'Abrir pedido', cls: 'adj', fn: onAdjust };
  else if (p.kind === 'SEM_BATIDAS') { a1 = { label: 'Lançar atestado', cls: 'ok', fn: onAtestado }; a2 = { label: 'Ver folha', fn: onAdjust }; }
  else { a2 = { label: 'Corrigir no dia', fn: onAdjust }; }
  return <article className="kd-sg">
    <header>
      <span className="av">{initials(p.employee?.name || '')}</span>
      <div><h4>{shortName(p.employee?.name || '—')}</h4><small>{dayLabel(p.date)} · {p.title}</small></div>
      <span className={`conf ${p.level === 'ALTA' ? 'hi' : p.level === 'MEDIA' ? 'mid' : 'lo'}`}>{p.level === 'ALTA' ? 'Alta' : p.level === 'MEDIA' ? 'Média' : 'Para conferir'}</span>
    </header>
    <p className="why"><b>{p.title}.</b> {p.detail}</p>
    {why ? <p className="res">{why}</p> : null}
    <div className="kd-acts">
      {a1 ? <button type="button" className={a1.cls} disabled={busy} onClick={a1.fn}>{a1.label}</button> : null}
      <button type="button" className="adj" disabled={busy} onClick={a2.fn}>{a2.label}</button>
      <button type="button" className="ign" disabled={busy} onClick={onIgnore}>Ignorar</button>
    </div>
  </article>;
}

