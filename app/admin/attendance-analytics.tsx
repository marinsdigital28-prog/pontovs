'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type Employee = { id: string; name: string; employeeNumber: string | null };
type Daily = { date: string; day: string; scheduled: number; present: number; absent: number; off: number; punctual: number; punctualityEvaluated: number; late: number; averageDelayMinutes: number | null };
type AnalyticsData = { from: string; to: string; daily: Daily[]; summary: { scheduledDays: number; presentDays: number; absentDays: number; punctualArrivals: number; punctualityEvaluated: number; lateArrivals: number; attendanceRate: number | null; punctualityRate: number | null; averageDelayMinutes: number | null } };

function localDateString(date = new Date()) {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 10);
}

function monthStart(date = new Date()) {
  return `${localDateString(date).slice(0, 7)}-01`;
}

function formatDay(date: string) {
  return new Date(`${date}T12:00:00-03:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function percentage(value: number | null) {
  return value === null ? '—' : `${value.toLocaleString('pt-BR')}%`;
}

function buildScale(length: number, max: number) {
  return Math.max(1, Math.ceil(Math.max(length, max) / 5));
}

export default function AttendanceAnalytics({ employees }: { employees: Employee[] }) {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(localDateString());
  const [employeeId, setEmployeeId] = useState('');
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ from, to });
    if (employeeId) params.set('employeeId', employeeId);
    try {
      const response = await fetch(`/api/admin/attendance-analytics?${params.toString()}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar os gráficos.');
      setData(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os gráficos.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [from, to, employeeId]);

  useEffect(() => { void load(); }, [load]);

  const presenceMax = useMemo(() => Math.max(1, ...(data?.daily || []).map((item) => item.scheduled)), [data]);
  const punctualMax = useMemo(() => Math.max(1, ...(data?.daily || []).map((item) => item.punctualityEvaluated)), [data]);
  const labelStep = useMemo(() => buildScale(data?.daily.length || 0, 12), [data]);

  return <section className="card analytics-panel">
    <div className="section-heading analytics-heading">
      <div><span className="eyebrow">ANÁLISE DA EQUIPE</span><h2>Presença e pontualidade</h2><p className="small-muted">Indicadores calculados pelas escalas e marcações válidas do sistema.</p></div>
      <div className="analytics-filters"><label className="small-muted">De<input className="input" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label className="small-muted">Até<input className="input" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><label className="small-muted">Colaborador<select className="input" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}><option value="">Toda a equipe</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.employeeNumber || 'sem matrícula'} — {employee.name}</option>)}</select></label></div>
    </div>
    {loading ? <p className="small-muted analytics-loading">Calculando com os registros do sistema...</p> : null}
    {error ? <div className="status-msg">{error}</div> : null}
    {!loading && !error && data ? <>
      <div className="analytics-summary"><div className="analytics-kpi"><span>Presença na escala</span><strong>{percentage(data.summary.attendanceRate)}</strong><small>{data.summary.presentDays} de {data.summary.scheduledDays} dias previstos</small></div><div className="analytics-kpi"><span>Pontualidade</span><strong>{percentage(data.summary.punctualityRate)}</strong><small>{data.summary.punctualArrivals} chegadas no horário</small></div><div className="analytics-kpi"><span>Atrasos</span><strong>{data.summary.lateArrivals}</strong><small>{data.summary.averageDelayMinutes === null ? 'Sem atraso calculável' : `média de ${data.summary.averageDelayMinutes} min`}</small></div><div className="analytics-kpi"><span>Faltas na escala</span><strong>{data.summary.absentDays}</strong><small>dias sem entrada válida</small></div></div>
      {!data.daily.length ? <div className="analytics-empty"><strong>Sem dados no período</strong><span>Escolha outro intervalo ou confira se as marcações foram importadas.</span></div> : <div className="analytics-charts">
        <div className="chart-card"><div className="chart-title"><div><h3>Presença por dia</h3><p className="small-muted">Comparação entre dias previstos, presentes e faltas.</p></div><div className="chart-legend"><span><i className="legend-dot present" />Presente</span><span><i className="legend-dot absent" />Falta</span></div></div><svg className="analytics-chart" viewBox="0 0 760 235" role="img" aria-label="Gráfico de presença por dia"><line x1="46" y1="190" x2="744" y2="190" className="chart-axis" />{data.daily.map((item, index) => { const slot = 698 / data.daily.length; const width = Math.max(5, slot * .62); const x = 46 + index * slot + (slot - width) / 2; const presentHeight = (item.present / presenceMax) * 164; const absentHeight = (item.absent / presenceMax) * 164; const base = 190; return <g key={item.date}><rect x={x} y={base - presentHeight} width={width} height={presentHeight} rx="3" className="bar-present"><title>{`${formatDay(item.date)}: ${item.present} presente(s)`}</title></rect><rect x={x} y={base - presentHeight - absentHeight} width={width} height={absentHeight} rx="3" className="bar-absent"><title>{`${formatDay(item.date)}: ${item.absent} falta(s)`}</title></rect>{index % labelStep === 0 ? <text x={x + width / 2} y="211" textAnchor="middle" className="chart-label">{formatDay(item.date)}</text> : null}</g>; })}<text x="8" y="30" className="chart-scale">{presenceMax}</text><text x="12" y="194" className="chart-scale">0</text></svg></div>
        <div className="chart-card"><div className="chart-title"><div><h3>Pontualidade por dia</h3><p className="small-muted">Entradas no horário comparadas aos atrasos.</p></div><div className="chart-legend"><span><i className="legend-dot punctual" />No horário</span><span><i className="legend-dot late" />Atraso</span></div></div><svg className="analytics-chart" viewBox="0 0 760 235" role="img" aria-label="Gráfico de pontualidade por dia"><line x1="46" y1="190" x2="744" y2="190" className="chart-axis" />{data.daily.map((item, index) => { const slot = 698 / data.daily.length; const width = Math.max(5, slot * .62); const x = 46 + index * slot + (slot - width) / 2; const punctualHeight = (item.punctual / punctualMax) * 164; const lateHeight = (item.late / punctualMax) * 164; const base = 190; return <g key={item.date}><rect x={x} y={base - punctualHeight} width={width} height={punctualHeight} rx="3" className="bar-punctual"><title>{`${formatDay(item.date)}: ${item.punctual} no horário`}</title></rect><rect x={x} y={base - punctualHeight - lateHeight} width={width} height={lateHeight} rx="3" className="bar-late"><title>{`${formatDay(item.date)}: ${item.late} atraso(s)`}</title></rect>{index % labelStep === 0 ? <text x={x + width / 2} y="211" textAnchor="middle" className="chart-label">{formatDay(item.date)}</text> : null}</g>; })}<text x="8" y="30" className="chart-scale">{punctualMax}</text><text x="12" y="194" className="chart-scale">0</text></svg></div>
      </div>}
      <p className="analytics-note">A pontualidade só é calculada quando existe uma entrada válida e um horário de início cadastrado. Dias fora da escala não entram como falta.</p>
    </> : null}
  </section>;
}
