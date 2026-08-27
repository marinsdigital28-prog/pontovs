'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { isScheduledDay, parseWorkDays } from '@/lib/timesheet-schedule';
import { resolveDaySchedule } from '@/lib/day-schedule';

type Employee = {
  id: string;
  name: string;
  employeeNumber: string | null;
  cpf?: string | null;
  jobTitle?: string | null;
  workDays?: string | null;
  scheduleStart?: string | null;
  scheduleEnd?: string | null;
  scheduleByDay?: string | null;
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
  justified: number | null;
  missing: number | null;
  surplus: number | null;
  balance: number | null;
  absent: boolean;
  late: boolean;
  certificate: boolean;
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

type CertificateItem = { userId: string; type?: string; startDate: string; endDate: string; startTime?: string | null; endTime?: string | null; hoursPerDayMinutes?: number | null; status: string };
function certificateMinutesForDay(item: CertificateItem, date: string, scheduleStart: number, scheduleEnd: number, fullDay: boolean, expected: number | null) {
  if (!['APROVADO', 'ATIVO'].includes(item.status) || item.startDate.slice(0, 10) > date || item.endDate.slice(0, 10) < date || expected === null) return 0;
  if (!item.startTime || !item.endTime) return expected;
  const [startHour, startMinute] = item.startTime.split(':').map(Number);
  const [endHour, endMinute] = item.endTime.split(':').map(Number);
  const start = Math.max(scheduleStart, startHour * 60 + startMinute);
  const end = Math.min(scheduleEnd, endHour * 60 + endMinute);
  if (end <= start) return 0;
  let minutes = end - start;
  if (fullDay) minutes -= Math.max(0, Math.min(end, 13 * 60) - Math.max(start, 12 * 60));
  return Math.min(expected, Math.max(0, minutes));
}
type ApprovedRequest = { employeeId: string; type: 'AUSENCIA' | 'TROCA_DIA'; status: string; startDate: string; endDate: string; reason: string };

function buildDayRows(employee: Employee, records: RecordItem[], month: string, certificates: CertificateItem[], requests: ApprovedRequest[]): DayRow[] {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  const hasSchedule = Boolean(employee.scheduleStart && employee.scheduleEnd);
  const workDays = employee.workDays ? parseWorkDays(employee.workDays) : new Set(['SEG', 'TER', 'QUA', 'QUI', 'SEX']);
  const scheduleStart = minutesFromClock(employee.scheduleStart);
  const scheduleEnd = minutesFromClock(employee.scheduleEnd);
  const scheduleSpan = hasSchedule && scheduleStart !== null && scheduleEnd !== null ? Math.max(0, scheduleEnd - scheduleStart) : null;
  const lunchMinutes = scheduleSpan !== null && scheduleSpan > 6 * 60 ? 60 : 0;
  const expectedMinutes = scheduleSpan === null ? null : Math.max(0, scheduleSpan - lunchMinutes);
  return Array.from({ length: lastDay }, (_, index) => {
    const date = `${month}-${String(index + 1).padStart(2, '0')}`;
    const dayPunches = records.filter((record) => record.user.id === employee.id && dayKey(record.timestamp) === date);
    const weekday = new Date(`${date}T12:00:00`).getDay();
    const daySchedule = resolveDaySchedule(employee.scheduleByDay, employee.workDays, employee.scheduleStart, employee.scheduleEnd, weekday);
    const scheduled = Boolean(daySchedule) && isScheduledDay(workDays, weekdayCodes[weekday]);
    const worked = calculateWorked(dayPunches);
    const firstPunch = dayPunches[0];
    const firstPunchMinutes = firstPunch ? minutesFromClock(formatTime(firstPunch.timestamp)) : null;
    const late = Boolean(scheduled && firstPunchMinutes !== null && scheduleStart !== null && firstPunchMinutes > scheduleStart + 5);
    const dayExpectedMinutes = daySchedule ? Math.max(0, minutesFromClock(daySchedule.end)! - minutesFromClock(daySchedule.start)! - (daySchedule.mode === 'FULL' ? 60 : 0)) : null;
    const configuredWorkday = scheduled && dayExpectedMinutes !== null;
    const certificate = certificates.find((item) => item.userId === employee.id && item.startDate.slice(0, 10) <= date && item.endDate.slice(0, 10) >= date);
    const approvedRequest = requests.find((item) => item.employeeId === employee.id && item.status === 'APROVADO' && ((item.type === 'AUSENCIA' && item.startDate.slice(0, 10) <= date && item.endDate.slice(0, 10) >= date) || (item.type === 'TROCA_DIA' && (item.startDate.slice(0, 10) === date || item.endDate.slice(0, 10) === date))));
    const expected = configuredWorkday ? dayExpectedMinutes : null;
    const dayStart = daySchedule ? minutesFromClock(daySchedule.start) : scheduleStart;
    const dayEnd = daySchedule ? minutesFromClock(daySchedule.end) : scheduleEnd;
    const justifiedByCertificate = certificate && dayStart !== null && dayEnd !== null ? certificateMinutesForDay(certificate, date, dayStart, dayEnd, daySchedule?.mode === 'FULL', expected) : 0;
    const justifiedByRequest = approvedRequest?.type === 'AUSENCIA' ? expected || 0 : 0;
    const justified = Math.max(justifiedByCertificate, justifiedByRequest);
    const considered = worked === null ? justified : worked + justified;
    const missing = expected === null || considered === null ? null : Math.max(0, expected - considered);
    const surplus = expected === null || considered === null ? null : Math.max(0, considered - expected);
    const balance = considered === null || expected === null ? null : considered - expected;
    const schedule = !scheduled ? 'Folga' : daySchedule ? `${daySchedule.start} às ${daySchedule.end} · ${daySchedule.mode === 'FULL' ? '1h de almoço' : 'meio expediente'}` : 'Escala sem horário';
    const covered = justified > 0 || Boolean(approvedRequest?.type === 'AUSENCIA');
    return { date, weekday: weekdayNames[weekday], punches: dayPunches, worked, expected, justified, missing, surplus, balance, absent: configuredWorkday && !dayPunches.length && !covered, late: configuredWorkday && late && !covered, certificate: covered, schedule: approvedRequest?.type === 'TROCA_DIA' ? `${schedule} · troca aprovada` : certificate?.status === 'PENDENTE' ? `${schedule} · atestado pendente` : schedule };
  });
}

export default function FolhaPontoPanel({ employees }: { employees: Employee[] }) {
  const [month, setMonth] = useState(currentMonth());
  const [employeeId, setEmployeeId] = useState('');
  const allEmployeesValue = '__ALL__';
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [certificates, setCertificates] = useState<CertificateItem[]>([]);
  const [requests, setRequests] = useState<ApprovedRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);

  const load = useCallback(async () => {
    const bounds = monthBounds(month);
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ ...bounds, status: 'VALID' });
    if (employeeId && employeeId !== allEmployeesValue) params.set('employeeId', employeeId);
    try {
      const response = await fetch(`/api/admin/punches?${params.toString()}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Não foi possível carregar a folha de ponto.');
      setRecords(Array.isArray(data.records) ? data.records.sort((a: RecordItem, b: RecordItem) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()) : []);
      const [certificateResponse, requestResponse] = await Promise.all([fetch('/api/admin/certificates', { cache: 'no-store' }), fetch('/api/admin/requests', { cache: 'no-store' })]);
      const certificateData = await certificateResponse.json().catch(() => ({}));
      const requestData = await requestResponse.json().catch(() => ({}));
      setCertificates(Array.isArray(certificateData.certificates) ? certificateData.certificates : []);
      setRequests(Array.isArray(requestData.requests) ? requestData.requests : []);
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

  useEffect(() => { void load(); const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 15000); const onFocus = () => void load(); window.addEventListener('focus', onFocus); return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus); }; }, [load]);
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
  const visibleEmployees = useMemo(() => employeeId === allEmployeesValue ? employees : selectedEmployee ? [selectedEmployee] : [], [allEmployeesValue, employeeId, employees, selectedEmployee]);
  const dayRowsByEmployee = useMemo(() => new Map(visibleEmployees.map((employee) => [employee.id, buildDayRows(employee, records, month, certificates, requests)])), [month, records, certificates, requests, visibleEmployees]);
  const dayRows = selectedEmployee ? (dayRowsByEmployee.get(selectedEmployee.id) || []) : [];

  const summary = useMemo(() => dayRows.reduce((total, row) => ({
    worked: total.worked + (row.worked ?? 0), expected: total.expected + (row.expected ?? 0), balance: total.balance + (row.balance ?? 0), absences: total.absences + (row.absent ? 1 : 0), late: total.late + (row.late ? 1 : 0),
  }), { worked: 0, expected: 0, balance: 0, absences: 0, late: 0 }), [dayRows]);

  return (
    <section className="card timesheet-panel">
      <div className="section-heading timesheet-toolbar no-print">
        <div><span className="eyebrow">FOLHA INDIVIDUAL</span><h2>Folha de ponto do colaborador</h2><p className="small-muted">Uma folha por colaborador ou todas em sequência · atualização automática a cada 10 segundos.</p></div>
        <div className="report-actions"><button type="button" className="ghost-btn" onClick={() => window.print()} disabled={!visibleEmployees.length}>Imprimir {employeeId === allEmployeesValue ? 'todas as folhas' : 'folha'}</button><button type="button" className="primary-btn compact-btn" onClick={() => void signAndDownload()} disabled={!selectedEmployee || signing}>{signing ? 'Assinando PDF...' : 'Assinar e baixar PDF individual'}</button><button type="button" className="ghost-btn" onClick={() => void load()} disabled={loading}>{loading ? 'Atualizando...' : 'Atualizar agora'}</button></div>
      </div>

      <div className="report-filters no-print">
        <label className="small-muted">Competência<input className="input" type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
        <label className="small-muted">Colaborador<select className="input" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}><option value="">Selecione um colaborador</option><option value={allEmployeesValue}>Todos os colaboradores ({employees.length})</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.employeeNumber || 'sem matrícula'} — {employee.name}</option>)}</select></label>
      </div>

      {error ? <div className="status-msg no-print">{error}</div> : null}
      {!visibleEmployees.length ? <div className="timesheet-empty">Selecione um colaborador ou “Todos os colaboradores” para abrir as folhas no modelo oficial.</div> : (
        <div className={employeeId === allEmployeesValue ? 'timesheet-batch' : ''}>{visibleEmployees.map((employee) => {
          const rows = dayRowsByEmployee.get(employee.id) || [];
          const totals = rows.reduce((total, row) => ({ worked: total.worked + (row.worked ?? 0), expected: total.expected + (row.expected ?? 0), balance: total.balance + (row.balance ?? 0), absences: total.absences + (row.absent ? 1 : 0), late: total.late + (row.late ? 1 : 0) }), { worked: 0, expected: 0, balance: 0, absences: 0, late: 0 });
          return <div className="timesheet-paper" key={employee.id}>
          <header className="timesheet-titlebar individual-titlebar"><div><strong>EP&nbsp;&nbsp; ESPAÇO PROGREDIR</strong><span>Estrada da Grama, 21 — Miguel Couto · Nova Iguaçu — RJ<br />CNPJ: 05.553.848/0001-61</span></div><div className="timesheet-competence"><b>RELATÓRIO DE PONTO DO COLABORADOR</b><span>Período: 01/{month.slice(5)}/{month.slice(0, 4)} a {monthBounds(month).to.slice(8)}/{month.slice(5)}/{month.slice(0, 4)}<br />{formatMonth(month).toUpperCase()}</span></div></header>
          <section className="employee-meta-grid"><span><b>Nome:</b> {employee.name}</span><span><b>CPF:</b> {employee.cpf || 'Não informado'}</span><span><b>Matrícula:</b> {employee.employeeNumber || 'Não informada'}</span><span><b>Cargo:</b> {employee.jobTitle || 'Não informado'}</span><span><b>Departamento:</b> Espaço Progredir</span><span><b>Unidade:</b> Espaço Progredir</span><span><b>Escala:</b> {employee.workDays || 'Não informada'}</span><span><b>Jornada:</b> {employee.scheduleStart && employee.scheduleEnd ? `${employee.scheduleStart} às ${employee.scheduleEnd}` : 'Não definida'}</span></section>
          <section className="timesheet-section individual-table-section"><table className="timesheet-table individual-timesheet-table"><thead><tr><th>Data</th><th>Horários (escala)</th><th>Marcações</th><th>H.Trab</th><th>H.Just</th><th>H.Prev</th><th>H.Falt</th><th>H.Exc</th><th>Saldo</th><th>Desc.</th><th>Justificativa</th></tr></thead><tbody>{rows.map((row) => <tr key={row.date}><td>{String(Number(row.date.slice(8))).padStart(2, '0')} {row.weekday}</td><td>{row.schedule}</td><td>{row.punches.length ? row.punches.map((punch) => `${formatTime(punch.timestamp)} (${typeLabels[punch.type] || punch.type})`).join(' · ') : '—'}</td><td>{formatMinutes(row.worked)}</td><td>{formatMinutes(row.justified)}</td><td>{formatMinutes(row.expected)}</td><td>{formatMinutes(row.missing)}</td><td>{formatMinutes(row.surplus)}</td><td className={row.balance !== null && row.balance < 0 ? 'negative-balance' : ''}>{formatMinutes(row.balance)}</td><td>{row.certificate ? (row.punches.length ? 'ATESTADO/TROCA + MARCAÇÃO' : 'ATESTADO/TROCA') : row.absent ? 'FALTA' : row.late ? 'ATRASO' : ''}</td><td>{row.certificate && row.punches.length ? 'ATESTADO + MARCAÇÃO EXISTENTE' : row.schedule.includes('pendente') ? 'PENDENTE DE APROVAÇÃO' : ''}</td></tr>)}</tbody></table></section>
          <section className="timesheet-totals"><span><b>Total H. Positivo:</b> {formatMinutes(Math.max(totals.balance, 0))}</span><span><b>Total H. Negativo:</b> {formatMinutes(Math.min(totals.balance, 0))}</span><span><b>Total trabalhado:</b> {formatMinutes(totals.worked)}</span><span><b>Total previsto:</b> {formatMinutes(totals.expected)}</span><span><b>Saldo de Horas:</b> {formatMinutes(totals.balance)}</span><span><b>Faltas:</b> {totals.absences}</span><span><b>Atrasos:</b> {totals.late}</span></section>
          <div className="signature-area"><div className="signature-block institution-signature-block">{signatureData ? <img className="institution-signature" src={signatureData} alt="Assinatura digital do Espaço Progredir" /> : null}<div className="signature-certificate-block"><strong>✓ Assinado digitalmente por ESPAÇO PROGREDIR</strong><span>Certificado digital A1 · CNPJ 05.553.848/0001-61</span><span>SHA-256 · PKCS#7 (CMS) · ICP-Brasil A1</span></div><div className="signature-line">Assinatura digital do Espaço Progredir</div><span className="signature-caption">Assinatura institucional A1</span></div><div className="signature-block employee-signature-block"><div className="signature-spacer" aria-hidden="true" /><div className="signature-line">Assinatura do colaborador</div><span className="signature-caption">{employee.name}</span></div></div>
          </div>;
        })}</div>
      )}
    </section>
  );
}
