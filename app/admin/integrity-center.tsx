'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type Issue = {
  id: string;
  type: string;
  status: string;
  description: string | null;
  detectedAt: string;
  user: { name: string; employeeNumber: string | null };
  punch: { id: string; type: string; timestamp: string } | null;
};

type RequestItem = {
  id: string;
  type: string;
  status: string;
  startDate: string;
  endDate: string;
  reason: string;
  createdAt: string;
  employee: { name: string; employeeNumber: string | null };
};

type Certificate = {
  id: string;
  type: string;
  status: string;
  startDate: string;
  endDate: string;
  observation?: string | null;
  user: { name: string; employeeNumber: string | null };
  createdAt: string;
};

type AuditEvent = {
  id: string;
  action: string;
  resource?: string | null;
  createdAt: string;
  actorId?: string | null;
};

type PresenceEmployee = {
  id: string;
  name: string;
  employeeNumber: string | null;
  status: 'PRESENTE' | 'NAO_MARCOU' | 'PENDENTE' | 'SAIU' | 'FOLGA';
};

const APP_TZ = 'America/Sao_Paulo';
const fmtDateTime = new Intl.DateTimeFormat('pt-BR', { timeZone: APP_TZ, dateStyle: 'short', timeStyle: 'short' });
const fmtDate = new Intl.DateTimeFormat('pt-BR', { timeZone: APP_TZ, dateStyle: 'short' });

function monthLabel(d = new Date()) {
  return d.toLocaleDateString('pt-BR', { timeZone: APP_TZ, month: 'long', year: 'numeric' });
}

