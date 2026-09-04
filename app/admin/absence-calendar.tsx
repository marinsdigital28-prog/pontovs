'use client';

import { useMemo, useState } from 'react';

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
  source: 'SOLICITAÇÃO' | 'ATESTADO';
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

export default function AbsenceCalendar({ requests, certificates }: { requests: CalendarRequest[]; certificates: CalendarCertificate[] }) {
  const now = new Date();
  const [cursor, setCursor] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const [filter, setFilter] = useState<'TODOS' | 'PENDENTE' | 'APROVADO'>('TODOS');
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const items = useMemo<CalendarItem[]>(() => {
    const requestItems = requests
      .filter((item) => ['AUSENCIA','PASSEIO','EVENTO_EXTERNO'].includes(item.type))
      .map((item) => ({
        id: `request-${item.id}`,
        source: 'SOLICITAÇÃO' as const,
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
      source: 'ATESTADO' as const,
      status: item.status,
      start: localDate(item.startDate),
      end: localDate(item.endDate),
      title: item.type === 'TRABALHO_EXTERNO' ? 'Trabalho externo' : 'Atestado',
      subtitle: item.observation || 'Documento cadastrado pela administração',
      period: item.startTime && item.endTime ? `${item.startTime}–${item.endTime}` : 'Dia todo',
      employee: item.user.name,
      employeeNumber: item.user.employeeNumber,
    }));
    return [...requestItems, ...certificateItems]
      .filter((item) => filter === 'TODOS' || (filter === 'PENDENTE' ? item.status === 'PENDENTE' : ['APROVADO', 'ATIVO'].includes(item.status)))
      .sort((a, b) => a.start.getTime() - b.start.getTime() || a.employee.localeCompare(b.employee));
  }, [certificates, filter, requests]);

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
  const monthItems = items.filter((item) => item.end >= cursor && item.start < new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1));
  const approvedCount = monthItems.filter((item) => ['APROVADO', 'ATIVO'].includes(item.status)).length;
  const pendingCount = monthItems.filter((item) => item.status === 'PENDENTE').length;

  return (
    <section className="card absence-calendar-card">
      <div className="section-heading absence-calendar-heading">
        <div>
          <span className="eyebrow">PLANEJAMENTO E COBERTURA</span>
          <h3>Calendário de ausências</h3>
          <p className="small-muted">Acompanhe ausências, atestados e períodos parciais por colaborador antes do fechamento.</p>
        </div>
        <div className="absence-calendar-summary">
          <span><strong>{approvedCount}</strong> confirmadas</span>
          <span className={pendingCount ? 'is-pending' : ''}><strong>{pendingCount}</strong> pendentes</span>
        </div>
      </div>

      <div className="absence-calendar-toolbar">
        <div className="absence-calendar-month-nav">
          <button type="button" className="ghost-btn compact-btn" aria-label="Mês anterior" onClick={() => { setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1)); setSelectedDay(null); }}>‹</button>
          <strong>{monthFormatter.format(cursor)}</strong>
          <button type="button" className="ghost-btn compact-btn" aria-label="Próximo mês" onClick={() => { setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)); setSelectedDay(null); }}>›</button>
          <button type="button" className="ghost-btn compact-btn" onClick={() => { setCursor(new Date(now.getFullYear(), now.getMonth(), 1)); setSelectedDay(null); }}>Hoje</button>
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
        <span><i className="calendar-dot approved" /> Confirmada / ativa</span>
        <span><i className="calendar-dot pending" /> Aguardando análise</span>
        <span><i className="calendar-dot rejected" /> Rejeitada / cancelada</span>
        <span><i className="calendar-dot partial" /> Período parcial</span>
      </div>

      <div className="absence-calendar-grid" role="grid" aria-label={`Calendário de ${monthFormatter.format(cursor)}`}>
        {weekDays.map((day) => <div key={day} className="absence-calendar-weekday">{day}</div>)}
        {monthCells.map((date) => {
          const dayKey = keyOf(date);
          const dayItems = itemsByDay.get(dayKey) || [];
          const inMonth = date.getMonth() === cursor.getMonth();
          const isToday = dayKey === keyOf(now);
          return (
            <button key={dayKey} type="button" className={`absence-calendar-day ${inMonth ? '' : 'outside'} ${isToday ? 'today' : ''} ${selectedDay === dayKey ? 'selected' : ''}`} onClick={() => setSelectedDay(dayKey)} aria-label={`${dateFormatter(date)}: ${dayItems.length} registro(s)`}>
              <span className="absence-calendar-day-number">{date.getDate()}</span>
              <span className="absence-calendar-events">
                {dayItems.slice(0, 3).map((item) => <span key={item.id} className={`absence-calendar-event ${statusClass(item.status)} ${item.period !== 'DIA_TODO' && item.source === 'SOLICITAÇÃO' ? 'partial' : ''}`} title={`${item.employee} — ${item.title}`}><i />{item.employee.split(' ')[0]}</span>)}
                {dayItems.length > 3 ? <span className="absence-calendar-more">+{dayItems.length - 3} outros</span> : null}
              </span>
            </button>
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
        {!selectedDay ? <p className="small-muted">Clique em qualquer dia para ver quem estará ausente, o motivo e o período informado.</p> : !selectedItems.length ? <p className="small-muted">Nenhuma ausência ou atestado registrado neste dia.</p> : (
          <div className="absence-calendar-detail-list">
            {selectedItems.map((item) => (
              <div className="absence-calendar-detail-row" key={item.id}>
                <span className={`calendar-dot ${statusClass(item.status)}`} />
                <div className="absence-calendar-detail-main">
                  <strong>{item.employee}</strong>
                  <span>{item.employeeNumber || 'Sem matrícula'} · {item.title} · {periodLabel(item)}</span>
                  <small>{dateRange(item.start, item.end)}{item.subtitle ? ` · ${item.subtitle}` : ''}</small>
                </div>
                <span className={`status-pill ${statusClass(item.status)}`}>{statusLabel(item.status)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function dateFormatter(date: Date) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, dateStyle: 'full' }).format(date);
}

