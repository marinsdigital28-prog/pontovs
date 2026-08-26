'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { isScheduledDay, parseWorkDays } from '@/lib/timesheet-schedule';

type Employee = {
  id: string;
  name: string;
  employeeNumber: string | null;
  cpf?: string | null;
  jobTitle?: string | null;
  workDays?: string | null;
  scheduleStart?: string | null;
  scheduleEnd?: string | null;
};

type RecordItem = {
  id: string;
  type: string;
  timestamp: string;
  status: string;
  origin: string;
  user: {
    id: string;
    name: string;
    employeeNumber: string | null;
    cpf?: string | null;
    jobTitle: string | null;
  };
};

type DayRow = {
  date: string;
  weekday: string;
  punches: RecordItem[];
  worked: number | null;
  expected: number | null;
  balance: number | null;
  absent: boolean;
  late: boolean;
  schedule: string;
};

const typeLabels: Record<string, string> = { ENTRADA: 'ENTRADA', INTERVALO: 'INTERVALO', RETORNO: 'RETORNO', SAIDA: 'SAÍDA' };
const weekdayNames = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const weekdayCodes: Record<number, string> = { 0: 'DOM', 1: 'SEG', 2: 'TER', 3: 'QUA', 4: 'QUI', 5: 'SEX', 6: 'SÁB' };

