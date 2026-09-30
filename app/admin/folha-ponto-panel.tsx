'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { isScheduledDay, parseWorkDays } from '@/lib/timesheet-schedule';
import { resolveDaySchedule } from '@/lib/day-schedule';
import { getOperationalAbono, operationalJustifiedMinutes, shouldHidePunchesForDay } from '@/lib/operational-abonos';
import { filterPunchesOutsideCertificates } from '@/lib/certificate-conflicts';
import { brazilDateKey } from '@/lib/brazil-time';
import './folha-ponto.css';
import './folha-preclose.css';

type Employee = {
  id: string; name: string; employeeNumber: string | null; cpf?: string | null; jobTitle?: string | null;
  workDays?: string | null; scheduleStart?: string | null; scheduleEnd?: string | null; scheduleByDay?: string | null;
};
type RecordItem = {
  id: string; type: string; timestamp: string; status: string; origin: string; hasPhoto?: boolean;
  user: { id: string; name: string; employeeNumber: string | null; cpf?: string | null; jobTitle: string | null };
};
type DayRow = {
  date: string; weekday: string; punches: RecordItem[]; worked: number | null; expected: number | null;
  justified: number | null; missing: number | null; surplus: number | null; balance: number | null;
  absent: boolean; late: boolean; certificate: boolean; incomplete: boolean; schedule: string;
};
type CertificateItem = {
  userId: string; type?: string; startDate: string; endDate: string;
  startTime?: string | null; endTime?: string | null; hoursPerDayMinutes?: number | null; status: string;
};
type ApprovedRequest = {
  employeeId: string; type: 'AUSENCIA' | 'TROCA_DIA'; status: string; startDate: string; endDate: string; reason: string;
};

const typeLabels: Record<string, string> = { ENTRADA: 'E', INTERVALO: 'I', RETORNO: 'R', SAIDA: 'S' };
const weekdayNames = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const weekdayCodes: Record<number, string> = { 0: 'DOM', 1: 'SEG', 2: 'TER', 3: 'QUA', 4: 'QUI', 5: 'SEX', 6: 'SÁB' };
const allEmployeesValue = '__ALL__';

