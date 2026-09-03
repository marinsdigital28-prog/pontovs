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
  employee?: { name: string; employeeNumber: string | null } | null;
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
      const list =
        Array.isArray(iJson.inconsistencies)
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
      title: `${r.employee?.name || 'Colaborador'} · ${TYPE_LABEL[r.type] || r.type}`,
      subtitle: r.classification
        ? `${r.classification} · ${r.reason}`
        : r.reason,
      when: r.createdAt || r.startDate,
      status: r.status,
    }));
    const b = openIssues.map((i) => ({
      kind: 'issue' as const,
      id: i.id,
      title: `${i.user?.name || 'Colaborador'} · ${i.type}`,
      subtitle: i.description || 'Inconsistência aberta',
      when: i.detectedAt,
      status: i.status,
    }));
    return [...a, ...b]
      .sort((x, y) => new Date(y.when).getTime() - new Date(x.when).getTime())
      .slice(0, 12);
  }, [pendingReqs, openIssues]);

  const approve = async (id: string) => {
    setMessage('');
    const res = await fetch('/api/admin/requests', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, decision: 'APROVAR' }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(data.error || 'Não foi possível aprovar.');
      return;
    }
    setMessage('Solicitação aprovada.');
    void load();
  };

  return (
    <div className="card overview-inbox">
      <div className="section-heading">
        <div>
          <span className="eyebrow">FILA ÚNICA</span>
          <h3>Pendências para resolver</h3>
          <p className="small-muted">
            Solicitações + inconsistências · {pendingReqs.length} sol. · {openIssues.length} inc.
            {loading ? ' · atualizando…' : ''}
          </p>
        </div>
        <div className="row-actions">
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
            <li key={`${item.kind}-${item.id}`} className={`ov-inbox-item ov-inbox-${item.kind}`}>
              <div>
                <strong>{item.title}</strong>
                <span className="small-muted">{item.subtitle}</span>
                <small>{fmtDate(item.when)}</small>
              </div>
              <div className="ov-inbox-actions">
                {item.kind === 'request' ? (
                  <button type="button" className="primary-btn compact-btn" onClick={() => void approve(item.id)}>
                    Aprovar
                  </button>
                ) : null}
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