function monthBounds(month: string) {
  const [year, value] = month.split('-').map(Number);
  const lastDay = new Date(year, value, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` };
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function formatDate(value: string) { return new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR'); }
function formatTime(value: string) { return new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
function formatMonth(month: string) {
  const [year, value] = month.split('-').map(Number);
  return new Date(year, value - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}
function minutesFromClock(value: string | null | undefined) {
  if (!value) return null;
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}
function formatMinutes(value: number | null) {
  if (value === null) return '—';
  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(Math.round(value));
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
}
function dayKey(value: string) { return value.slice(0, 10); }
function minutesBetween(start: string, end: string) { return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000)); }
function calculateWorked(punches: RecordItem[]) {
  const ordered = [...punches].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  let total = 0;
  const pairs: Array<[string, string]> = [];
  const entry = ordered.find((punch) => punch.type === 'ENTRADA');
  const interval = ordered.find((punch) => punch.type === 'INTERVALO' && entry && new Date(punch.timestamp) > new Date(entry.timestamp));
  const retorno = ordered.find((punch) => punch.type === 'RETORNO' && interval && new Date(punch.timestamp) > new Date(interval.timestamp));
  const saida = ordered.find((punch) => punch.type === 'SAIDA' && retorno && new Date(punch.timestamp) > new Date(retorno.timestamp));
  if (entry && interval) pairs.push([entry.timestamp, interval.timestamp]);
  if (retorno && saida) pairs.push([retorno.timestamp, saida.timestamp]);
  if (!pairs.length && ordered.length >= 2) pairs.push([ordered[0].timestamp, ordered[ordered.length - 1].timestamp]);
  for (const [start, end] of pairs) total += minutesBetween(start, end);
  return ordered.length ? total : null;
}

export default function FolhaPontoPanel({ employees }: { employees: Employee[] }) {
  const [month, setMonth] = useState(currentMonth());
  const [employeeId, setEmployeeId] = useState('');
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);

  const load = useCallback(async () => {
    const bounds = monthBounds(month);
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ ...bounds, status: 'VALID' });
    if (employeeId) params.set('employeeId', employeeId);
    try {
      const response = await fetch(`/api/admin/punches?${params.toString()}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Não foi possível carregar a folha de ponto.');
      setRecords(Array.isArray(data.records) ? data.records.sort((a: RecordItem, b: RecordItem) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()) : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar a folha de ponto.');
    } finally { setLoading(false); }
  }, [employeeId, month]);

  const signAndDownload = async () => {
    if (!selectedEmployee) return;
    setSigning(true);
    setError('');
    try {
      const response = await fetch('/api/admin/timesheet-pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ employeeId: selectedEmployee.id, month }) });
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || 'Não foi possível assinar a folha.'); }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `folha-${selectedEmployee.employeeNumber || selectedEmployee.id}-${month}-assinada.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível assinar a folha.'); }
    finally { setSigning(false); }
  };

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/signature', { cache: 'no-store' })
      .then(async (response) => { const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || ''); if (!cancelled) setSignatureData(data.signatureData || null); })
      .catch(() => { if (!cancelled) setSignatureData(null); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => { void load(); }, 10000);
    return () => window.clearInterval(timer);
  }, [load]);

  const selectedEmployee = useMemo(() => employees.find((employee) => employee.id === employeeId), [employeeId, employees]);
  const dayRows = useMemo<DayRow[]>(() => {
    if (!selectedEmployee) return [];
    const [year, monthNumber] = month.split('-').map(Number);
    const lastDay = new Date(year, monthNumber, 0).getDate();
    const hasSchedule = Boolean(selectedEmployee.scheduleStart && selectedEmployee.scheduleEnd);
    const workDays = selectedEmployee.workDays ? parseWorkDays(selectedEmployee.workDays) : new Set(['SEG', 'TER', 'QUA', 'QUI', 'SEX']);
    const scheduleStart = minutesFromClock(selectedEmployee.scheduleStart);
    const scheduleEnd = minutesFromClock(selectedEmployee.scheduleEnd);
    const scheduleSpan = hasSchedule && scheduleStart !== null && scheduleEnd !== null ? Math.max(0, scheduleEnd - scheduleStart) : null;
    const lunchMinutes = scheduleSpan !== null && scheduleSpan > 6 * 60 ? 60 : 0;
    const expectedMinutes = scheduleSpan === null ? null : Math.max(0, scheduleSpan - lunchMinutes);
    return Array.from({ length: lastDay }, (_, index) => {
      const date = `${month}-${String(index + 1).padStart(2, '0')}`;
      const dayPunches = records.filter((record) => dayKey(record.timestamp) === date);
      const weekday = new Date(`${date}T12:00:00`).getDay();
      const scheduled = isScheduledDay(workDays, weekdayCodes[weekday]);
      const worked = calculateWorked(dayPunches);
      const firstPunch = dayPunches[0];
      const firstPunchMinutes = firstPunch ? minutesFromClock(formatTime(firstPunch.timestamp)) : null;
      const late = Boolean(scheduled && firstPunchMinutes !== null && scheduleStart !== null && firstPunchMinutes > scheduleStart + 5);
      const configuredWorkday = scheduled && expectedMinutes !== null;
      const expected = configuredWorkday ? expectedMinutes : null;
      const balance = worked === null || expected === null ? null : worked - expected;
      const schedule = !scheduled ? 'Folga' : selectedEmployee.scheduleStart && selectedEmployee.scheduleEnd ? `${selectedEmployee.scheduleStart} às ${selectedEmployee.scheduleEnd} · ${lunchMinutes ? '1h de almoço' : 'meio expediente'}` : 'Escala sem horário';
      return { date, weekday: weekdayNames[weekday], punches: dayPunches, worked, expected, balance, absent: configuredWorkday && !dayPunches.length, late: configuredWorkday && late, schedule };
    });
  }, [employeeId, month, records, selectedEmployee]);

  const summary = useMemo(() => dayRows.reduce((total, row) => ({
    worked: total.worked + (row.worked ?? 0), expected: total.expected + (row.expected ?? 0), balance: total.balance + (row.balance ?? 0), absences: total.absences + (row.absent ? 1 : 0), late: total.late + (row.late ? 1 : 0),
  }), { worked: 0, expected: 0, balance: 0, absences: 0, late: 0 }), [dayRows]);

  return (
    <section className="card timesheet-panel">
      <div className="section-heading timesheet-toolbar no-print">
        <div><span className="eyebrow">FOLHA INDIVIDUAL</span><h2>Folha de ponto do colaborador</h2><p className="small-muted">Uma folha por colaborador · atualização automática a cada 10 segundos.</p></div>
        <div className="report-actions"><button type="button" className="ghost-btn" onClick={() => window.print()} disabled={!selectedEmployee}>Imprimir folha</button><button type="button" className="primary-btn compact-btn" onClick={() => void signAndDownload()} disabled={!selectedEmployee || signing}>{signing ? 'Assinando PDF...' : 'Assinar e baixar PDF'}</button><button type="button" className="ghost-btn" onClick={() => void load()} disabled={loading}>{loading ? 'Atualizando...' : 'Atualizar agora'}</button></div>
      </div>

      <div className="report-filters no-print">
        <label className="small-muted">Competência<input className="input" type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
        <label className="small-muted">Colaborador<select className="input" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}><option value="">Selecione um colaborador</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.employeeNumber || 'sem matrícula'} — {employee.name}</option>)}</select></label>
      </div>

      {error ? <div className="status-msg no-print">{error}</div> : null}
      {!selectedEmployee ? <div className="timesheet-empty">Selecione um colaborador para abrir a folha individual no modelo oficial.</div> : (
        <div className="timesheet-paper">
          <header className="timesheet-titlebar individual-titlebar"><div><strong>EP&nbsp;&nbsp; ESPAÇO PROGREDIR</strong><span>Estrada da Grama, 21 — Miguel Couto · Nova Iguaçu — RJ<br />CNPJ: 05.553.848/0001-61</span></div><div className="timesheet-competence"><b>RELATÓRIO DE PONTO DO COLABORADOR</b><span>Período: 01/{month.slice(5)}/{month.slice(0, 4)} a {monthBounds(month).to.slice(8)}/{month.slice(5)}/{month.slice(0, 4)}<br />{formatMonth(month).toUpperCase()}</span></div></header>
          <section className="employee-meta-grid"><span><b>Nome:</b> {selectedEmployee.name}</span><span><b>CPF:</b> {selectedEmployee.cpf || 'Não informado'}</span><span><b>Matrícula:</b> {selectedEmployee.employeeNumber || 'Não informada'}</span><span><b>Cargo:</b> {selectedEmployee.jobTitle || 'Não informado'}</span><span><b>Departamento:</b> Espaço Progredir</span><span><b>Unidade:</b> Espaço Progredir</span><span><b>Escala:</b> {selectedEmployee.workDays || 'Não informada'}</span><span><b>Jornada:</b> {selectedEmployee.scheduleStart || '08:00'} às {selectedEmployee.scheduleEnd || '17:00'}</span></section>
          <section className="timesheet-section individual-table-section"><table className="timesheet-table individual-timesheet-table"><thead><tr><th>Data</th><th>Horários (escala)</th><th>Marcações</th><th>H.Trab</th><th>H.Prev</th><th>Saldo</th><th>Desc.</th><th>Justificativa</th></tr></thead><tbody>{dayRows.map((row) => <tr key={row.date}><td>{String(Number(row.date.slice(8))).padStart(2, '0')} {row.weekday}</td><td>{row.schedule}</td><td>{row.punches.length ? row.punches.map((punch) => `${formatTime(punch.timestamp)} (${typeLabels[punch.type] || punch.type})`).join(' · ') : '—'}</td><td>{formatMinutes(row.worked)}</td><td>{formatMinutes(row.expected)}</td><td className={row.balance !== null && row.balance < 0 ? 'negative-balance' : ''}>{formatMinutes(row.balance)}</td><td>{row.absent ? 'FALTA' : row.late ? 'ATRASO' : ''}</td><td></td></tr>)}</tbody></table></section>
          <section className="timesheet-totals"><span><b>Total H. Positivo:</b> {formatMinutes(Math.max(summary.balance, 0))}</span><span><b>Total H. Negativo:</b> {formatMinutes(Math.min(summary.balance, 0))}</span><span><b>Total trabalhado:</b> {formatMinutes(summary.worked)}</span><span><b>Saldo de Horas:</b> {formatMinutes(summary.balance)}</span><span><b>Faltas:</b> {summary.absences}</span><span><b>Atrasos:</b> {summary.late}</span></section>
          <div className="signature-area"><div className="signature-block">{signatureData ? <img className="institution-signature" src={signatureData} alt="Assinatura digital do Espaço Progredir" /> : null}<div className="signature-line">Assinatura digital do Espaço Progredir</div><span className="signature-caption">Assinatura institucional</span></div></div>
        </div>
      )}
    </section>
  );
}