function currentMonth() {
  return brazilDateKey(new Date()).slice(0, 7);
}
function monthBounds(month: string) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return {
    from: `${month}-01`,
    to: `${month}-${String(last).padStart(2, '0')}`,
    lastDay: last,
    label: new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' }),
  };
}
function formatTime(value: string) {
  return new Date(value).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
}
function monthLabel(month: string) {
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
function dayKey(value: string) { return brazilDateKey(new Date(value)); }
function minutesBetween(start: string, end: string) {
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000));
}
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
    const hidePunches = shouldHidePunchesForDay(employee.employeeNumber, date);
    const rawDayPunches = hidePunches ? [] : records.filter((record) => record.user.id === employee.id && dayKey(record.timestamp) === date);
    const dayCertificates = certificates
      .filter((item) => item.userId === employee.id)
      .map((item) => ({
        userId: item.userId, type: item.type, startDate: item.startDate, endDate: item.endDate,
        startTime: item.startTime, endTime: item.endTime, status: item.status,
      }));
    const allowedIds = new Set(
      filterPunchesOutsideCertificates(
        rawDayPunches.map((p) => ({ id: p.id, userId: employee.id, timestamp: new Date(p.timestamp) })),
        dayCertificates,
        employee.id,
      ).map((p) => p.id),
    );
    const filteredDayPunches = rawDayPunches.filter((p) => allowedIds.has(p.id));
    const dayPunches = (() => {
      const ordered = [...filteredDayPunches].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      const seen = new Set<string>();
      return ordered.filter((p) => {
        const key = String(p.type || '').toUpperCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    })();
    const weekday = new Date(`${date}T12:00:00-03:00`).getDay();
    const daySchedule = resolveDaySchedule(employee.scheduleByDay, employee.workDays, employee.scheduleStart, employee.scheduleEnd, weekday, employee.employeeNumber);
    const scheduled = Boolean(daySchedule) && isScheduledDay(workDays, weekdayCodes[weekday]);
    const worked = calculateWorked(dayPunches);
    const firstPunch = dayPunches[0];
    const firstPunchMinutes = firstPunch ? minutesFromClock(formatTime(firstPunch.timestamp)) : null;
    const late = Boolean(scheduled && firstPunchMinutes !== null && scheduleStart !== null && firstPunchMinutes > scheduleStart + 15);
    const dayStart = daySchedule ? minutesFromClock(daySchedule.start) : scheduleStart;
    const dayEnd = daySchedule ? minutesFromClock(daySchedule.end) : scheduleEnd;
    const span = dayStart !== null && dayEnd !== null ? Math.max(0, dayEnd - dayStart) : null;
    const lunch = span !== null && span > 6 * 60 ? 60 : 0;
    const expected = scheduled && span !== null ? Math.max(0, span - lunch) : scheduled ? expectedMinutes : null;
    const configuredWorkday = scheduled && expected !== null;
    const certificate = certificates.find((item) => item.userId === employee.id && item.startDate.slice(0, 10) <= date && item.endDate.slice(0, 10) >= date);
    const approvedRequest = requests.find((item) => item.employeeId === employee.id && item.status === 'APROVADO' && ((item.type === 'AUSENCIA' && item.startDate.slice(0, 10) <= date && item.endDate.slice(0, 10) >= date) || (item.type === 'TROCA_DIA' && (item.startDate.slice(0, 10) === date || item.endDate.slice(0, 10) === date))));
    const justifiedByCertificate = certificate && dayStart !== null && dayEnd !== null ? certificateMinutesForDay(certificate, date, dayStart, dayEnd, daySchedule?.mode === 'FULL', expected) : 0;
    const justifiedByRequest = approvedRequest?.type === 'AUSENCIA' ? expected || 0 : 0;
    const opsAbono = getOperationalAbono(employee.employeeNumber, date);
    const justifiedByOps = opsAbono ? operationalJustifiedMinutes(opsAbono, daySchedule?.start || employee.scheduleStart, daySchedule?.end || employee.scheduleEnd, expected) : 0;
    const justified = Math.max(justifiedByCertificate, justifiedByRequest, justifiedByOps);
    const considered = worked === null ? (justified > 0 ? justified : null) : worked + justified;
    const missing = expected === null || considered === null ? null : Math.max(0, expected - considered);
    const surplus = expected === null || considered === null ? null : Math.max(0, considered - expected);
    const balance = considered === null || expected === null ? null : considered - expected;
    const schedule = !scheduled ? 'Folga' : daySchedule ? `${daySchedule.start}–${daySchedule.end}${daySchedule.mode === 'FULL' ? ' · almoço 1h' : ' · meio exp.'}` : 'Sem horário';
    const covered = justified > 0 || Boolean(approvedRequest?.type === 'AUSENCIA');
    const scheduleLabel = approvedRequest?.type === 'TROCA_DIA'
      ? `${schedule} · troca`
      : certificate?.status === 'PENDENTE'
        ? `${schedule} · atestado pend.`
        : opsAbono
          ? `${schedule} · ${opsAbono.reason}`
          : schedule;
    const types = new Set(dayPunches.map((p) => p.type));
    const incomplete = Boolean(
      configuredWorkday
      && !covered
      && dayPunches.length > 0
      && (!types.has('ENTRADA') || !types.has('SAIDA')),
    );
    return {
      date, weekday: weekdayNames[weekday], punches: dayPunches, worked, expected, justified, missing, surplus, balance,
      absent: configuredWorkday && !dayPunches.length && !covered, late: configuredWorkday && late && !covered,
      certificate: covered, incomplete, schedule: scheduleLabel,
    };
  });
}

