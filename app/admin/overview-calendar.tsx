'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type PunchRow = {
  id: string;
  type: string;
  timestamp: string;
  user?: { id: string; name: string; employeeNumber: string | null } | null;
};

type LayerItem = {
  id: string;
  kind: 'atestado' | 'ausencia';
  name: string;
  mat: string;
  label: string;
  start: string;
  end: string;
};

const APP_TZ = 'America/Sao_Paulo';
const TYPE_LABEL: Record<string, string> = {
  ENTRADA: 'Entrada',
  INTERVALO: 'Intervalo',
  RETORNO: 'Retorno',
  SAIDA: 'Saída',
};
const WEEKDAYS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
const ABSENCE_TYPES = new Set([
  'AUSENCIA',
  'PASSEIO',
  'EVENTO_EXTERNO',
  'ESQUECI_PONTO',
  'AVISO_ATRASO',
  'TROCA_DIA',
]);

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

function eachDayKey(startIso: string, endIso: string, monthFrom: string, monthTo: string) {
  const keys: string[] = [];
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return keys;
  const cur = new Date(start);
  cur.setHours(12, 0, 0, 0);
  const endT = new Date(end);
  endT.setHours(12, 0, 0, 0);
  let guard = 0;
  while (cur <= endT && guard < 62) {
    const key = brazilDateKey(cur.toISOString());
    if (key >= monthFrom && key <= monthTo) keys.push(key);
    cur.setDate(cur.getDate() + 1);
    guard += 1;
  }
  return keys;
}

