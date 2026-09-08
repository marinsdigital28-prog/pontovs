'use client';

import { useMemo, useState } from 'react';
import './shifts-panel.css';

type Employee = {
  id: string;
  name: string;
  employeeNumber: string | null;
  cpf?: string | null;
  jobTitle?: string | null;
  workDays?: string | null;
  scheduleStart?: string | null;
  scheduleEnd?: string | null;
  active: boolean;
};

const WEEK = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM'] as const;
const WEEK_LABEL: Record<string, string> = {
  SEG: 'Seg', TER: 'Ter', QUA: 'Qua', QUI: 'Qui', SEX: 'Sex', SÁB: 'Sáb', DOM: 'Dom',
};

function parseDays(value?: string | null) {
  if (!value) return new Set<string>();
  return new Set(
    value
      .toUpperCase()
      .split(/[,;|\s]+/)
      .map((d) => d.trim())
      .filter(Boolean),
  );
}

function minutesOf(value?: string | null) {
  const m = value?.match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function formatSpan(start?: string | null, end?: string | null) {
  if (!start || !end) return 'Sem horário';
  return `${start.slice(0, 5)} – ${end.slice(0, 5)}`;
}

function hoursLabel(start?: string | null, end?: string | null) {
  const a = minutesOf(start);
  const b = minutesOf(end);
  if (a === null || b === null) return '—';
  const span = Math.max(0, b - a);
  const lunch = span > 6 * 60 ? 60 : 0;
  const net = span - lunch;
  return `${String(Math.floor(net / 60)).padStart(2, '0')}:${String(net % 60).padStart(2, '0')}h`;
}

export default function ShiftsPanel({
  employees,
  onEdit,
  onApplyPatterns,
  scheduleApplying,
}: {
  employees: Employee[];
  onEdit: (employee: Employee) => void;
  onApplyPatterns: () => void;
  scheduleApplying: boolean;
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'TODOS' | 'OK' | 'INCOMPLETO' | 'INATIVO'>('TODOS');

  const rows = useMemo(() => {
    return employees
      .map((e) => {
        const days = parseDays(e.workDays);
        const hasSchedule = Boolean(e.scheduleStart && e.scheduleEnd);
        const hasDays = days.size > 0;
        const incomplete = e.active && (!hasSchedule || !hasDays);
        return { ...e, days, hasSchedule, hasDays, incomplete };
      })
      .filter((e) => {
        const q = search.trim().toLowerCase();
        if (q) {
          const blob = `${e.name} ${e.employeeNumber || ''} ${e.jobTitle || ''}`.toLowerCase();
          if (!blob.includes(q)) return false;
        }
        if (filter === 'OK') return e.active && !e.incomplete;
        if (filter === 'INCOMPLETO') return e.incomplete;
        if (filter === 'INATIVO') return !e.active;
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [employees, filter, search]);

  const stats = useMemo(() => {
    const active = employees.filter((e) => e.active);
    const withFull = active.filter((e) => e.scheduleStart && e.scheduleEnd && parseDays(e.workDays).size > 0);
    const incomplete = active.length - withFull.length;
    const patterns = new Map<string, number>();
    for (const e of active) {
      const key = formatSpan(e.scheduleStart, e.scheduleEnd);
      patterns.set(key, (patterns.get(key) || 0) + 1);
    }
    const topPatterns = [...patterns.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const dayCoverage = WEEK.map((d) => ({
      day: d,
      count: active.filter((e) => parseDays(e.workDays).has(d)).length,
    }));
    return { active: active.length, withFull: withFull.length, incomplete, topPatterns, dayCoverage };
  }, [employees]);

  return (
    <section className="shifts-panel">
      <div className="shifts-hero card">
        <div>
          <span className="eyebrow">OPERAÇÃO · ESCALAS</span>
          <h2>Turnos e jornada</h2>
          <p className="small-muted">Visão da cobertura semanal, padrões de horário e quem ainda precisa de escala definida.</p>
        </div>
        <div className="row-actions">
          <button className="ghost-btn" type="button" onClick={onApplyPatterns} disabled={scheduleApplying}>
            {scheduleApplying ? 'Aplicando…' : 'Aplicar padrões'}
          </button>
        </div>
      </div>

      <div className="shifts-kpis">
        <div className="shifts-kpi card"><span>Ativos</span><strong>{stats.active}</strong></div>
        <div className="shifts-kpi card ok"><span>Escala completa</span><strong>{stats.withFull}</strong></div>
        <div className="shifts-kpi card warn"><span>Incompletos</span><strong>{stats.incomplete}</strong></div>
        <div className="shifts-kpi card"><span>Padrões de horário</span><strong>{stats.topPatterns.length}</strong></div>
      </div>

      <div className="shifts-grid-2">
        <div className="card shifts-coverage">
          <div className="section-heading"><div><span className="eyebrow">COBERTURA DA SEMANA</span><h3>Quem trabalha em cada dia</h3></div></div>
          <div className="shifts-week-bars">
            {stats.dayCoverage.map((d) => {
              const pct = stats.active ? Math.round((d.count / stats.active) * 100) : 0;
              return (
                <div key={d.day} className="shifts-week-row">
                  <span>{WEEK_LABEL[d.day]}</span>
                  <div className="shifts-bar-track"><div className="shifts-bar-fill" style={{ width: `${pct}%` }} /></div>
                  <strong>{d.count}</strong>
                </div>
              );
            })}
          </div>
        </div>
        <div className="card shifts-patterns">
          <div className="section-heading"><div><span className="eyebrow">PADRÕES</span><h3>Horários mais usados</h3></div></div>
          {!stats.topPatterns.length ? <p className="small-muted">Nenhum horário cadastrado ainda.</p> : (
            <ul className="shifts-pattern-list">
              {stats.topPatterns.map(([label, count]) => (
                <li key={label}>
                  <div><strong>{label}</strong><span className="small-muted">{count} colaborador(es)</span></div>
                  <b>{stats.active ? Math.round((count / stats.active) * 100) : 0}%</b>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="card shifts-table-card">
        <div className="section-heading"><div><span className="eyebrow">EQUIPE</span><h3>Jornadas individuais</h3></div></div>
        <div className="shifts-toolbar">
          <input className="input" placeholder="Buscar nome, matrícula ou cargo" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="shifts-filters">
            {([['TODOS', 'Todos'], ['OK', 'Completos'], ['INCOMPLETO', 'Incompletos'], ['INATIVO', 'Inativos']] as const).map(([key, label]) => (
              <button key={key} type="button" className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}>{label}</button>
            ))}
          </div>
        </div>
        <div className="shifts-table">
          <div className="shifts-table-head">
            <span>Colaborador</span><span>Dias</span><span>Jornada</span><span>Carga</span><span>Status</span><span />
          </div>
          {rows.map((e) => (
            <div className={`shifts-table-row ${e.incomplete ? 'is-incomplete' : ''} ${!e.active ? 'is-inactive' : ''}`} key={e.id}>
              <div className="shifts-person">
                <strong title={e.name}>{e.name}</strong>
                <small>{e.employeeNumber || 'Sem matrícula'}{e.jobTitle ? ` · ${e.jobTitle}` : ''}</small>
              </div>
              <div className="shifts-days">
                {WEEK.map((d) => (
                  <i key={d} className={e.days.has(d) ? 'on' : ''} title={WEEK_LABEL[d]}>{WEEK_LABEL[d][0]}</i>
                ))}
              </div>
              <span className="shifts-hours">{formatSpan(e.scheduleStart, e.scheduleEnd)}</span>
              <span className="shifts-load">{hoursLabel(e.scheduleStart, e.scheduleEnd)}</span>
              <span className={`status-pill ${!e.active ? 'off' : e.incomplete ? 'warn' : 'ok'}`}>
                {!e.active ? 'Inativo' : e.incomplete ? 'Incompleto' : 'OK'}
              </span>
              <button type="button" className="ghost-btn compact-btn" onClick={() => onEdit(e)}>Editar</button>
            </div>
          ))}
          {!rows.length ? <p className="small-muted shifts-empty">Nenhum colaborador neste filtro.</p> : null}
        </div>
      </div>
    </section>
  );
}
