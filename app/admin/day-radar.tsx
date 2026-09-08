'use client';

import { useMemo } from 'react';
import './day-radar.css';

type PresenceEmployee = {
  id: string;
  name: string;
  employeeNumber: string | null;
  jobTitle?: string | null;
  status: 'PRESENTE' | 'NAO_MARCOU' | 'PENDENTE' | 'SAIU' | 'FOLGA';
  scheduled: boolean;
  latestPunch: { id: string; type: string; timestamp: string; status: string; hasPhoto: boolean } | null;
};

type Employee = {
  id: string;
  name: string;
  employeeNumber: string | null;
  scheduleStart?: string | null;
  scheduleEnd?: string | null;
  profile?: { phone?: string | null } | null;
  phone?: string | null;
};

const STATUS_META: Record<
  PresenceEmployee['status'],
  { label: string; tone: string; hint: string }
> = {
  NAO_MARCOU: { label: 'Não marcou', tone: 'danger', hint: 'Sem batida de entrada hoje' },
  PENDENTE: { label: 'Pendente', tone: 'warn', hint: 'Aguardando confirmação / atraso' },
  PRESENTE: { label: 'Presente', tone: 'ok', hint: 'No expediente' },
  SAIU: { label: 'Já saiu', tone: 'muted', hint: 'Saída registrada' },
  FOLGA: { label: 'Folga', tone: 'muted', hint: 'Sem expediente hoje' },
};

function phoneOf(emp: Employee | undefined) {
  if (!emp) return null;
  const raw = emp.phone || emp.profile?.phone || null;
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < 10) return null;
  return digits.startsWith('55') ? digits : `55${digits}`;
}

function fmtTime(iso: string | null | undefined) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

export default function DayRadar({
  presence,
  employees,
}: {
  presence: PresenceEmployee[];
  employees: Employee[];
}) {
  const byId = useMemo(() => {
    const m = new Map<string, Employee>();
    for (const e of employees) m.set(e.id, e);
    return m;
  }, [employees]);

  const stats = useMemo(() => {
    const scheduled = presence.filter((p) => p.scheduled);
    return {
      total: scheduled.length || presence.length,
      presente: presence.filter((p) => p.status === 'PRESENTE').length,
      naoMarcou: presence.filter((p) => p.status === 'NAO_MARCOU' && p.scheduled).length,
      pendente: presence.filter((p) => p.status === 'PENDENTE').length,
      saiu: presence.filter((p) => p.status === 'SAIU').length,
      folga: presence.filter((p) => p.status === 'FOLGA').length,
    };
  }, [presence]);

  const risks = useMemo(() => {
    return presence
      .filter((p) => p.scheduled && (p.status === 'NAO_MARCOU' || p.status === 'PENDENTE'))
      .sort((a, b) => {
        const rank = (s: string) => (s === 'NAO_MARCOU' ? 0 : 1);
        return rank(a.status) - rank(b.status) || a.name.localeCompare(b.name, 'pt-BR');
      });
  }, [presence]);

  const riskScore = stats.naoMarcou * 3 + stats.pendente * 2;
  const level = riskScore === 0 ? 'ok' : riskScore <= 4 ? 'warn' : 'danger';

  return (
    <section className={`card day-radar day-radar-${level}`}>
      <div className="section-heading">
        <div>
          <span className="eyebrow">RADAR DO DIA</span>
          <h3>Risco operacional agora</h3>
          <p className="small-muted">
            Quem deveria estar no ponto e ainda não está · atualiza com a presença ao vivo
          </p>
        </div>
        <div className={`day-radar-badge day-radar-badge-${level}`}>
          {level === 'ok' ? 'Dia sob controle' : level === 'warn' ? 'Atenção' : 'Risco alto'}
        </div>
      </div>

      <div className="day-radar-kpis">
        <div className="day-radar-kpi">
          <span>No expediente</span>
          <strong>{stats.presente}</strong>
        </div>
        <div className="day-radar-kpi danger">
          <span>Não marcou</span>
          <strong>{stats.naoMarcou}</strong>
        </div>
        <div className="day-radar-kpi warn">
          <span>Pendentes</span>
          <strong>{stats.pendente}</strong>
        </div>
        <div className="day-radar-kpi">
          <span>Já saíram</span>
          <strong>{stats.saiu}</strong>
        </div>
      </div>

      {!risks.length ? (
        <p className="small-muted day-radar-empty">Ninguém em risco no momento. Todos os escalados estão ok ou em folga.</p>
      ) : (
        <ul className="day-radar-list">
          {risks.slice(0, 10).map((p) => {
            const emp = byId.get(p.id);
            const phone = phoneOf(emp);
            const meta = STATUS_META[p.status];
            const waText = encodeURIComponent(
              `Olá ${p.name.split(' ')[0]}, tudo bem?\n\nAqui é da administração do Espaço Progredir. Notamos que ainda não há marcação de ponto registrada hoje (${meta.hint.toLowerCase()}).\n\nPode confirmar, por favor?`,
            );
            return (
              <li key={p.id} className={`day-radar-item tone-${meta.tone}`}>
                <div>
                  <strong>{p.name}</strong>
                  <span className="small-muted">
                    {p.employeeNumber || 'Sem matrícula'}
                    {emp?.scheduleStart ? ` · escala ${emp.scheduleStart}` : ''}
                    {p.latestPunch ? ` · última ${fmtTime(p.latestPunch.timestamp)}` : ''}
                  </span>
                  <small>{meta.hint}</small>
                </div>
                <div className="day-radar-actions">
                  <span className={`status-pill ${meta.tone === 'danger' ? 'off' : meta.tone === 'warn' ? 'pending' : 'ok'}`}>
                    {meta.label}
                  </span>
                  {phone ? (
                    <a
                      className="ghost-btn compact-btn day-radar-wa"
                      href={`https://wa.me/${phone}?text=${waText}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      WhatsApp
                    </a>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {risks.length > 10 ? (
        <p className="small-muted">+{risks.length - 10} outros em risco — veja a grade de presença acima.</p>
      ) : null}
    </section>
  );
}
