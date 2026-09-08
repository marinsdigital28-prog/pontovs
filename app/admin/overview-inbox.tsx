'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type Req = {
  id: string;
  type: string;
  status: string;
  reason: string;
  classification?: string | null;
  startDate: string;
  createdAt: string;
  employee?: { name: string; employeeNumber: string | null; phone?: string | null } | null;
};

type Issue = {
  id: string;
  type: string;
  status: string;
  description: string | null;
  detectedAt: string;
  user: { name: string; employeeNumber: string | null };
};

const TYPE_LABEL: Record<string, string> = {
  AUSENCIA: 'Ausência',
  ESQUECI_PONTO: 'Esqueci o ponto',
  AVISO_ATRASO: 'Aviso de atraso',
  TROCA_DIA: 'Troca de dia',
  LEMBRETE: 'Lembrete',
  COMPROVANTE: 'Comprovante',
  PASSEIO: 'Passeio / evento',
  EVENTO_EXTERNO: 'Evento externo',
};

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function OverviewInbox({
  onOpenRequests,
  onOpenIssues,
}: {
  onOpenRequests: () => void;
  onOpenIssues: () => void;
}) {
  const [requests, setRequests] = useState<Req[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rRes, iRes] = await Promise.all([
        fetch('/api/admin/requests', { cache: 'no-store' }),
        fetch('/api/admin/inconsistencies', { cache: 'no-store' }),
      ]);
      const rJson = await rRes.json().catch(() => ({}));
      const iJson = await iRes.json().catch(() => ({}));
      setRequests(Array.isArray(rJson.requests) ? rJson.requests : []);
      const list = Array.isArray(iJson.inconsistencies)
        ? iJson.inconsistencies
        : Array.isArray(iJson.issues)
          ? iJson.issues
          : [];
      setIssues(list);
    } catch {
      setMessage('Não foi possível carregar a fila de pendências.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 30000);
    return () => window.clearInterval(t);
  }, [load]);

  const pendingReqs = useMemo(
    () => requests.filter((r) => String(r.status).toUpperCase() === 'PENDENTE'),
    [requests],
  );
  const openIssues = useMemo(
    () =>
      issues.filter((i) => {
        const s = String(i.status || '').toUpperCase();
        return s === 'OPEN' || s === 'ABERTA' || s === 'PENDENTE' || !s;
      }),
    [issues],
  );

  const items = useMemo(() => {
    const a = pendingReqs.map((r) => ({
      kind: 'request' as const,
      id: r.id,
      type: r.type,
      title: `${r.employee?.name || 'Colaborador'} · ${TYPE_LABEL[r.type] || r.type}`,
      subtitle: r.classification ? `${r.classification} · ${r.reason}` : r.reason,
      when: r.createdAt || r.startDate,
      status: r.status,
      priority: r.type === 'ESQUECI_PONTO' || r.type === 'AVISO_ATRASO' ? 0 : 1,
    }));
    const b = openIssues.map((i) => ({
      kind: 'issue' as const,
      id: i.id,
      type: i.type,
      title: `${i.user?.name || 'Colaborador'} · ${i.type}`,
      subtitle: i.description || 'Inconsistência aberta',
      when: i.detectedAt,
      status: i.status,
      priority: 2,
    }));
    return [...a, ...b]
      .sort((x, y) => x.priority - y.priority || new Date(y.when).getTime() - new Date(x.when).getTime())
      .slice(0, 14);
  }, [pendingReqs, openIssues]);

  const decide = async (id: string, decision: 'APROVAR' | 'REJEITAR') => {
    setBusyId(id);
    setMessage('');
    try {
      const res = await fetch('/api/admin/requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, decision }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(data.error || 'Não foi possível decidir.');
        return;
      }
      setMessage(decision === 'APROVAR' ? 'Solicitação aprovada.' : 'Solicitação rejeitada.');
      void load();
    } finally {
      setBusyId(null);
    }
  };

  const resolveIssue = async (id: string) => {
    setBusyId(id);
    setMessage('');
    try {
      const res = await fetch('/api/admin/inconsistencies', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'RESOLVED' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMessage(data.error || 'Não foi possível resolver.');
        return;
      }
      setMessage('Inconsistência resolvida.');
      void load();
    } finally {
      setBusyId(null);
    }
  };

  const total = pendingReqs.length + openIssues.length;

  return (
    <div className="card overview-inbox">
      <div className="section-heading">
        <div>
          <span className="eyebrow">FILA ÚNICA</span>
          <h3>Pendências para resolver</h3>
          <p className="small-muted">
            Solicitações + inconsistências · <b>{pendingReqs.length}</b> sol. · <b>{openIssues.length}</b> inc.
            {loading ? ' · atualizando…' : ''}
          </p>
        </div>
        <div className="row-actions">
          <span className={`status-pill ${total ? 'pending' : 'ok'}`}>{total ? `${total} aberta(s)` : 'Em dia'}</span>
          <button type="button" className="ghost-btn" onClick={() => void load()}>
            Atualizar
          </button>
          <button type="button" className="ghost-btn" onClick={onOpenRequests}>
            Solicitações
          </button>
          <button type="button" className="ghost-btn" onClick={onOpenIssues}>
            Inconsistências
          </button>
        </div>
      </div>

      {message ? <p className="status-msg">{message}</p> : null}

      {!items.length ? (
        <p className="small-muted ov-inbox-empty">Nada pendente no momento. Bom sinal.</p>
      ) : (
        <ul className="ov-inbox-list">
          {items.map((item) => (
            <li
              key={`${item.kind}-${item.id}`}
              className={`ov-inbox-item ov-inbox-${item.kind} ${item.type === 'ESQUECI_PONTO' ? 'ov-inbox-forgot' : ''}`}
            >
              <div>
                <strong>{item.title}</strong>
                <span className="small-muted">{item.subtitle}</span>
                <small>{fmtDate(item.when)}</small>
              </div>
              <div className="ov-inbox-actions">
                {item.kind === 'request' ? (
                  <>
                    <button
                      type="button"
                      className="primary-btn compact-btn"
                      disabled={busyId === item.id}
                      onClick={() => void decide(item.id, 'APROVAR')}
                    >
                      Aprovar
                    </button>
                    <button
                      type="button"
                      className="ghost-btn compact-btn"
                      disabled={busyId === item.id}
                      onClick={() => void decide(item.id, 'REJEITAR')}
                    >
                      Rejeitar
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="primary-btn compact-btn"
                    disabled={busyId === item.id}
                    onClick={() => void resolveIssue(item.id)}
                  >
                    Resolver
                  </button>
                )}
                <button
                  type="button"
                  className="ghost-btn compact-btn"
                  onClick={item.kind === 'request' ? onOpenRequests : onOpenIssues}
                >
                  Ver
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