export default function IntegrityCenter() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [presence, setPresence] = useState<PresenceEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [message, setMessage] = useState('');

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [issRes, reqRes, certRes, audRes, presRes] = await Promise.all([
        fetch('/api/admin/inconsistencies', { cache: 'no-store' }),
        fetch('/api/admin/requests', { cache: 'no-store' }),
        fetch('/api/admin/certificates', { cache: 'no-store' }),
        fetch('/api/admin/audit', { cache: 'no-store' }),
        fetch('/api/admin/presence', { cache: 'no-store' }),
      ]);

      if (issRes.ok) {
        const data = await issRes.json();
        setIssues(Array.isArray(data.inconsistencies) ? data.inconsistencies : []);
      }
      if (reqRes.ok) {
        const data = await reqRes.json();
        setRequests(Array.isArray(data.requests) ? data.requests : []);
      }
      if (certRes.ok) {
        const data = await certRes.json();
        const list = data.certificates || data.items || data || [];
        setCertificates(Array.isArray(list) ? list : []);
      }
      if (audRes.ok) {
        const data = await audRes.json();
        setAudit(Array.isArray(data.events) ? data.events.slice(0, 30) : []);
      }
      if (presRes.ok) {
        const data = await presRes.json();
        setPresence(Array.isArray(data.employees) ? data.employees : []);
      }
      setLastUpdated(new Date());
    } catch {
      setMessage('Não foi possível carregar todos os dados da Central de Integridade.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadAll();
    }, 20000);
    return () => window.clearInterval(timer);
  }, [loadAll]);

  const openIssues = useMemo(() => issues.filter((i) => i.status === 'OPEN'), [issues]);
  const pendingRequests = useMemo(() => requests.filter((r) => r.status === 'PENDENTE'), [requests]);
  const pendingCerts = useMemo(
    () => certificates.filter((c) => ['PENDENTE', 'ATIVO', 'PENDING'].includes(String(c.status || '').toUpperCase())),
    [certificates],
  );
  const naoMarcou = useMemo(() => presence.filter((p) => p.status === 'NAO_MARCOU'), [presence]);
  const pendentePresenca = useMemo(() => presence.filter((p) => p.status === 'PENDENTE'), [presence]);

  const totalAlerts = openIssues.length + pendingRequests.length + pendingCerts.length + naoMarcou.length + pendentePresenca.length;

  const currentMonth = monthLabel();

  return (
    <section className="card integrity-center">
      <div className="section-heading">
        <div>
          <span className="eyebrow">GOVERNANÇA OPERACIONAL</span>
          <h2>Central de Integridade</h2>
          <p className="small-muted">
            Visão consolidada de riscos e pendências antes do fechamento da folha. Mês de referência: <strong>{currentMonth}</strong>
          </p>
        </div>
        <div className="row-actions">
          <button type="button" className="ghost-btn" onClick={() => void loadAll()} disabled={loading}>
            {loading ? 'Atualizando...' : 'Atualizar agora'}
          </button>
        </div>
      </div>

      {message ? <div className="status-msg admin-toast">{message}</div> : null}

      <div className="stat-grid admin-stat-grid" style={{ marginBottom: 20 }}>
        <div className={`summary ${totalAlerts > 0 ? 'summary-alert' : 'summary-ok'}`}>
          <span className="small-muted">Alertas totais</span>
          <strong>{totalAlerts}</strong>
        </div>
        <div className={`summary ${openIssues.length ? 'summary-warn' : ''}`}>
          <span className="small-muted">Inconsistências abertas</span>
          <strong>{openIssues.length}</strong>
        </div>
        <div className={`summary ${pendingRequests.length ? 'summary-warn' : ''}`}>
          <span className="small-muted">Solicitações pendentes</span>
          <strong>{pendingRequests.length}</strong>
        </div>
        <div className={`summary ${pendingCerts.length ? 'summary-warn' : ''}`}>
          <span className="small-muted">Atestados em atenção</span>
          <strong>{pendingCerts.length}</strong>
        </div>
        <div className={`summary ${naoMarcou.length ? 'summary-alert' : ''}`}>
          <span className="small-muted">Não marcaram hoje</span>
          <strong>{naoMarcou.length}</strong>
        </div>
        <div className="summary">
          <span className="small-muted">Status do mês</span>
          <strong style={{ fontSize: '0.95rem' }}>Em aberto</strong>
        </div>
      </div>

      {totalAlerts === 0 && !loading ? (
        <div className="report-empty" style={{ marginBottom: 20 }}>
          <strong>Nenhum alerta crítico no momento</strong>
          <span>Não foram identificadas inconsistências abertas, solicitações ou atestados pendentes relevantes.</span>
        </div>
      ) : null}

      <div className="integrity-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ margin: '0 0 12px' }}>Inconsistências abertas</h3>
          {!openIssues.length ? (
            <p className="small-muted">Nenhuma inconsistência aberta.</p>
          ) : (
            <div className="employee-list">
              {openIssues.slice(0, 12).map((issue) => (
                <div className="employee-row" key={issue.id} style={{ padding: '8px 0' }}>
                  <div>
                    <strong>{issue.user.name}</strong>
                    <div className="small-muted">
                      {issue.type} · {fmtDateTime.format(new Date(issue.detectedAt))}
                      {issue.description ? ` — ${issue.description}` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ margin: '0 0 12px' }}>Solicitações pendentes</h3>
          {!pendingRequests.length ? (
            <p className="small-muted">Nenhuma solicitação aguardando decisão.</p>
          ) : (
            <div className="employee-list">
              {pendingRequests.slice(0, 12).map((req) => (
                <div className="employee-row" key={req.id} style={{ padding: '8px 0' }}>
                  <div>
                    <strong>{req.employee.name}</strong>
                    <div className="small-muted">
                      {req.type} · {fmtDate.format(new Date(req.startDate))}
                      {req.endDate !== req.startDate ? ` até ${fmtDate.format(new Date(req.endDate))}` : ''}
                      {' — '}{req.reason}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ margin: '0 0 12px' }}>Atestados em atenção</h3>
          {!pendingCerts.length ? (
            <p className="small-muted">Nenhum atestado pendente ou ativo relevante.</p>
          ) : (
            <div className="employee-list">
              {pendingCerts.slice(0, 12).map((cert) => (
                <div className="employee-row" key={cert.id} style={{ padding: '8px 0' }}>
                  <div>
                    <strong>{cert.user?.name || 'Colaborador'}</strong>
                    <div className="small-muted">
                      {cert.type} · {fmtDate.format(new Date(cert.startDate))} – {fmtDate.format(new Date(cert.endDate))} · {cert.status}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ margin: '0 0 12px' }}>Presença de hoje — atenção</h3>
          {!naoMarcou.length && !pendentePresenca.length ? (
            <p className="small-muted">Nenhum colaborador em situação crítica de presença.</p>
          ) : (
            <div className="employee-list">
              {[...naoMarcou, ...pendentePresenca].slice(0, 15).map((p) => (
                <div className="employee-row" key={p.id} style={{ padding: '8px 0' }}>
                  <div>
                    <strong>{p.name}</strong>
                    <div className="small-muted">
                      {p.employeeNumber || 'Sem matrícula'} · {p.status === 'NAO_MARCOU' ? 'Não marcou' : 'Revisar'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 20, padding: 16 }}>
        <div className="section-heading" style={{ marginBottom: 12 }}>
          <div>
            <h3 style={{ margin: 0 }}>Alterações administrativas recentes</h3>
            <p className="small-muted">Últimos eventos registrados na trilha de auditoria de segurança.</p>
          </div>
        </div>
        {!audit.length ? (
          <p className="small-muted">Nenhum evento recente carregado.</p>
        ) : (
          <div className="employee-list">
            {audit.map((ev) => (
              <div className="employee-row" key={ev.id} style={{ padding: '6px 0' }}>
                <div>
                  <strong>{ev.action}</strong>
                  <div className="small-muted">
                    {ev.resource || '—'} · {fmtDateTime.format(new Date(ev.createdAt))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 20, padding: 16, border: '1px solid #f0c14b' }}>
        <div className="section-heading">
          <div>
            <span className="eyebrow">FECHAMENTO MENSAL</span>
            <h3 style={{ margin: '4px 0' }}>Período {currentMonth} — Em aberto</h3>
            <p className="small-muted">
              O fechamento formal ainda não foi executado. Nenhum dado será arquivado ou removido automaticamente.
              Quando a contabilidade e a gestão concluírem a conferência, o status poderá ser alterado para “Fechado”.
            </p>
          </div>
        </div>
        <div className="status-msg" style={{ marginTop: 8 }}>
          ⚠️ Arquivamento e limpeza só serão permitidos após: (1) mês marcado como fechado, (2) backup validado e (3) confirmação explícita.
        </div>
      </div>

      {lastUpdated ? (
        <div className="report-updated" style={{ marginTop: 12 }}>
          Atualizado às {lastUpdated.toLocaleTimeString('pt-BR')}
        </div>
      ) : null}
    </section>
  );
}
