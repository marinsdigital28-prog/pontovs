'use client';

import { useEffect, useMemo, useState } from 'react';

type Employee = { id: string; name: string; employeeNumber: string | null; cpf?: string | null };
type Certificate = {
  id: string;
  userId: string;
  type: string;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  hoursPerDayMinutes: number | null;
  daysCount: number;
  workDaysCount: number | null;
  documentName: string | null;
  documentMime: string | null;
  observation: string | null;
  status: string;
  canceledAt: string | null;
  cancelReason: string | null;
  user: { name: string; employeeNumber: string | null; cpf: string | null };
};

const certificateTypeLabels: Record<string, string> = {
  DIA_INTEGRAL: 'Dia integral',
  PERIODO_DIAS: 'Período de dias',
  HORAS: 'Horas',
  PERIODO_HORAS: 'Período de horas',
  CONSULTA_MEDICA: 'Consulta médica',
  SAIDA_MEDICA: 'Saída médica',
  TRABALHO_EXTERNO: 'Trabalho externo — dia integral',
  TRABALHO_EXTERNO_HORAS: 'Trabalho externo — horas (metade do dia)',
  OUTRO: 'Outro',
};

const hourlyTypes = new Set(['HORAS', 'PERIODO_HORAS', 'TRABALHO_EXTERNO_HORAS']);

function dateText(value: string) {
  return new Date(value).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}