export default function OverviewCalendar() {
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return { year: n.getFullYear(), month: n.getMonth() };
  });
  const [punches, setPunches] = useState<PunchRow[]>([]);
  const [layers, setLayers] = useState<LayerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [showPunches, setShowPunches] = useState(true);
  const [showCerts, setShowCerts] = useState(true);
  const [showAbsences, setShowAbsences] = useState(true);

  const from = `${cursor.year}-${pad(cursor.month + 1)}-01`;
  const lastDay = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const to = `${cursor.year}-${pad(cursor.month + 1)}-${pad(lastDay)}`;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [pRes, cRes, rRes] = await Promise.all([
        fetch(`/api/admin/punches?from=${from}&to=${to}&status=VALID&type=ALL`, { cache: 'no-store' }),
        fetch('/api/admin/certificates', { cache: 'no-store' }),
        fetch('/api/admin/requests', { cache: 'no-store' }),
      ]);
      const pJson = await pRes.json().catch(() => ({}));
      if (!pRes.ok) throw new Error(pJson.error || 'Não foi possível carregar o calendário');
      setPunches(Array.isArray(pJson.records) ? pJson.records : Array.isArray(pJson.punches) ? pJson.punches : []);

      const nextLayers: LayerItem[] = [];
      const cJson = await cRes.json().catch(() => ({}));
      const certs = Array.isArray(cJson.certificates) ? cJson.certificates : Array.isArray(cJson.items) ? cJson.items : [];
      for (const c of certs) {
        if (String(c.status || '').toUpperCase() === 'CANCELADO') continue;
        const name = c.user?.name || c.employee?.name || 'Colaborador';
        const mat = c.user?.employeeNumber || c.employee?.employeeNumber || '—';
        nextLayers.push({
          id: `cert-${c.id}`,
          kind: 'atestado',
          name,
          mat,
          label: c.type || 'Atestado',
          start: c.startDate,
          end: c.endDate || c.startDate,
        });
      }

      const rJson = await rRes.json().catch(() => ({}));
      const reqs = Array.isArray(rJson.requests) ? rJson.requests : [];
      for (const r of reqs) {
        if (!ABSENCE_TYPES.has(String(r.type || '').toUpperCase())) continue;
        if (String(r.status || '').toUpperCase() === 'REJEITADO') continue;
        nextLayers.push({
          id: `req-${r.id}`,
          kind: 'ausencia',
          name: r.employee?.name || 'Colaborador',
          mat: r.employee?.employeeNumber || '—',
          label: r.classification || r.type || 'Ausência',
          start: r.startDate,
          end: r.endDate || r.startDate,
        });
      }
      setLayers(nextLayers);
    } catch (e: any) {
      setError(e?.message || 'Erro ao carregar marcações');
      setPunches([]);
      setLayers([]);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const byDay = useMemo(() => {
    const map = new Map<
      string,
      {
        people: Map<string, { name: string; mat: string; types: string[] }>;
        layers: LayerItem[];
      }
    >();
    if (showPunches) {
      for (const p of punches) {
        if (!p.timestamp) continue;
        const key = brazilDateKey(p.timestamp);
        const userId = p.user?.id || 'unknown';
        const name = p.user?.name || 'Colaborador';
        const mat = p.user?.employeeNumber || '—';
        if (!map.has(key)) map.set(key, { people: new Map(), layers: [] });
        const day = map.get(key)!;
        if (!day.people.has(userId)) day.people.set(userId, { name, mat, types: [] });
        const person = day.people.get(userId)!;
        if (!person.types.includes(p.type)) person.types.push(p.type);
      }
    }
    for (const layer of layers) {
      if (layer.kind === 'atestado' && !showCerts) continue;
      if (layer.kind === 'ausencia' && !showAbsences) continue;
      for (const key of eachDayKey(layer.start, layer.end, from, to)) {
        if (!map.has(key)) map.set(key, { people: new Map(), layers: [] });
        map.get(key)!.layers.push(layer);
      }
    }
    return map;
  }, [punches, layers, showPunches, showCerts, showAbsences, from, to]);

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
  const selected = selectedDay ? byDay.get(selectedDay) : null;
  const selectedList = selected
    ? Array.from(selected.people.entries()).map(([id, v]) => ({ id, ...v }))
    : [];
  const selectedLayers = selected?.layers || [];

  return (
    <div className="card overview-calendar">
      <div className="ov-cal-head">
        <div>
          <span className="eyebrow">AGENDA DE MARCAÇÕES</span>
          <h3 className="ov-cal-title">{monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1)}</h3>
          <p className="small-muted">Ponto + atestados + ausências no mês</p>
        </div>
        <div className="ov-cal-nav">
          <button type="button" className="ghost-btn" onClick={() => setCursor((c) => { const d = new Date(c.year, c.month - 1, 1); return { year: d.getFullYear(), month: d.getMonth() }; })} aria-label="Mês anterior">‹</button>
          <button type="button" className="ghost-btn" onClick={() => { const n = new Date(); setCursor({ year: n.getFullYear(), month: n.getMonth() }); setSelectedDay(brazilDateKey(n.toISOString())); }}>Hoje</button>
          <button type="button" className="ghost-btn" onClick={() => setCursor((c) => { const d = new Date(c.year, c.month + 1, 1); return { year: d.getFullYear(), month: d.getMonth() }; })} aria-label="Próximo mês">›</button>
          <button type="button" className="ghost-btn" onClick={() => void load()} disabled={loading}>{loading ? '…' : 'Atualizar'}</button>
        </div>
      </div>

      <div className="ov-cal-layers">
        <label><input type="checkbox" checked={showPunches} onChange={(e) => setShowPunches(e.target.checked)} /> Ponto</label>
        <label><input type="checkbox" checked={showCerts} onChange={(e) => setShowCerts(e.target.checked)} /> Atestados</label>
        <label><input type="checkbox" checked={showAbsences} onChange={(e) => setShowAbsences(e.target.checked)} /> Ausências</label>
      </div>

      {error ? <p className="status-msg" role="alert">{error}</p> : null}

      <div className="ov-cal-weekdays">{WEEKDAYS.map((w) => <span key={w}>{w}</span>)}</div>

      <div className="ov-cal-grid">
        {cells.map((cell, idx) => {
          if (!cell.day || !cell.key) return <div key={`e-${idx}`} className="ov-cal-cell empty" />;
          const dayData = byDay.get(cell.key);
          const people = dayData ? Array.from(dayData.people.values()) : [];
          const dayLayers = dayData?.layers || [];
          const isToday = cell.key === todayKey;
          const isSelected = cell.key === selectedDay;
          const has = people.length > 0 || dayLayers.length > 0;
          return (
            <button key={cell.key} type="button" className={`ov-cal-cell ${has ? 'has' : ''} ${dayLayers.some((l) => l.kind === 'atestado') ? 'has-cert' : ''} ${dayLayers.some((l) => l.kind === 'ausencia') ? 'has-abs' : ''} ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}`} onClick={() => setSelectedDay(cell.key)}>
              <span className="ov-cal-daynum">{cell.day}</span>
              <div className="ov-cal-pills">
                {people.slice(0, 2).map((person) => (
                  <span key={person.mat + person.name} className="ov-cal-pill" title={`${person.name} · ${person.types.map((t) => TYPE_LABEL[t] || t).join(', ')}`}>{shortName(person.name)}</span>
                ))}
                {dayLayers.slice(0, 2).map((l) => (
                  <span key={l.id} className={`ov-cal-pill ov-cal-pill-${l.kind}`} title={`${l.name} · ${l.label}`}>{l.kind === 'atestado' ? 'Atest.' : 'Aus.'} {shortName(l.name)}</span>
                ))}
                {people.length + dayLayers.length > 4 ? <span className="ov-cal-more">+{people.length + dayLayers.length - 4}</span> : null}
              </div>
            </button>
          );
        })}
      </div>

      <div className="ov-cal-detail">
        {selectedDay ? (
          <>
            <div className="ov-cal-detail-head">
              <strong>{new Date(selectedDay + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}</strong>
              <span className="small-muted">{selectedList.length} com ponto · {selectedLayers.length} atestado/ausência</span>
            </div>
            {selectedLayers.length ? (
              <ul className="ov-cal-detail-list">
                {selectedLayers.map((l) => (
                  <li key={l.id}><div><strong>{l.kind === 'atestado' ? 'Atestado' : 'Ausência'} · {l.name}</strong><small>Mat. {l.mat} · {l.label}</small></div></li>
                ))}
              </ul>
            ) : null}
            {selectedList.length ? (
              <ul className="ov-cal-detail-list">
                {selectedList.map((p) => {
                  const dayPunches = punches.filter((x) => brazilDateKey(x.timestamp) === selectedDay && (x.user?.id === p.id || (!x.user && p.id === 'unknown'))).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
                  return (
                    <li key={p.id}>
                      <div><strong>{p.name}</strong><small>Mat. {p.mat}</small></div>
                      <div className="ov-cal-times">{dayPunches.map((x) => (<span key={x.id} className={`ov-cal-type ov-cal-type-${x.type.toLowerCase()}`}>{timeFmt(x.timestamp)} · {TYPE_LABEL[x.type] || x.type}</span>))}</div>
                    </li>
                  );
                })}
              </ul>
            ) : !selectedLayers.length ? (
              <p className="small-muted">Sem registros neste dia.</p>
            ) : null}
          </>
        ) : (
          <p className="small-muted">Selecione um dia para ver quem marcou ponto, atestados e ausências.</p>
        )}
      </div>
    </div>
  );
}
