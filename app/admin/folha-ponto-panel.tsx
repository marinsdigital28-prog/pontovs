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
  id: string; type: string; timestamp: string; status: string; origin: string;
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
    const dayPunches = rawDayPunches.filter((p) => allowedIds.has(p.id));
    const weekday = new Date(`${date}T12:00:00-03:00`).getDay();
    const daySchedule = resolveDaySchedule(employee.scheduleByDay, employee.workDays, employee.scheduleStart, employee.scheduleEnd, weekday);
    const scheduled = Boolean(daySchedule) && isScheduledDay(workDays, weekdayCodes[weekday]);
    const worked = calculateWorked(dayPunches);
    const firstPunch = dayPunches[0];
    const firstPunchMinutes = firstPunch ? minutesFromClock(formatTime(firstPunch.timestamp)) : null;
    const late = Boolean(scheduled && firstPunchMinutes !== null && scheduleStart !== null && firstPunchMinutes > scheduleStart + 5);
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
  // folha-live-poll: atualiza sozinho quando batidas entram
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
      const ok = window.confirm('Pré-fechamento: ainda há ' + preCloseAudit.blockers + ' pendência(s) (escala, incompletos, solicitações ou atestados).\n\nGerar PDF de todos mesmo assim?');
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
          <p className="small-muted">A4 horizontal · 1 página por colaborador · padrão Espaço Progredir</p>
        </div>
        <div className="row-actions folha-print-actions">
          <input className="input folha-month-input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          <select className="input folha-employee-select" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value={allEmployeesValue}>Todos os colaboradores</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.employeeNumber || '—'} · {e.name}</option>
            ))}
          </select>
          <button className="ghost-btn" type="button" onClick={() => void load()} disabled={loading}>
            {loading ? 'Carregando...' : 'Atualizar'}
          </button>
          <button className="primary-btn" type="button" onClick={handlePrintAll} disabled={signing}>
            Imprimir todos
          </button>
          <button className="primary-btn" type="button" onClick={() => void signAllPdfs()} disabled={signing || !employees.length}>
            {signing ? 'Gerando PDF...' : 'PDF de todos'}
          </button>
        </div>
      </div>

      <div className="folha-competence-banner" role="status">
        <strong>{monthLabel(month).toUpperCase()}</strong>
        <span>Período: <b>{bounds.from}</b> → <b>{bounds.to}</b> · {bounds.lastDay} dias · {visibleEmployees.length} folha(s)</span>
        {batchProgress ? <span className="folha-batch-progress">{batchProgress}</span> : null}
        <span className="folha-live-dot" title="Atualiza sozinho a cada 25s">Ao vivo</span>
      </div>

      {error ? <p className="status-msg">{error}</p> : null}

      {visibleEmployees.map((employee) => {
        const rows = dayRowsByEmployee.get(employee.id) || [];
        return (
          <div key={employee.id} className="timesheet-employee-block folha-block">
            <div className="section-heading">
              <div>
                <h3>{employee.name}</h3>
                <p className="small-muted">{employee.employeeNumber || 'Sem matrícula'} · {monthLabel(month)}</p>
              </div>
              <div className="row-actions no-print">
                <button className="ghost-btn" type="button" onClick={() => window.print()} disabled={signing}>
                  Imprimir
                </button>
                <button className="primary-btn" type="button" disabled={signing} onClick={() => void signPdf(employee)}>
                  {signing ? 'Gerando...' : 'PDF assinado'}
                </button>
              </div>
            </div>
            <div className="folha-table-scroll">
              <table className="folha-table">
                <thead>
                  <tr>
                    <th>Data</th><th>Escala</th><th>Marcações</th><th>Trab.</th><th>Just.</th>
                    <th>Prev.</th><th>Falta</th><th>Extra</th><th>Saldo</th><th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const isFolga = row.schedule.startsWith('Folga');
                    const situation = row.certificate || (row.justified && row.justified > 0)
                      ? (row.punches.length ? 'ABONO + PONTO' : 'ABONO/ATESTADO')
                      : row.absent ? 'FALTA'
                      : row.incomplete ? 'INCOMPLETO'
                      : row.late ? 'ATRASO'
                      : isFolga ? 'FOLGA'
                      : row.punches.length ? 'OK' : '';
                    return (
                      <tr key={row.date} className={[isFolga ? 'folha-row-folga' : '', row.absent ? 'folha-row-falta' : '', row.incomplete ? 'folha-row-incompleto' : '', row.certificate ? 'folha-row-abono' : ''].filter(Boolean).join(' ')}>
                        <td className="folha-col-date"><b>{row.date.slice(8)}</b><span>{row.weekday}</span></td>
                        <td className="folha-col-scale">{row.schedule}</td>
                        <td className="folha-col-marks">{row.punches.length ? row.punches.map((punch) => (
                          <span key={punch.id} className="folha-mark">{formatTime(punch.timestamp)} {typeLabels[punch.type] || punch.type}</span>
                        )) : '—'}</td>
                        <td>{formatMinutes(row.worked)}</td>
                        <td>{formatMinutes(row.expected)}</td>
                        <td>{formatMinutes(row.justified)}</td>
                        <td className={row.balance !== null && row.balance < 0 ? 'folha-neg' : row.balance !== null && row.balance > 0 ? 'folha-pos' : ''}>{formatMinutes(row.balance)}</td>
                        <td className="folha-col-sit">{situation}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="signature-area">
              <div className="signature-block institution-signature-block">
                {signatureData ? <img className="institution-signature" src={signatureData} alt="Assinatura digital do Espaço Progredir" /> : null}
                <div className="signature-certificate-block">
                  <strong>✓ Assinado digitalmente por ESPAÇO PROGREDIR</strong>
                  <span>Certificado digital A1 · CNPJ 05.553.848/0001-61</span>
                </div>
                <div className="signature-line">Assinatura digital do Espaço Progredir</div>
              </div>
              <div className="signature-block employee-signature-block">
                <div className="signature-spacer" aria-hidden="true" />
                <div className="signature-line">Assinatura do colaborador</div>
                <span className="signature-caption">{employee.name}</span>
              </div>
            </div>
          </div>
        );
      })}
    </section>
  );
}