function periodDays(start: string, end: string) {
  if (!start || !end) return 0;
  const a = new Date(`${start}T12:00:00`);
  const b = new Date(`${end}T12:00:00`);
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1);
}
function durationMinutes(start: string, end: string) {
  if (!start || !end) return null;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const value = (eh * 60 + em) - (sh * 60 + sm);
  return value > 0 ? value : value === 0 ? 0 : -1;
}
function durationText(minutes: number | null) {
  if (minutes === null) return '—';
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}h${String(minutes % 60).padStart(2, '0')}`;
}

export default function CertificatesPanel({ employees }: { employees: Employee[] }) {
  const [items, setItems] = useState<Certificate[]>([]);
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    userId: '',
    type: 'DIA_INTEGRAL',
    startDate: '',
    endDate: '',
    startTime: '',
    endTime: '',
    observation: '',
  });
  const [document, setDocument] = useState<{ name: string; mime: string; data: string } | null>(null);

  const isHourly = hourlyTypes.has(form.type);
  const isExternal = form.type === 'TRABALHO_EXTERNO' || form.type === 'TRABALHO_EXTERNO_HORAS';
  const hourDuration = durationMinutes(form.startTime, form.endTime);

  async function load() {
    const response = await fetch('/api/admin/certificates', { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (response.ok) setItems(data.certificates || []);
    else setMessage(data.error || 'Não foi possível carregar atestados.');
  }
  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(
    () =>
      items.filter((item) =>
        `${item.user.name} ${item.user.employeeNumber || ''} ${item.user.cpf || ''}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [items, search],
  );

  function onFile(file: File | undefined) {
    if (!file) return;
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) {
      return setMessage('Aceitos somente PDF, JPG, JPEG ou PNG.');
    }
    if (file.size > 10 * 1024 * 1024) return setMessage('O documento deve ter no máximo 10 MB.');
    const reader = new FileReader();
    reader.onload = () => setDocument({ name: file.name, mime: file.type, data: String(reader.result) });
    reader.readAsDataURL(file);
  }

  async function create() {
    if (!form.userId || !form.startDate || (!isHourly && !form.endDate)) {
      return setMessage(
        isHourly
          ? 'Selecione o funcionário e informe a data.'
          : 'Selecione o funcionário e informe o período.',
      );
    }
    if (isHourly && hourDuration !== null && hourDuration <= 0) {
      return setMessage('Horário inválido. A hora final deve ser posterior à hora inicial.');
    }
    setSaving(true);
    setMessage('');
    const response = await fetch('/api/admin/certificates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        documentName: document?.name,
        documentMime: document?.mime,
        documentData: document?.data,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) setMessage(data.error || 'Não foi possível lançar o atestado.');
    else {
      setMessage(
        isExternal
          ? 'Trabalho externo lançado. Após aprovação, o período será abonado na folha.'
          : 'Atestado lançado e auditado.',
      );
      setForm({
        userId: '',
        type: 'DIA_INTEGRAL',
        startDate: '',
        endDate: '',
        startTime: '',
        endTime: '',
        observation: '',
      });
      setDocument(null);
      await load();
    }
    setSaving(false);
  }

  async function review(id: string, action: 'approve' | 'reject') {
    const reason = window.prompt(
      action === 'approve' ? 'Observação da aprovação (opcional):' : 'Motivo da rejeição:',
    );
    if (action === 'reject' && !reason) return;
    const response = await fetch('/api/admin/certificates', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action, reason: reason || undefined }),
    });
    const data = await response.json().catch(() => ({}));
    setMessage(
      response.ok
        ? action === 'approve'
          ? 'Aprovado e integrado à folha.'
          : 'Rejeitado e auditado.'
        : data.error || 'Não foi possível revisar.',
    );
    if (response.ok) await load();
  }

  async function cancel(id: string) {
    const reason = window.prompt('Motivo do cancelamento:');
    if (!reason) return;
    const response = await fetch('/api/admin/certificates', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action: 'cancel', reason }),
    });
    const data = await response.json().catch(() => ({}));
    setMessage(response.ok ? 'Cancelado e auditado.' : data.error || 'Não foi possível cancelar.');
    if (response.ok) await load();
  }

  function onTypeChange(value: string) {
    const nextHourly = hourlyTypes.has(value);
    setForm({
      ...form,
      type: value,
      endDate: nextHourly ? form.startDate : form.endDate,
      startTime: nextHourly ? form.startTime : '',
      endTime: nextHourly ? form.endTime : '',
    });
  }

  const helpText = isExternal
    ? isHourly
      ? 'Trabalho externo parcial: informe a data e o intervalo de horas fora da unidade (ex.: manhã ou tarde). Somente essas horas serão abonadas.'
      : 'Trabalho externo integral: o dia inteiro será abonado (reunião, visita, atividade externa).'
    : isHourly
      ? 'Atestado por horas: informe a data e o período de ausência. Somente as horas informadas serão abonadas.'
      : 'Atestado por dias: informe a data inicial e a data final do afastamento.';

  return (
    <section className="admin-two-col certificates-layout">
      <div className="card">
        <div className="section-heading">
          <div>
            <span className="eyebrow">JUSTIFICATIVA FORMAL</span>
            <h2>Lançar atestado ou trabalho externo</h2>
            <p className="small-muted">
              Não cria batida. Após aprovação, abona o dia ou as horas na folha (incluindo metade do dia).
            </p>
          </div>
        </div>

        <label className="small-muted">
          Funcionário
          <select
            className="input"
            value={form.userId}
            onChange={(e) => setForm({ ...form, userId: e.target.value })}
          >
            <option value="">Selecione por nome ou matrícula</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.employeeNumber || '—'} · {employee.name}
              </option>
            ))}
          </select>
        </label>

        <label className="small-muted">
          Tipo
          <select className="input" value={form.type} onChange={(e) => onTypeChange(e.target.value)}>
            {Object.entries(certificateTypeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <p className="certificate-help">{helpText}</p>

        {isHourly ? (
          <>
            <label className="small-muted">
              Data
              <input
                className="input"
                type="date"
                value={form.startDate}
                onChange={(e) =>
                  setForm({ ...form, startDate: e.target.value, endDate: e.target.value })
                }
              />
            </label>
            <div className="form-two-col">
              <label className="small-muted">
                Hora inicial
                <input
                  className="input"
                  type="time"
                  value={form.startTime}
                  onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                />
              </label>
              <label className="small-muted">
                Hora final
                <input
                  className="input"
                  type="time"
                  value={form.endTime}
                  onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                />
              </label>
            </div>
            <div className="certificate-day-count">
              🕐 Total abonado: <strong>{hourDuration === -1 ? 'Horário inválido' : durationText(hourDuration)}</strong>
            </div>
          </>
        ) : (
          <>
            <div className="form-two-col">
              <label className="small-muted">
                Data inicial
                <input
                  className="input"
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                />
              </label>
              <label className="small-muted">
                Data final
                <input
                  className="input"
                  type="date"
                  value={form.endDate}
                  onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                />
              </label>
            </div>
            <div className="certificate-day-count">
              Período: <strong>{periodDays(form.startDate, form.endDate)} dia(s)</strong>
            </div>
          </>
        )}

        <label className="small-muted">
          Documento (opcional)
          <input
            className="input"
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          {document ? <small>{document.name}</small> : null}
        </label>

        <label className="small-muted">
          Observação {isExternal ? '(local, reunião, etc.)' : ''}
          <textarea
            className="input"
            rows={3}
            value={form.observation}
            onChange={(e) => setForm({ ...form, observation: e.target.value })}
            placeholder={
              isExternal
                ? 'Ex.: Reunião Mesa Brasil / visita institucional / atividade externa'
                : undefined
            }
          />
        </label>

        <button className="primary-btn" type="button" onClick={() => void create()} disabled={saving}>
          {saving ? 'Salvando...' : isExternal ? 'Lançar trabalho externo' : 'Lançar atestado'}
        </button>
        {message ? <p className="status-msg">{message}</p> : null}
      </div>

      <div className="card">
        <div className="section-heading">
          <div>
            <span className="eyebrow">HISTÓRICO OFICIAL</span>
            <h2>Atestados e trabalhos externos</h2>
            <p className="small-muted">Sem exclusão física; cancelamentos permanecem auditados.</p>
          </div>
          <button className="ghost-btn" type="button" onClick={() => void load()}>
            Atualizar
          </button>
        </div>
        <input
          className="input"
          placeholder="Buscar nome, matrícula ou CPF"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="certificate-list">
          {filtered.map((item) => (
            <div className="certificate-row" key={item.id}>
              <div>
                <strong>{item.user.name}</strong>
                <span>
                  {item.user.employeeNumber || 'Sem matrícula'} · {dateText(item.startDate)} a{' '}
                  {dateText(item.endDate)} · {item.daysCount} dia(s)
                </span>
                <small>
                  {certificateTypeLabels[item.type] || 'Atestado'} · {item.documentName || 'Sem documento'} ·{' '}
                  {item.startTime && item.endTime
                    ? `${item.startTime}–${item.endTime} · ${Math.floor((item.hoursPerDayMinutes || 0) / 60)}h${String((item.hoursPerDayMinutes || 0) % 60).padStart(2, '0')}`
                    : 'Dia inteiro'}{' '}
                  · {item.status}
                  {item.observation ? ` · ${item.observation}` : ''}
                </small>
              </div>
              {item.status === 'PENDENTE' ? (
                <div className="row-actions">
                  <button className="primary-btn compact-btn" type="button" onClick={() => void review(item.id, 'approve')}>
                    Aprovar
                  </button>
                  <button className="danger-btn compact-btn" type="button" onClick={() => void review(item.id, 'reject')}>
                    Rejeitar
                  </button>
                </div>
              ) : item.status !== 'CANCELADO' ? (
                <button className="ghost-btn" type="button" onClick={() => void cancel(item.id)}>
                  Cancelar
                </button>
              ) : (
                <span className="status-pill off">Cancelado</span>
              )}
            </div>
          ))}
          {!filtered.length ? <p className="small-muted">Nenhum registro encontrado.</p> : null}
        </div>
      </div>
    </section>
  );
}
