'use client';

import { useCallback, useEffect, useState } from 'react';

type Conflict = {
  punchId: string;
  punchType: string;
  punchTimestamp: string;
  userId: string;
  employeeName: string;
  employeeNumber: string | null;
  certificateId: string;
  certificateType: string;
  certificateWindow: string;
  certificateObservation: string | null;
};

const punchTypeLabels: Record<string, string> = {
  ENTRADA: 'Entrada',
  INTERVALO: 'Intervalo',
  RETORNO: 'Retorno',
  SAIDA: 'Saída',
};

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

/**
 * Área para localizar conflitos atestado × ponto e ajustar manualmente.
 * Não resolve em lote automaticamente — o gestor decide caso a caso.
 */
export default function CertificateConflictsPanel() {
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin/resolve-certificate-conflicts', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(data.error || 'Não foi possível carregar os conflitos.');
        setConflicts([]);
      } else {
        setConflicts(Array.isArray(data.conflicts) ? data.conflicts : []);
        if (!(data.total > 0)) setMessage('Nenhum conflito atestado × ponto no momento.');
      }
    } catch {
      setMessage('Falha ao consultar conflitos.');
      setConflicts([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function rejectPunch(conflict: Conflict) {
    const reason =
      window.prompt(
        `Cancelar a marcação de ${conflict.employeeName}?\n\nMarcação: ${formatDateTime(conflict.punchTimestamp)} (${punchTypeLabels[conflict.punchType] || conflict.punchType})\nAtestado: ${conflict.certificateWindow}\n\nMotivo (mín. 5 caracteres):`,
        `Conflito com atestado/trabalho externo (${conflict.certificateWindow})`,
      ) || '';
    if (reason.trim().length < 5) {
      setMessage('Informe um motivo com pelo menos 5 caracteres para cancelar a marcação.');
      return;
    }
    setBusyId(conflict.punchId);
    setMessage('');
    try {
      const response = await fetch(`/api/admin/punches/${conflict.punchId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(data.error || 'Não foi possível cancelar a marcação.');
      } else {
        setMessage(`Marcação de ${conflict.employeeName} cancelada. Pode conferir em Registros de ponto.`);
        setConflicts((prev) => prev.filter((c) => c.punchId !== conflict.punchId));
      }
    } catch {
      setMessage('Falha ao cancelar a marcação.');
    }
    setBusyId(null);
  }

  return (
    <section className="card" style={{ marginTop: 16 }}>
      <div className="section-heading">
        <div>
          <span className="eyebrow">ATESTADO × PONTO</span>
          <h2>Conflitos para revisar</h2>
          <p className="small-muted">
            Lista de marcações que caem no mesmo horário de um atestado ou trabalho externo aprovado.
            Aqui você localiza e decide o que cancelar — nada é alterado em lote sem o seu clique.
          </p>
        </div>
        <button className="ghost-btn" type="button" onClick={() => void load()} disabled={loading}>
          {loading ? 'Carregando...' : 'Atualizar lista'}
        </button>
      </div>

      {message ? <p className="status-msg">{message}</p> : null}

      {!loading && conflicts.length > 0 ? (
        <div className="employee-list">
          {conflicts.map((item) => (
            <div className="employee-row" key={item.punchId}>
              <div>
                <strong>
                  {item.employeeName}
                  {item.employeeNumber ? ` · mat. ${item.employeeNumber}` : ''}
                </strong>
                <div className="small-muted">
                  Marcação: <b>{formatDateTime(item.punchTimestamp)}</b> — {punchTypeLabels[item.punchType] || item.punchType}
                </div>
                <div className="small-muted">
                  Atestado/externo: <b>{item.certificateWindow}</b>
                  {item.certificateObservation ? ` · ${item.certificateObservation}` : ''}
                </div>
              </div>
              <div className="row-actions">
                <button
                  className="danger-btn compact-btn"
                  type="button"
                  disabled={busyId === item.punchId}
                  onClick={() => void rejectPunch(item)}
                >
                  {busyId === item.punchId ? 'Cancelando...' : 'Cancelar esta marcação'}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {!loading && !conflicts.length && !message ? (
        <p className="small-muted">Nenhum conflito encontrado.</p>
      ) : null}
    </section>
  );
}
