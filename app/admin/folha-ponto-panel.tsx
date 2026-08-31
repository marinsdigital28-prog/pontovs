'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { isScheduledDay, parseWorkDays } from '@/lib/timesheet-schedule';
import { resolveDaySchedule } from '@/lib/day-schedule';
import { getOperationalAbono, operationalJustifiedMinutes, shouldHidePunchesForDay } from '@/lib/operational-abonos';
import { filterPunchesOutsideCertificates } from '@/lib/certificate-conflicts';

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
  absent: boolean; late: boolean; certificate: boolean; schedule: string;
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

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
function monthBounds(month: string) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
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
function dayKey(value: string) { return value.slice(0, 10); }
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
    const weekday = new Date(`${date}T12:00:00`).getDay();
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
    const considered = worked === null ? justified : worked + justified;
    const missing = expected === null || considered === null ? null : Math.max(0, expected - considered);
    const surplus = expected === null || considered === null ? null : Math.max(0, considered - expected);
    const balance = considered === null || expected === null ? null : considered - expected;
    const schedule = !scheduled ? 'Folga' : daySchedule ? `${daySchedule.start} às ${daySchedule.end} · ${daySchedule.mode === 'FULL' ? '1h de almoço' : 'meio expediente'}` : 'Escala sem horário';
    const covered = justified > 0 || Boolean(approvedRequest?.type === 'AUSENCIA');
    const scheduleLabel = approvedRequest?.type === 'TROCA_DIA'
      ? `${schedule} · troca aprovada`
      : certificate?.status === 'PENDENTE'
        ? `${schedule} · atestado pendente`
        : opsAbono
          ? `${schedule} · ${opsAbono.reason}`
          : schedule;
    return {
      date, weekday: weekdayNames[weekday], punches: dayPunches, worked, expected, justified, missing, surplus, balance,
      absent: configuredWorkday && !dayPunches.length && !covered, late: configuredWorkday && late && !covered,
      certificate: covered, schedule: scheduleLabel,
    };
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
      else setRecords(Array.isArray(punchData.records) ? punchData.records : []);
      setCertificates(Array.isArray(certificateData.certificates) ? certificateData.certificates : []);
      setRequests(Array.isArray(requestData.requests) ? requestData.requests : []);
      if (sigRes.ok && sigData.signatureData) setSignatureData(sigData.signatureData);
    } catch {
      setError('Falha ao carregar a folha.');
    }
    setLoading(false);
  }, [month]);

  useEffect(() => { void load(); }, [load]);

  const visibleEmployees = useMemo(() => {
    if (!employeeId || employeeId === allEmployeesValue) return employees;
    return employees.filter((e) => e.id === employeeId);
  }, [employees, employeeId]);

  const dayRowsByEmployee = useMemo(
    () => new Map(visibleEmployees.map((employee) => [employee.id, buildDayRows(employee, records, month, certificates, requests)])),
    [month, records, certificates, requests, visibleEmployees],
  );

  async function signPdf(emp: Employee) {
    setSigning(true);
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
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `folha-${emp.employeeNumber || emp.id}-${month}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('Falha ao assinar a folha.');
    }
    setSigning(false);
  }

  return (
    <section className="card timesheet-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">CONFERÊNCIA MENSAL</span>
          <h2>Folha de ponto</h2>
          <p className="small-muted">Marcações no horário de atestado/trabalho externo aprovado são desconsideradas (conflito).</p>
        </div>
        <div className="row-actions">
          <input className="input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          <select className="input" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">Selecione o colaborador</option>
            <option value={allEmployeesValue}>Todos</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.employeeNumber || '—'} · {e.name}</option>
            ))}
          </select>
          <button className="ghost-btn" type="button" onClick={() => void load()} disabled={loading}>{loading ? 'Carregando...' : 'Atualizar'}</button>
        </div>
      </div>
      {error ? <p className="status-msg">{error}</p> : null}
      {visibleEmployees.map((employee) => {
        const rows = dayRowsByEmployee.get(employee.id) || [];
        return (
          <div key={employee.id} className="timesheet-employee-block">
            <div className="section-heading">
              <div>
                <h3>{employee.name}</h3>
                <p className="small-muted">{employee.employeeNumber || 'Sem matrícula'} · {monthLabel(month)}</p>
              </div>
              <button className="primary-btn" type="button" disabled={signing} onClick={() => void signPdf(employee)}>
                {signing ? 'Gerando...' : 'PDF assinado'}
              </button>
            </div>
            <section className="timesheet-section individual-table-section">
              <table className="timesheet-table individual-timesheet-table">
                <thead>
                  <tr>
                    <th>Data</th><th>Horários (escala)</th><th>Marcações</th><th>H.Trab</th><th>H.Just</th>
                    <th>H.Prev</th><th>H.Falt</th><th>H.Exc</th><th>Saldo</th><th>Desc.</th><th>Justificativa</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.date}>
                      <td>{String(Number(row.date.slice(8))).padStart(2, '0')} {row.weekday}</td>
                      <td>{row.schedule}</td>
                      <td>{row.punches.length ? row.punches.map((punch) => `${formatTime(punch.timestamp)} (${typeLabels[punch.type] || punch.type})`).join(' · ') : '—'}</td>
                      <td>{formatMinutes(row.worked)}</td>
                      <td>{formatMinutes(row.justified)}</td>
                      <td>{formatMinutes(row.expected)}</td>
                      <td>{formatMinutes(row.missing)}</td>
                      <td>{formatMinutes(row.surplus)}</td>
                      <td className={row.balance !== null && row.balance < 0 ? 'negative-balance' : ''}>{formatMinutes(row.balance)}</td>
                      <td>{row.certificate || (row.justified && row.justified > 0) ? (row.punches.length ? 'ABONO + MARCAÇÃO' : 'ABONO/ATESTADO') : row.absent ? 'FALTA' : row.late ? 'ATRASO' : ''}</td>
                      <td>{row.certificate && row.punches.length ? 'ABONO + PONTO FORA DO ATESTADO' : row.schedule.includes('pendente') ? 'PENDENTE DE APROVAÇÃO' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
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
      {!employeeId ? <p className="small-muted">Selecione um colaborador ou "Todos" para ver a folha.</p> : null}
    </section>
  );
}
