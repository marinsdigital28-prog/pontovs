'use client';

import { useCallback, useEffect, useState } from 'react';

type Summary = {
  generatedAt: string;
  totals: {
    users: number;
    punches: number;
    punchesWithPhoto: number;
    certificates: number;
    requests: number;
    units: number;
    openInconsistencies: number;
    auditEvents: number;
  };
  month: { month: string; punches: number; withPhoto: number } | null;
  advice?: string;
};

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function BackupPanel() {
  const [month, setMonth] = useState(currentMonth);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [includePhotos, setIncludePhotos] = useState(false);

  const loadSummary = useCallback(async () => {
    setError('');
    try {
      const response = await fetch(`/api/admin/backup?mode=summary&month=${encodeURIComponent(month)}`, {
        cache: 'no-store',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Falha ao consultar resumo do backup.');
      setSummary(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao consultar resumo.');
    }
  }, [month]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  async function download(params: { format: 'json' | 'csv'; scope: 'month' | 'full' }) {
    setBusy(params.format === 'json' ? 'Gerando JSON...' : 'Gerando CSV...');
    setError('');
    try {
      const qs = new URLSearchParams({
        mode: 'export',
        format: params.format,
      });
      if (params.scope === 'month') qs.set('month', month);
      if (includePhotos) qs.set('photos', '1');
      const response = await fetch(`/api/admin/backup?${qs.toString()}`, { cache: 'no-store' });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Não foi possível baixar o backup.');
      }
      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match?.[1] || `backup-ponto.${params.format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      await loadSummary();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha no download.');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <div className="section-heading">
        <div>
          <span className="eyebrow">SEGURANÇA DOS DADOS</span>
          <h3 style={{ margin: '4px 0' }}>Backup operacional</h3>
          <p className="small-muted">
            Baixe uma cópia dos cadastros, marcações, atestados e solicitações. Senhas nunca são exportadas.
            Guarde o arquivo em local seguro (Drive/HD externo).
          </p>
        </div>
        <button type="button" className="ghost-btn" onClick={() => void loadSummary()} disabled={Boolean(busy)}>
          Atualizar resumo
        </button>
      </div>

      {error ? <div className="status-msg">{error}</div> : null}
      {busy ? <div className="status-msg">{busy}</div> : null}

      <div className="row-actions" style={{ flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
        <label className="small-muted">
          Competência
          <input className="input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </label>
        <label className="small-muted" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={includePhotos} onChange={(e) => setIncludePhotos(e.target.checked)} />
          Incluir fotos das marcações (arquivo bem maior)
        </label>
      </div>

      {summary ? (
        <div className="stat-grid admin-stat-grid" style={{ marginBottom: 16 }}>
          <div className="summary">
            <span className="small-muted">Colaboradores / usuários</span>
            <strong>{summary.totals.users}</strong>
          </div>
          <div className="summary">
            <span className="small-muted">Marcações totais</span>
            <strong>{summary.totals.punches.toLocaleString('pt-BR')}</strong>
          </div>
          <div className="summary">
            <span className="small-muted">Com foto</span>
            <strong>{summary.totals.punchesWithPhoto.toLocaleString('pt-BR')}</strong>
          </div>
          <div className="summary">
            <span className="small-muted">Atestados</span>
            <strong>{summary.totals.certificates}</strong>
          </div>
          {summary.month ? (
            <div className="summary summary-ok">
              <span className="small-muted">Mês {summary.month.month}</span>
              <strong>{summary.month.punches.toLocaleString('pt-BR')} batidas</strong>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="small-muted">Carregando resumo...</p>
      )}

      <div className="row-actions" style={{ flexWrap: 'wrap', gap: 10 }}>
        <button type="button" className="primary-btn" disabled={Boolean(busy)} onClick={() => void download({ format: 'json', scope: 'month' })}>
          Backup do mês (JSON)
        </button>
        <button type="button" className="ghost-btn" disabled={Boolean(busy)} onClick={() => void download({ format: 'csv', scope: 'month' })}>
          Marcações do mês (CSV)
        </button>
        <button type="button" className="ghost-btn" disabled={Boolean(busy)} onClick={() => void download({ format: 'json', scope: 'full' })}>
          Backup completo (JSON)
        </button>
        <button type="button" className="ghost-btn" disabled={Boolean(busy)} onClick={() => void download({ format: 'csv', scope: 'full' })}>
          Todas marcações (CSV)
        </button>
      </div>

      <p className="small-muted" style={{ marginTop: 12 }}>
        {summary?.advice ||
          'Faça backup do mês antes do fechamento da folha. Com fotos, o download pode demorar e consumir mais cota.'}
      </p>
    </div>
  );
}