export default function FolhaPontoPanel({ employees }: { employees: Employee[] }) {
  const [month, setMonth] = useState(currentMonth());
  const [employeeId, setEmployeeId] = useState(allEmployeesValue);
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [certificates, setCertificates] = useState<CertificateItem[]>([]);
  const [requests, setRequests] = useState<ApprovedRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [batchProgress, setBatchProgress] = useState('');
  const [fixingDupes, setFixingDupes] = useState(false);
  const [fixMsg, setFixMsg] = useState('');
  const [analyzingAnomalies, setAnalyzingAnomalies] = useState(false);
  const [anomalyReport, setAnomalyReport] = useState<{ totals?: any; findings?: any[] } | null>(null);

  const load = useCallback(async () => {
    const bounds = monthBounds(month);
    setLoading(true);
    setError('');
    try {
      const [punchRes, certRes, reqRes, sigRes] = await Promise.all([
        fetch(`/api/admin/punches?from=${bounds.from}&to=${bounds.to}&status=VALID`, { cache: 'no-store' }),
        fetch('/api/admin/certificates', { cache: 'no-store' }),
        fetch('/api/admin/requests', { cache: 'no-store' }),
        fetch('/api/admin/signature', { cache: 'no-store' }),
      ]);
      const punchData = await punchRes.json().catch(() => ({}));
      const certificateData = await certRes.json().catch(() => ({}));
      const requestData = await reqRes.json().catch(() => ({}));
      const sigData = await sigRes.json().catch(() => ({}));
      if (!punchRes.ok) setError(punchData.error || 'Não foi possível carregar marcações.');
      else {
        const list = Array.isArray(punchData.records) ? punchData.records : [];
        setRecords(list.filter((r: RecordItem) => {
          const key = dayKey(r.timestamp);
          return key >= bounds.from && key <= bounds.to;
        }));
      }
      setCertificates(Array.isArray(certificateData.certificates) ? certificateData.certificates : []);
      setRequests((Array.isArray(requestData.requests) ? requestData.requests : []).map((r) => ({
        ...r,
        employeeId: r.employeeId || r.employee?.id || '',
        startDate: typeof r.startDate === 'string' ? r.startDate : String(r.startDate || '').slice(0, 10),
        endDate: typeof r.endDate === 'string' ? r.endDate : String(r.endDate || '').slice(0, 10),
      })).filter((r) => r.employeeId));
      if (sigRes.ok && sigData.signatureData) setSignatureData(sigData.signatureData);
    } catch {
      setError('Falha ao carregar a folha.');
    }
    setLoading(false);
  }, [month]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const id = window.setInterval(() => { void load(); }, 25000);
    return () => window.clearInterval(id);
  }, [load]);

  const visibleEmployees = useMemo(() => {
    if (!employeeId || employeeId === allEmployeesValue) return employees;
    return employees.filter((e) => e.id === employeeId);
  }, [employees, employeeId]);

  const dayRowsByEmployee = useMemo(
    () => new Map(visibleEmployees.map((employee) => [employee.id, buildDayRows(employee, records, month, certificates, requests)])),
    [month, records, certificates, requests, visibleEmployees],
  );

  const preCloseAudit = useMemo(() => {
    const bounds = monthBounds(month);
    const noSchedule: string[] = [];
    const faltas: Array<{ name: string; days: string[] }> = [];
    const incompletos: Array<{ name: string; days: string[] }> = [];
    let totalFaltas = 0;
    let totalIncompletos = 0;
    let totalAtrasos = 0;
    for (const emp of visibleEmployees) {
      if (!emp.scheduleStart || !emp.scheduleEnd) noSchedule.push((emp.employeeNumber || '—') + ' · ' + emp.name);
      const rows = dayRowsByEmployee.get(emp.id) || [];
      const fDays = rows.filter((r) => r.absent).map((r) => r.date.slice(8));
      const iDays = rows.filter((r) => r.incomplete).map((r) => r.date.slice(8));
      totalFaltas += fDays.length;
      totalIncompletos += iDays.length;
      totalAtrasos += rows.filter((r) => r.late).length;
      if (fDays.length) faltas.push({ name: emp.name, days: fDays });
      if (iDays.length) incompletos.push({ name: emp.name, days: iDays });
    }
    const pendingRequests = requests.filter((r) => {
      if (r.status !== 'PENDENTE') return false;
      const start = String(r.startDate).slice(0, 10);
      const end = String(r.endDate).slice(0, 10);
      return start <= bounds.to && end >= bounds.from;
    });
    const pendingCerts = certificates.filter((c) => {
      if (c.status !== 'PENDENTE') return false;
      const start = String(c.startDate).slice(0, 10);
      const end = String(c.endDate).slice(0, 10);
      return start <= bounds.to && end >= bounds.from;
    });
    const blockers = noSchedule.length + pendingRequests.length + pendingCerts.length + totalIncompletos;
    return { noSchedule, faltas, incompletos, totalFaltas, totalIncompletos, totalAtrasos, pendingRequests, pendingCerts, blockers, ready: blockers === 0 };
  }, [visibleEmployees, dayRowsByEmployee, requests, certificates, month]);

  async function downloadPdfBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function signPdf(emp: Employee) {
    setSigning(true);
    setBatchProgress('');
    setError('');
    try {
      const response = await fetch('/api/admin/timesheet-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: emp.id, month }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || 'Não foi possível gerar o PDF.');
        setSigning(false);
        return;
      }
      const blob = await response.blob();
      await downloadPdfBlob(blob, `folha-${emp.employeeNumber || emp.id}-${month}.pdf`);
    } catch {
      setError('Falha ao assinar a folha.');
    }
    setSigning(false);
  }

  async function signAllPdfs() {
    if (preCloseAudit.blockers > 0) {
      const ok = window.confirm('Pré-fechamento: ainda há ' + preCloseAudit.blockers + ' pendência(s).\n\nGerar PDF de todos mesmo assim?');
      if (!ok) return;
    }
    return signAllPdfsInner();
  }
  async function signAllPdfsInner() {
    setSigning(true);
    setError('');
    setBatchProgress(`Gerando PDF de ${employees.length} colaboradores...`);
    try {
      const response = await fetch('/api/admin/timesheet-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true, month }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || 'Não foi possível gerar o PDF em lote.');
        setSigning(false);
        setBatchProgress('');
        return;
      }
      const blob = await response.blob();
      await downloadPdfBlob(blob, `folhas-todos-${month}-assinadas.pdf`);
      setBatchProgress(`Pronto: ${employees.length} folhas em 1 PDF.`);
    } catch {
      setError('Falha ao gerar PDF de todos.');
      setBatchProgress('');
    }
    setSigning(false);
  }

  async function identifyAnomalies() {
    const bounds = monthBounds(month);
    setAnalyzingAnomalies(true);
    setError('');
    setAnomalyReport(null);
    try {
      const response = await fetch('/api/admin/analyze-punch-anomalies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: bounds.from, to: bounds.to }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || 'Não foi possível analisar o mês.');
        setAnalyzingAnomalies(false);
        return;
      }
      setAnomalyReport({ totals: data.totals, findings: data.findings || [] });
    } catch {
      setError('Falha ao identificar anomalias.');
    }
    setAnalyzingAnomalies(false);
  }

  async function fixDuplicatePunches() {
    const bounds = monthBounds(month);
    const ok = window.confirm(
      'Corrigir o mês ' + month + ' de forma inteligente?\n\n' +
      '• Cancela tipos duplicados no mesmo dia\n' +
      '• Meio expediente: NÃO completa (só remove duplicata)\n' +
      '• 1–2 batidas com poucas horas: trata como evento/parcial (não inventa)\n' +
      '• Jornada integral (≥6h ou 3+ batidas): completa E/I/R/S com *\n\n' +
      'Não altera o app de marcação — só o que já está no sistema.'
    );
    if (!ok) return;
    setFixingDupes(true);
    setFixMsg('');
    setError('');
    try {
      const response = await fetch('/api/admin/fix-duplicate-punches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: bounds.from, to: bounds.to }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || 'Não foi possível corrigir as marcações.');
        setFixingDupes(false);
        return;
      }
      const s = data.summary || {};
      setFixMsg(
        'Correção: ' +
        (s.duplicatesRejected || 0) + ' duplicata(s); ' +
        (s.entradasCreated || 0) + ' E*; ' +
        (s.intervalosCreated || 0) + ' I*; ' +
        (s.retornosCreated || 0) + ' R*; ' +
        (s.saidasCreated || 0) + ' S*; ' +
        (s.halfSkipped || 0) + ' meio exp. ignorado(s); ' +
        (s.eventSkipped || 0) + ' evento/parcial.'
      );
      await load();
    } catch {
      setError('Falha ao corrigir duplicatas.');
    }
    setFixingDupes(false);
  }

  function handlePrintAll() {
    setEmployeeId(allEmployeesValue);
    setTimeout(() => window.print(), 300);
  }

  const bounds = monthBounds(month);

  return (
    <section className="card timesheet-panel folha-ponto-root">
      <div className="section-heading">
        <div>
          <span className="eyebrow">CONFERÊNCIA MENSAL</span>
          <h2>Folha de ponto</h2>
          <p className="small-muted">A4 horizontal · 1 página por colaborador · ● foto · * ajustada</p>
        </div>
        <div className="row-actions folha-print-actions">
          <input className="input folha-month-input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          <select className="input" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value={allEmployeesValue}>Todos os colaboradores</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.employeeNumber || '—'} · {e.name}</option>
            ))}
          </select>
          <button type="button" className="ghost-btn" onClick={() => void load()} disabled={loading}>{loading ? 'Atualizando…' : 'Atualizar'}</button>
          <button type="button" className="ghost-btn" onClick={handlePrintAll}>Imprimir todos</button>
          <button type="button" className="primary-btn" onClick={() => void signAllPdfs()} disabled={signing}>{signing ? (batchProgress || 'Gerando…') : 'PDF de todos (assinado)'}</button>
          <button type="button" className="ghost-btn" onClick={() => void identifyAnomalies()} disabled={analyzingAnomalies || loading}>
            {analyzingAnomalies ? 'Identificando…' : 'Identificar anomalias'}
          </button>
          <button type="button" className="ghost-btn" onClick={() => void fixDuplicatePunches()} disabled={fixingDupes || loading}>
            {fixingDupes ? 'Corrigindo…' : 'Corrigir folha do mês'}
          </button>
        </div>
      </div>

      {error ? <div className="status-msg">{error}</div> : null}
      {fixMsg ? <div className="status-msg">{fixMsg}</div> : null}
      {anomalyReport ? (
        <div className="card" style={{ marginTop: '0.75rem', padding: '1rem' }}>
          <div className="section-heading">
            <div>
              <span className="eyebrow">IDENTIFICAÇÃO (sem corrigir)</span>
              <h3>Anomalias do mês</h3>
              <p className="small-muted">
                {(anomalyReport.totals?.findings ?? 0)} caso(s) ·{' '}
                {anomalyReport.totals?.umaBatida ?? 0} com 1 batida ·{' '}
                {anomalyReport.totals?.foraHorarioCedo ?? 0} bem cedo ·{' '}
                {anomalyReport.totals?.eventoCurto ?? 0} evento/parcial ·{' '}
                {anomalyReport.totals?.soAjustadas ?? 0} só ajustadas(*)
              </p>
            </div>
            <button type="button" className="ghost-btn" onClick={() => setAnomalyReport(null)}>Fechar</button>
          </div>
          {!anomalyReport.findings?.length ? (
            <p className="small-muted">Nenhuma anomalia relevante neste mês.</p>
          ) : (
            <div className="table-wrap" style={{ maxHeight: '420px', overflow: 'auto' }}>
              <table className="folha-table" style={{ minWidth: '720px' }}>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Colaborador</th>
                    <th>Escala</th>
                    <th>Tipos</th>
                    <th>Marcações</th>
                    <th>Obs.</th>
                  </tr>
                </thead>
                <tbody>
                  {anomalyReport.findings.map((f: any, i: number) => (
                    <tr key={f.employeeNumber + f.date + i}>
                      <td>{f.date.slice(8)}/{f.date.slice(5, 7)}</td>
                      <td>{f.employeeNumber} · {f.name}</td>
                      <td>{f.mode} {f.schedule}</td>
                      <td>{(f.kinds || []).join(', ')}</td>
                      <td style={{ fontSize: '12px' }}>{f.marks}</td>
                      <td style={{ fontSize: '12px' }}>{f.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="small-muted" style={{ marginTop: '0.75rem' }}>
            Revise a lista. Depois combinamos o que corrigir (passeio, ajuste indevido, etc.).
          </p>
        </div>
      ) : null}
      {batchProgress && !signing ? <div className="status-msg">{batchProgress}</div> : null}

      <div className="folha-preclose card" data-ready={preCloseAudit.ready ? '1' : '0'}>
        <div className="section-heading">
          <div>
            <span className="eyebrow">PRÉ-FECHAMENTO</span>
            <h3>{preCloseAudit.ready ? 'Pronto para fechar o mês' : 'Pendências antes do fechamento'}</h3>
            <p className="small-muted">{bounds.label} · {visibleEmployees.length} colaborador(es)</p>
          </div>
        </div>
        <div className="folha-preclose-grid">
          <div><strong>{preCloseAudit.totalFaltas}</strong><span>Faltas</span></div>
          <div><strong>{preCloseAudit.totalIncompletos}</strong><span>Incompletos</span></div>
          <div><strong>{preCloseAudit.totalAtrasos}</strong><span>Atrasos</span></div>
          <div><strong>{preCloseAudit.pendingRequests.length}</strong><span>Solicitações pend.</span></div>
          <div><strong>{preCloseAudit.pendingCerts.length}</strong><span>Atestados pend.</span></div>
          <div><strong>{preCloseAudit.noSchedule.length}</strong><span>Sem jornada</span></div>
        </div>
        {!preCloseAudit.ready ? (
          <ul className="folha-preclose-list">
            {preCloseAudit.noSchedule.slice(0, 8).map((n) => <li key={n}>Sem horário: {n}</li>)}
            {preCloseAudit.incompletos.slice(0, 8).map((x) => <li key={x.name}>Incompleto · {x.name}: dias {x.days.join(', ')}</li>)}
            {preCloseAudit.faltas.slice(0, 8).map((x) => <li key={x.name}>Falta · {x.name}: dias {x.days.join(', ')}</li>)}
          </ul>
        ) : null}
      </div>

      {visibleEmployees.map((employee) => {
        const rows = dayRowsByEmployee.get(employee.id) || [];
        const isFolga = (row: DayRow) => row.schedule.startsWith('Folga');
        const totals = rows.reduce(
          (acc, row) => {
            if (row.worked !== null) acc.worked += row.worked;
            if (row.expected !== null) acc.expected += row.expected;
            if (row.justified !== null) acc.justified += row.justified;
            if (row.missing !== null) acc.missing += row.missing;
            if (row.surplus !== null) acc.surplus += row.surplus;
            if (row.balance !== null) acc.balance += row.balance;
            return acc;
          },
          { worked: 0, expected: 0, justified: 0, missing: 0, surplus: 0, balance: 0 },
        );
        return (
          <div className="folha-sheet" key={employee.id}>
            <div className="folha-sheet-header">
              <div>
                <strong>{employee.name}</strong>
                <span className="small-muted">{employee.employeeNumber || '—'} · {employee.jobTitle || '—'} · {employee.cpf || '—'}</span>
              </div>
              <div className="row-actions">
                <button type="button" className="ghost-btn" onClick={() => window.print()}>Imprimir</button>
                <button type="button" className="primary-btn" onClick={() => void signPdf(employee)} disabled={signing}>PDF assinado</button>
              </div>
            </div>
            <div className="folha-sheet-meta">
              <span>{monthLabel(month)}</span>
              <span>Trabalhado {formatMinutes(totals.worked)}</span>
              <span>Esperado {formatMinutes(totals.expected)}</span>
              <span>Abonado {formatMinutes(totals.justified)}</span>
              <span className={totals.balance < 0 ? 'folha-neg' : totals.balance > 0 ? 'folha-pos' : ''}>Saldo {formatMinutes(totals.balance)}</span>
            </div>
            <div className="table-wrap">
              <table className="folha-table">
                <thead>
                  <tr>
                    <th>Dia</th>
                    <th>Escala</th>
                    <th>Marcações</th>
                    <th>Trab.</th>
                    <th>Esp.</th>
                    <th>Abono</th>
                    <th>Falta</th>
                    <th>Extra</th>
                    <th>Saldo</th>
                    <th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const isFolgaRow = isFolga(row);
                    const situation = row.certificate || (row.justified && row.justified > 0)
                      ? (row.punches.length ? 'ABONO + PONTO' : 'ABONO/ATESTADO')
                      : row.absent ? 'FALTA'
                      : row.incomplete ? 'INCOMPLETO'
                      : isFolgaRow ? 'FOLGA'
                      : row.punches.length ? 'OK' : '';
                    const sitClass =
                      situation.startsWith('ABONO') ? 'folha-sit-abono'
                      : situation === 'FALTA' ? 'folha-sit-falta'
                      : situation === 'INCOMPLETO' ? 'folha-sit-incompleto'
                      : situation === 'FOLGA' ? 'folha-sit-folga'
                      : situation === 'OK' ? 'folha-sit-ok'
                      : '';
                    return (
                      <tr key={row.date} className={
                        row.absent ? 'folha-row-falta'
                        : row.incomplete ? 'folha-row-incompleto'
                        : row.certificate ? 'folha-row-abono'
                        : isFolgaRow ? 'folha-row-folga'
                        : ''
                      }>
                        <td className="folha-col-date">
                          <b>{row.date.slice(8)}</b>
                          <span>{row.weekday}</span>
                        </td>
                        <td className="folha-col-scale">{row.schedule}</td>
                        <td className="folha-col-marks">
                          {row.punches.length
                            ? row.punches.map((p) => (
                                <span key={p.id} className="folha-mark">
                                  {p.hasPhoto ? <span className="folha-photo-dot" title="Registro com foto" aria-hidden /> : null}
                                  <span className="folha-mark-text">{typeLabels[p.type] || p.type}{p.origin === 'ADJUSTED' ? '*' : ''} {formatTime(p.timestamp)}</span>
                                </span>
                              ))
                            : '—'}
                        </td>
                        <td>{formatMinutes(row.worked)}</td>
                        <td>{formatMinutes(row.expected)}</td>
                        <td>{formatMinutes(row.justified)}</td>
                        <td className={row.missing && row.missing > 0 ? 'folha-neg' : ''}>{formatMinutes(row.missing)}</td>
                        <td className={row.surplus && row.surplus > 0 ? 'folha-pos' : ''}>{formatMinutes(row.surplus)}</td>
                        <td className={row.balance !== null && row.balance < 0 ? 'folha-neg' : row.balance !== null && row.balance > 0 ? 'folha-pos' : ''}>{formatMinutes(row.balance)}</td>
                        <td className="folha-col-sit">{situation ? <span className={`folha-sit ${sitClass}`}>{situation}</span> : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="signature-area">
              <div className="signature-block">
                {signatureData ? (
                  <div className="signature-certificate-block">
                    <strong>Assinado digitalmente</strong>
                    <span>Certificado A1 · Espaço Progredir</span>
                  </div>
                ) : (
                  <div className="signature-spacer" />
                )}
                <div className="signature-line">Assinatura da instituição</div>
                <span className="signature-caption">Espaço Progredir</span>
              </div>
              <div className="signature-block">
                <div className="signature-spacer" />
                <div className="signature-line">Assinatura do colaborador</div>
                <span className="signature-caption">{employee.name}</span>
              </div>
            </div>
            <p className="folha-legend">
              <span className="folha-photo-dot" aria-hidden /> = marcação com registro de foto
              {' · '}* = marcação ajustada no sistema
            </p>
          </div>
        );
      })}
    </section>
  );
}
