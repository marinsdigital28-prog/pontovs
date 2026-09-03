'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type PunchRow = {
  id: string;
  type: string;
  timestamp: string;
  user?: { id: string; name: string; employeeNumber: string | null } | null;
};

const APP_TZ = 'America/Sao_Paulo';
const TYPE_LABEL: Record<string, string> = {
  ENTRADA: 'Entrada',
  INTERVALO: 'Intervalo',
  RETORNO: 'Retorno',
  SAIDA: 'Saída',
};
const WEEKDAYS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function dateKeyFromParts(y: number, m: number, d: number) {
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}

function brazilDateKey(iso: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso));
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${v.year}-${v.month}-${v.day}`;
}

function shortName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 2) return name;
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

function timeFmt(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: APP_TZ,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export default function OverviewCalendar() {
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return { year: n.getFullYear(), month: n.getMonth() };
  });
  const [punches, setPunches] = useState<PunchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const from = `${cursor.year}-${pad(cursor.month + 1)}-01`;
  const lastDay = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const to = `${cursor.year}-${pad(cursor.month + 1)}-${pad(lastDay)}`;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(
        `/api/admin/punches?from=${from}&to=${to}&status=VALID&type=ALL`,
        { cache: 'no-store' },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Não foi possível carregar o calendário');
      setPunches(Array.isArray(json.records) ? json.records : Array.isArray(json.punches) ? json.punches : []);
    } catch (e: any) {
      setError(e?.message || 'Erro ao carregar marcações');
      setPunches([]);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const byDay = useMemo(() => {
    const map = new Map<string, { people: Map<string, { name: string; mat: string; types: string[] }> }>();
    for (const p of punches) {
      if (!p.timestamp) continue;
      const key = brazilDateKey(p.timestamp);
      const userId = p.user?.id || 'unknown';
      const name = p.user?.name || 'Colaborador';
      const mat = p.user?.employeeNumber || '—';
      if (!map.has(key)) map.set(key, { people: new Map() });
      const day = map.get(key)!;
      if (!day.people.has(userId)) {
        day.people.set(userId, { name, mat, types: [] });
      }
      const person = day.people.get(userId)!;
      if (!person.types.includes(p.type)) person.types.push(p.type);
    }
    return map;
  }, [punches]);

  const cells = useMemo(() => {
    const firstWeekday = new Date(cursor.year, cursor.month, 1).getDay();
    const daysInMonth = lastDay;
    const list: Array<{ day: number | null; key: string | null }> = [];
    for (let i = 0; i < firstWeekday; i++) list.push({ day: null, key: null });
    for (let d = 1; d <= daysInMonth; d++) {
      list.push({ day: d, key: dateKeyFromParts(cursor.year, cursor.month, d) });
    }
    while (list.length % 7 !== 0) list.push({ day: null, key: null });
    return list;
  }, [cursor.year, cursor.month, lastDay]);

  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  });

  const todayKey = brazilDateKey(new Date().toISOString());
  const selectedPeople = selectedDay ? byDay.get(selectedDay)?.people : null;
  const selectedList = selectedPeople
    ? Array.from(selectedPeople.entries()).map(([id, v]) => ({ id, ...v }))
    : [];

  return (
    <div className="card overview-calendar">
      <div className="ov-cal-head">
        <div>
          <span className="eyebrow">AGENDA DE MARCAÇÕES</span>
          <h3 className="ov-cal-title">
            {monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1)}
          </h3>
          <p className="small-muted">Marcações de ponto dos colaboradores no mês</p>
        </div>
        <div className="ov-cal-nav">
          <button
            type="button"
            className="ghost-btn"
            onClick={() =>
              setCursor((c) => {
                const d = new Date(c.year, c.month - 1, 1);
                return { year: d.getFullYear(), month: d.getMonth() };
              })
            }
            aria-label="Mês anterior"
          >
            ‹
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => {
              const n = new Date();
              setCursor({ year: n.getFullYear(), month: n.getMonth() });
              setSelectedDay(brazilDateKey(n.toISOString()));
            }}
          >
            Hoje
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() =>
              setCursor((c) => {
                const d = new Date(c.year, c.month + 1, 1);
                return { year: d.getFullYear(), month: d.getMonth() };
              })
            }
            aria-label="Próximo mês"
          >
            ›
          </button>
          <button type="button" className="ghost-btn" onClick={() => void load()} disabled={loading}>
            {loading ? '…' : 'Atualizar'}
          </button>
        </div>
      </div>

      {error ? <p className="status-msg" role="alert">{error}</p> : null}

      <div className="ov-cal-weekdays">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>

      <div className="ov-cal-grid">
        {cells.map((cell, idx) => {
          if (!cell.day || !cell.key) {
            return <div key={`e-${idx}`} className="ov-cal-cell empty" />;
          }
          const dayData = byDay.get(cell.key);
          const people = dayData ? Array.from(dayData.people.values()) : [];
          const isToday = cell.key === todayKey;
          const isSelected = cell.key === selectedDay;
          return (
            <button
              key={cell.key}
              type="button"
              className={`ov-cal-cell ${people.length ? 'has' : ''} ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}`}
              onClick={() => setSelectedDay(cell.key)}
            >
              <span className="ov-cal-daynum">{cell.day}</span>
              <div className="ov-cal-pills">
                {people.slice(0, 3).map((person) => (
                  <span key={person.mat + person.name} className="ov-cal-pill" title={`${person.name} · ${person.types.map((t) => TYPE_LABEL[t] || t).join(', ')}`}>
                    {shortName(person.name)}
                  </span>
                ))}
                {people.length > 3 ? (
                  <span className="ov-cal-more">+{people.length - 3}</span>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>

      <div className="ov-cal-detail">
        {selectedDay ? (
          <>
            <div className="ov-cal-detail-head">
              <strong>
                {new Date(selectedDay + 'T12:00:00').toLocaleDateString('pt-BR', {
                  weekday: 'long',
                  day: '2-digit',
                  month: 'long',
                })}
              </strong>
              <span className="small-muted">
                {selectedList.length
                  ? `${selectedList.length} colaborador(es) com marcação`
                  : 'Sem marcações neste dia'}
              </span>
            </div>
            {selectedList.length ? (
              <ul className="ov-cal-detail-list">
                {selectedList.map((p) => {
                  const dayPunches = punches
                    .filter(
                      (x) =>
                        brazilDateKey(x.timestamp) === selectedDay &&
                        (x.user?.id === p.id || (!x.user && p.id === 'unknown')),
                    )
                    .sort(
                      (a, b) =>
                        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
                    );
                  return (
                    <li key={p.id}>
                      <div>
                        <strong>{p.name}</strong>
                        <small>Mat. {p.mat}</small>
                      </div>
                      <div className="ov-cal-times">
                        {dayPunches.map((x) => (
                          <span key={x.id} className={`ov-cal-type ov-cal-type-${x.type.toLowerCase()}`}>
                            {timeFmt(x.timestamp)} · {TYPE_LABEL[x.type] || x.type}
                          </span>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="small-muted">Clique em outro dia ou aguarde as batidas do totem.</p>
            )}
          </>
        ) : (
          <p className="small-muted">Selecione um dia para ver quem marcou ponto.</p>
        )}
      </div>
    </div>
  );
}
