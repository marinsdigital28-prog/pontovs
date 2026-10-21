'use client';

import './absence-calendar.css';

import { useEffect, useMemo, useRef, useState } from 'react';
import { dateKey as keyOfDate, dropBlockReason, fromKey, moveBlockReason, shiftRange } from '../../lib/absence-move';
import { NATIONAL_HOLIDAYS } from '../../lib/operational-abonos';

type CalendarRequest = {
  id: string;
  type: string;
  status: string;
  startDate: string;
  endDate: string;
  reason: string;
  details?: string | null;
  classification?: string | null;
  employee: { name: string; employeeNumber: string | null };
};

type CalendarCertificate = {
  id: string;
  type: string;
  status: string;
  startDate: string;
  endDate: string;
  startTime?: string | null;
  endTime?: string | null;
  observation?: string | null;
  user: { name: string; employeeNumber: string | null };
};

type CalendarItem = {
  id: string;
  rawId: string;
  source: 'SOLICITAÇÃO' | 'ATESTADO' | 'FERIADO';
  type: string;
  typeLabel: string;
  justification: string;
  status: string;
  start: Date;
  end: Date;
  title: string;
  subtitle: string;
  period: string;
  employee: string;
  employeeNumber: string | null;
};

const TZ = 'America/Sao_Paulo';
const weekDays = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
const monthFormatter = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, month: 'long', year: 'numeric' });
const dayFormatter = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });

function localDate(value: string) {
  const d = new Date(value);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function keyOf(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    PENDENTE: 'Pendente',
    APROVADO: 'Aprovado',
    ATIVO: 'Ativo',
    REJEITADO: 'Rejeitado',
    CANCELADO: 'Cancelado',
  };
  return labels[status] || status;
}

function statusClass(status: string) {
  if (status === 'APROVADO' || status === 'ATIVO') return 'approved';
  if (status === 'REJEITADO' || status === 'CANCELADO') return 'rejected';
  return 'pending';
}

function periodLabel(item: CalendarItem) {
  if (item.source === 'ATESTADO') return item.period;
  if (item.period === 'DIA_TODO') return 'Dia todo';
  if (item.period === 'MANHA') return 'Parcial — manhã';
  if (item.period === 'TARDE') return 'Parcial — tarde';
  return item.period || 'Período informado';
}

function dateRange(start: Date, end: Date) {
  const count = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
  return count === 1 ? dayFormatter.format(start) : `${dayFormatter.format(start)} – ${dayFormatter.format(end)}`;
}

function canCancel(item: CalendarItem) {
  return !['CANCELADO', 'REJEITADO'].includes(item.status);
}

export default function AbsenceCalendar({
  requests,
  certificates,
  onChanged,
  closedPeriods = [],
}: {
  requests: CalendarRequest[];
  certificates: CalendarCertificate[];
  onChanged?: () => void | Promise<void>;
  closedPeriods?: string[];
}) {
  const now = new Date();
  const [cursor, setCursor] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const [filter, setFilter] = useState<'TODOS' | 'PENDENTE' | 'APROVADO'>('TODOS');
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState('');
  const [overrides, setOverrides] = useState<Record<string, { start: Date; end: Date }>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const [tip, setTip] = useState<{ item: CalendarItem; x: number; y: number; pinned: boolean } | null>(null);
  const [pendingMove, setPendingMove] = useState<{ item: CalendarItem; start: Date; end: Date } | null>(null);
  const [movePicker, setMovePicker] = useState<{ item: CalendarItem; value: string } | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const [isTouch, setIsTouch] = useState(false);
  useEffect(() => { setIsTouch(window.matchMedia?.('(hover: none)').matches ?? false); }, []);
  useEffect(() => { if (!actionMsg) return; const t = window.setTimeout(() => setActionMsg(''), 6000); return () => window.clearTimeout(t); }, [actionMsg]);

  function applyOverride<T extends { id: string; start: Date; end: Date }>(item: T): T {
    const o = overrides[item.id];
    return o ? { ...item, start: o.start, end: o.end } : item;
  }
  function findItem(id: string | null) { return id ? items.find((i) => i.id === id) || null : null; }

  useEffect(() => { if (pendingMove) confirmRef.current?.focus(); }, [pendingMove]);
  useEffect(() => {
    if (!tip?.pinned) return;
    const close = () => setTip(null);
    window.addEventListener('scroll', close, true);
    return () => window.removeEventListener('scroll', close, true);
  }, [tip?.pinned]);

  function requestMove(item: CalendarItem, newStart: Date) {
    const reason = dropBlockReason({ source: item.source, type: item.type, status: item.status, start: item.start, end: item.end }, newStart, closedPeriods);
    if (reason) { setActionMsg(`Não foi possível mover: ${reason}`); return; }
    const next = shiftRange(item.start, item.end, newStart);
    setPendingMove({ item, start: next.start, end: next.end });
  }

  async function confirmMove() {
    if (!pendingMove) return;
    const { item, start, end } = pendingMove;
    setPendingMove(null);
    setOverrides((o) => ({ ...o, [item.id]: { start, end } }));
    setBusyId(item.id);
    setActionMsg(`Movendo ${item.employee}…`);
    try {
      const response = await fetch('/api/admin/requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.rawId, action: 'RESCHEDULE', startDate: keyOfDate(start), endDate: keyOfDate(end) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'Sem permissão para mover registros.' : data.error || 'Não foi possível mover o registro.');
      setActionMsg(`${item.employee}: ${item.typeLabel} movida para ${dateRange(start, end)}.`);
      await onChanged?.();
      setOverrides((o) => { const n = { ...o }; delete n[item.id]; return n; });
      setSelectedDay(keyOfDate(start));
    } catch (e) {
      setOverrides((o) => { const n = { ...o }; delete n[item.id]; return n; });
      setActionMsg(`Movimento desfeito: ${e instanceof Error ? e.message : 'falha de rede.'}`);
    } finally {
      setBusyId(null);
    }
  }

  function showTip(item: CalendarItem, el: HTMLElement, pinned: boolean) {
    const r = el.getBoundingClientRect();
    setTip({ item, x: r.left + r.width / 2, y: r.bottom + 6, pinned });
  }

  const items = useMemo<CalendarItem[]>(() => {
    const requestItems = requests
      .filter((item) => ['AUSENCIA', 'PASSEIO', 'EVENTO_EXTERNO'].includes(item.type))
      .map((item) => ({
        id: `request-${item.id}`,
        rawId: item.id,
        source: 'SOLICITAÇÃO' as const,
        type: item.type,
        typeLabel: requestTypeLabel(item.type, item.classification),
        justification: [item.reason, item.details].filter(Boolean).join(' — '),
        status: item.status,
        start: localDate(item.startDate),
        end: localDate(item.endDate),
        title: item.reason || 'Ausência',
        subtitle: item.details || 'Solicitação de ausência',
        period: item.classification?.replace('POR_', '') || 'DIA_TODO',
        employee: item.employee.name,
        employeeNumber: item.employee.employeeNumber,
      }));
    const certificateItems = certificates.map((item) => ({
      id: `certificate-${item.id}`,
      rawId: item.id,
      source: 'ATESTADO' as const,
      type: item.type,
      typeLabel: certificateTypeLabel(item.type),
      justification: item.observation || '',
      status: item.status,
      start: localDate(item.startDate),
      end: localDate(item.endDate),
      title:
        item.type === 'CONSULTA_MEDICA'
          ? 'Consulta médica'
          : item.type === 'TRABALHO_EXTERNO' || item.type === 'TRABALHO_EXTERNO_HORAS'
            ? 'Trabalho externo'
            : item.type === 'SAIDA_MEDICA'
              ? 'Saída médica'
              : 'Atestado',
      subtitle: item.observation || 'Documento cadastrado pela administração',
      period: item.startTime && item.endTime ? `${item.startTime}–${item.endTime}` : 'Dia todo',
      employee: item.user.name,
      employeeNumber: item.user.employeeNumber,
    }));
    const holidayItems: CalendarItem[] = Object.entries(NATIONAL_HOLIDAYS).map(([key, label]) => ({
      id: `holiday-${key}`, rawId: key, source: 'FERIADO' as const, type: 'FERIADO', typeLabel: 'Feriado',
      justification: label, status: 'ATIVO', start: fromKey(key), end: fromKey(key), title: label.replace(/^Feriado nacional — /, ''),
      subtitle: label, period: 'Dia todo', employee: 'Todos', employeeNumber: null,
    }));
    return [...requestItems.map(applyOverride), ...certificateItems, ...holidayItems]
      .filter((item) =>
        filter === 'TODOS'
          ? true
          : filter === 'PENDENTE'
            ? item.status === 'PENDENTE'
            : ['APROVADO', 'ATIVO'].includes(item.status),
      )
      .sort((a, b) => a.start.getTime() - b.start.getTime() || a.employee.localeCompare(b.employee));
  }, [certificates, filter, requests, overrides]);

  const monthCells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1 - first.getDay());
    const total = Math.ceil((first.getDay() + last.getDate()) / 7) * 7;
    return Array.from({ length: total }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
  }, [cursor]);

  const itemsByDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const item of items) {
      const cursorDay = new Date(item.start);
      while (cursorDay <= item.end) {
        const key = keyOf(cursorDay);
        map.set(key, [...(map.get(key) || []), item]);
        cursorDay.setDate(cursorDay.getDate() + 1);
      }
    }
    return map;
  }, [items]);

  const selectedItems = selectedDay ? itemsByDay.get(selectedDay) || [] : [];
  const monthItems = items.filter(
    (item) => item.end >= cursor && item.start < new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1),
  );
  const approvedCount = monthItems.filter((item) => ['APROVADO', 'ATIVO'].includes(item.status)).length;
  const pendingCount = monthItems.filter((item) => item.status === 'PENDENTE').length;

  async function handleCancel(item: CalendarItem) {
    const label =
      item.source === 'ATESTADO' && item.title.toLowerCase().includes('consulta')
        ? 'consulta'
        : item.title.toLowerCase().includes('evento') || item.title.toLowerCase().includes('passeio')
          ? 'evento'
          : item.source === 'ATESTADO'
            ? 'atestado'
            : 'ausência';
    const reason = window.prompt(`Motivo para desmarcar esta ${label} (${item.employee}):`);
    if (reason === null) return;
    const note = reason.trim() || `Desmarcado no calendário administrativo`;

    setBusyId(item.id);
    setActionMsg('');
    try {
      if (item.source === 'SOLICITAÇÃO') {
        const response = await fetch('/api/admin/requests', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: item.rawId, action: 'CANCELAR', reviewNote: note }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          setActionMsg(data.error || 'Não foi possível desmarcar a solicitação.');
          return;
        }
        setActionMsg(`${item.employee}: ${label} desmarcada.`);
      } else {
        const response = await fetch('/api/admin/certificates', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: item.rawId, action: 'cancel', reason: note }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          setActionMsg(data.error || 'Não foi possível desmarcar o atestado/consulta.');
          return;
        }
        setActionMsg(`${item.employee}: ${label} desmarcada.`);
      }
      onChanged?.();
    } catch {
      setActionMsg('Falha de rede ao desmarcar. Tente novamente.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="card absence-calendar-card">
      <div className="section-heading absence-calendar-heading">
        <div>
          <span className="eyebrow">PLANEJAMENTO E COBERTURA</span>
          <h3>Calendário de ausências</h3>
          <p className="small-muted">
            Acompanhe ausências, consultas, eventos, atestados e feriados. Passe o mouse (ou toque) para ver detalhes; arraste uma ausência para outro dia ou use Mover.
          </p>
        </div>
        <div className="absence-calendar-summary">
          <span>
            <strong>{approvedCount}</strong> confirmadas
          </span>
          <span className={pendingCount ? 'is-pending' : ''}>
            <strong>{pendingCount}</strong> pendentes
          </span>
        </div>
      </div>


      <div className="absence-calendar-toolbar">
        <div className="absence-calendar-month-nav">
          <button
            type="button"
            className="ghost-btn compact-btn"
            aria-label="Mês anterior"
            onClick={() => {
              setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1));
              setSelectedDay(null);
            }}
          >
            ‹
          </button>
          <strong>{monthFormatter.format(cursor)}</strong>
          <button
            type="button"
            className="ghost-btn compact-btn"
            aria-label="Próximo mês"
            onClick={() => {
              setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1));
              setSelectedDay(null);
            }}
          >
            ›
          </button>
          <button
            type="button"
            className="ghost-btn compact-btn"
            onClick={() => {
              setCursor(new Date(now.getFullYear(), now.getMonth(), 1));
              setSelectedDay(null);
            }}
          >
            Hoje
          </button>
        </div>
        <div className="absence-calendar-filters" role="group" aria-label="Filtrar ausências">
          {(['TODOS', 'PENDENTE', 'APROVADO'] as const).map((value) => (
            <button key={value} type="button" className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>
              {value === 'TODOS' ? 'Todos' : value === 'PENDENTE' ? 'Pendentes' : 'Confirmadas'}
            </button>
          ))}
        </div>
      </div>

      <div className="absence-calendar-legend">
        <span>
          <i className="calendar-dot approved" /> Confirmada / ativa
        </span>
        <span>
          <i className="calendar-dot pending" /> Aguardando análise
        </span>
        <span>
          <i className="calendar-dot rejected" /> Rejeitada / cancelada
        </span>
        <span>
          <i className="calendar-dot partial" /> Período parcial
        </span>
      </div>

      <div className="absence-calendar-grid" role="grid" aria-label={`Calendário de ${monthFormatter.format(cursor)}`}>
        {weekDays.map((day) => (
          <div key={day} className="absence-calendar-weekday">
            {day}
          </div>
        ))}
        {monthCells.map((date) => {
          const dayKey = keyOf(date);
          const dayItems = itemsByDay.get(dayKey) || [];
          const inMonth = date.getMonth() === cursor.getMonth();
          const isToday = dayKey === keyOf(now);
          return (
            <div
              key={dayKey}
              role="gridcell"
              tabIndex={0}
              className={`absence-calendar-day ${inMonth ? '' : 'outside'} ${isToday ? 'today' : ''} ${selectedDay === dayKey ? 'selected' : ''} ${dropKey === dayKey ? (dropAllowed(dayKey) ? 'drop-ok' : 'drop-no') : ''} ${closedPeriods.includes(dayKey.slice(0, 7)) ? 'closed' : ''}`}
              onClick={() => setSelectedDay(dayKey)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedDay(dayKey); } }}
              onDragOver={(e) => { if (!dragId) return; e.preventDefault(); e.dataTransfer.dropEffect = dropAllowed(dayKey) ? 'move' : 'none'; if (dropKey !== dayKey) setDropKey(dayKey); }}
              onDragLeave={() => setDropKey((k) => (k === dayKey ? null : k))}
              onDrop={(e) => { e.preventDefault(); const item = findItem(dragId || e.dataTransfer.getData('text/plain')); setDragId(null); setDropKey(null); if (item) requestMove(item, date); }}
              aria-label={`${dateFormatter(date)}: ${dayItems.length} registro(s)`}
            >
              <span className="absence-calendar-day-number">{date.getDate()}</span>
              <span className="absence-calendar-events">
                {dayItems.slice(0, 3).map((item) => {
                  const locked = moveBlockReason(item, closedPeriods);
                  return (
                    <span
                      key={item.id}
                      tabIndex={0}
                      role="button"
                      draggable={!locked && busyId !== item.id}
                      aria-describedby={tip?.item.id === item.id ? 'absence-tip' : undefined}
                      aria-label={`${item.typeLabel}: ${item.employee}, ${dateRange(item.start, item.end)}, ${statusLabel(item.status)}${locked ? '. Não pode ser movido.' : '. Arraste para mover ou use Mover no detalhamento.'}`}
                      className={`absence-calendar-event ${item.source === 'FERIADO' ? 'holiday' : statusClass(item.status)} ${item.period !== 'DIA_TODO' && item.source === 'SOLICITAÇÃO' ? 'partial' : ''} ${locked ? 'locked' : 'movable'} ${dragId === item.id ? 'dragging' : ''} ${overrides[item.id] ? 'optimistic' : ''}`}
                      onMouseEnter={(e) => { if (!tip?.pinned) showTip(item, e.currentTarget, false); }}
                      onMouseLeave={() => { if (!tip?.pinned) setTip(null); }}
                      onFocus={(e) => showTip(item, e.currentTarget, false)}
                      onBlur={() => { if (!tip?.pinned) setTip(null); }}
                      onClick={(e) => { e.stopPropagation(); setSelectedDay(dayKey); if (tip?.pinned && tip.item.id === item.id) setTip(null); else showTip(item, e.currentTarget, true); }}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') { setTip(null); return; }
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setSelectedDay(dayKey); }
                        if ((e.key === 'm' || e.key === 'M') && !locked) { e.preventDefault(); e.stopPropagation(); setMovePicker({ item, value: keyOfDate(item.start) }); }
                      }}
                      onDragStart={(e) => { if (locked) { e.preventDefault(); return; } setTip(null); setDragId(item.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', item.id); }}
                      onDragEnd={() => { setDragId(null); setDropKey(null); }}
                    >
                      <i />
                      {item.source === 'FERIADO' ? 'Feriado' : item.employee.split(' ')[0]}
                    </span>
                  );
                })}
                {dayItems.length > 3 ? <span className="absence-calendar-more">+{dayItems.length - 3} outros</span> : null}
              </span>
            </div>
          );
        })}
      </div>

      <div className="absence-calendar-detail">
        <div className="absence-calendar-detail-heading">
          <div>
            <span className="eyebrow">DETALHAMENTO DO DIA</span>
            <h4>{selectedDay ? dateFormatter(new Date(`${selectedDay}T12:00:00`)) : 'Selecione um dia no calendário'}</h4>
          </div>
          {selectedDay ? <span className="small-muted">{selectedItems.length} registro(s)</span> : null}
        </div>
        {!selectedDay ? (
          <p className="small-muted">Clique em qualquer dia para ver quem estará ausente, o motivo e o período informado.</p>
        ) : !selectedItems.length ? (
          <p className="small-muted">Nenhuma ausência, consulta ou evento registrado neste dia.</p>
        ) : (
          <div className="absence-calendar-detail-list">
            {selectedItems.map((item) => (
              <div className="absence-calendar-detail-row" key={item.id}>
                <span className={`calendar-dot ${statusClass(item.status)}`} />
                <div className="absence-calendar-detail-main">
                  <strong>{item.employee}</strong>
                  <span>
                    {item.source === 'FERIADO' ? 'Todos os colaboradores' : item.employeeNumber || 'Sem matrícula'} · {item.typeLabel} · {periodLabel(item)}
                  </span>
                  <small>
                    {dateRange(item.start, item.end)}
                    {item.subtitle ? ` · ${item.subtitle}` : ''}
                  </small>
                </div>
                <div className="absence-calendar-detail-actions" style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span className={`status-pill ${statusClass(item.status)}`}>{statusLabel(item.status)}</span>
                  {!moveBlockReason(item, closedPeriods) ? (
                    <button type="button" className="ghost-btn compact-btn" disabled={busyId === item.id} onClick={(e) => { e.stopPropagation(); setMovePicker({ item, value: keyOfDate(item.start) }); }} title="Mover para outra data (alternativa ao arrastar)">
                      Mover
                    </button>
                  ) : null}
                  {canCancel(item) && item.source !== 'FERIADO' ? (
                    <button
                      type="button"
                      className="danger-btn compact-btn"
                      disabled={busyId === item.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleCancel(item);
                      }}
                      title="Desmarcar / cancelar este registro"
                    >
                      {busyId === item.id ? '…' : 'Desmarcar'}
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {actionMsg ? <div className={`absence-toast ${/^(Não foi possível|Movimento desfeito)/.test(actionMsg) ? 'is-error' : ''}`} role="status" aria-live="polite">{actionMsg}</div> : null}

      {tip ? (
        <div id="absence-tip" role="tooltip" className={`absence-tip ${tip.pinned ? 'pinned' : ''}`} style={{ left: tip.x, top: tip.y }} onClick={(e) => e.stopPropagation()}>
          <strong>{tip.item.typeLabel}</strong>
          <span>{tip.item.source === 'FERIADO' ? tip.item.title : `${tip.item.employee}${tip.item.employeeNumber ? ` · ${tip.item.employeeNumber}` : ''}`}</span>
          <span>{dateRange(tip.item.start, tip.item.end)} · {tipPeriod(tip.item)}</span>
          <span className={`status-pill ${statusClass(tip.item.status)}`}>{tip.item.source === 'FERIADO' ? 'Fixo' : statusLabel(tip.item.status)}</span>
          {tip.item.justification ? <em>{tip.item.justification}</em> : null}
          <small>{moveBlockReason(tip.item, closedPeriods) ? `🔒 ${moveBlockReason(tip.item, closedPeriods)}` : (isTouch ? '↔ Para mover, use o botão Mover no detalhamento do dia.' : '↔ Arraste para outro dia ou pressione M para mover.')}</small>
          {tip.pinned ? <button type="button" className="absence-tip-close" aria-label="Fechar" onClick={() => setTip(null)}>×</button> : null}
        </div>
      ) : null}

      {movePicker ? (
        <div className="absence-modal-backdrop" role="presentation" onClick={() => setMovePicker(null)}>
          <form className="absence-modal" role="dialog" aria-modal="true" aria-labelledby="absence-move-title" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') setMovePicker(null); }}
            onSubmit={(e) => { e.preventDefault(); const it = movePicker.item; const v = movePicker.value; setMovePicker(null); if (/^\d{4}-\d{2}-\d{2}$/.test(v)) requestMove(it, fromKey(v)); }}>
            <h4 id="absence-move-title">Mover {movePicker.item.typeLabel.toLowerCase()}</h4>
            <p className="small-muted">{movePicker.item.employee} · atual: {dateRange(movePicker.item.start, movePicker.item.end)}</p>
            <label>Nova data de início
              <input autoFocus type="date" className="input" value={movePicker.value} onChange={(e) => setMovePicker({ ...movePicker, value: e.target.value })} required />
            </label>
            <div className="absence-modal-actions">
              <button type="button" className="ghost-btn" onClick={() => setMovePicker(null)}>Cancelar</button>
              <button type="submit" className="primary-btn">Continuar</button>
            </div>
          </form>
        </div>
      ) : null}

      {pendingMove ? (
        <div className="absence-modal-backdrop" role="presentation" onClick={() => setPendingMove(null)}>
          <div className="absence-modal" role="alertdialog" aria-modal="true" aria-labelledby="absence-confirm-title" aria-describedby="absence-confirm-desc" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') setPendingMove(null); }}>
            <h4 id="absence-confirm-title">Confirmar mudança de data</h4>
            <p id="absence-confirm-desc"><strong>{pendingMove.item.employee}</strong> · {pendingMove.item.typeLabel}</p>
            <div className="absence-move-dates">
              <span className="from">{dateRange(pendingMove.item.start, pendingMove.item.end)}</span>
              <span aria-hidden>→</span>
              <span className="to">{dateRange(pendingMove.start, pendingMove.end)}</span>
            </div>
            <p className="small-muted">A duração é mantida. A alteração fica registrada na trilha de auditoria.</p>
            <div className="absence-modal-actions">
              <button type="button" className="ghost-btn" onClick={() => setPendingMove(null)}>Cancelar</button>
              <button type="button" className="primary-btn" ref={confirmRef} onClick={() => void confirmMove()}>Confirmar</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );

  function dropAllowed(key: string) {
    const item = findItem(dragId);
    return Boolean(item && !dropBlockReason(item, fromKey(key), closedPeriods));
  }
}

function requestTypeLabel(type: string, classification?: string | null) {
  if (type === 'PASSEIO') return 'Passeio';
  if (type === 'EVENTO_EXTERNO') return 'Evento externo';
  const map: Record<string, string> = {
    EMERGENCIA: 'Ausência emergencial', 'Atestado médico': 'Atestado (ausência)', Consulta: 'Consulta',
    'Compromisso pessoal': 'Compromisso pessoal', 'Ausência previamente autorizada': 'Ausência autorizada',
  };
  return map[(classification || '').trim()] || 'Ausência';
}

function tipPeriod(item: CalendarItem) {
  if (item.source !== 'SOLICITAÇÃO' || ['DIA_TODO', 'MANHA', 'TARDE'].includes(item.period)) return periodLabel(item);
  return 'Dia todo';
}

function certificateTypeLabel(type: string) {
  if (type === 'CONSULTA_MEDICA') return 'Consulta médica';
  if (type === 'TRABALHO_EXTERNO' || type === 'TRABALHO_EXTERNO_HORAS') return 'Trabalho externo';
  if (type === 'SAIDA_MEDICA') return 'Saída médica';
  return 'Atestado';
}

function dateFormatter(date: Date) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, dateStyle: 'full' }).format(date);
}
