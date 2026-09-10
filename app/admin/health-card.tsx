'use client';

import { useCallback, useEffect, useState } from 'react';

type StorageMetrics = {
  databaseBytes: number;
  databaseLabel: string;
  limitBytes: number;
  limitLabel: string;
  usedPercent: number;
  status: 'ok' | 'warn' | 'critical';
  freeBytes: number;
  freeLabel: string;
  tables: Array<{ name: string; bytes: number; label: string }>;
  photos: { count: number; bytes: number; label: string; avgBytes: number };
  month: {
    punches: number;
    withPhoto: number;
    photoBytes: number;
    photoLabel: string;
    daysElapsed: number;
    daysInMonth: number;
    projectedPhotoBytes: number;
    projectedPhotoLabel: string;
    projectedTotalBytes: number;
    projectedTotalLabel: string;
    projectedPercent: number;
    safeUntilMonthEnd: boolean;
  };
};

type Health = {
  checkedAt: string;
  api: string;
  database: string;
  databaseLatencyMs: number | null;
  notifications: { provider: string; automaticDispatch: string };
  storage?: StorageMetrics | null;
  note?: string;
};

export default function HealthCard() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/health', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Não foi possível consultar a saúde do sistema.');
      setHealth(data);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível consultar a saúde do sistema.');
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 30000);
    return () => window.clearInterval(timer);
  }, [load]);

  const storage = health?.storage;
  const barColor =
    storage?.status === 'critical' ? '#c0392b' : storage?.status === 'warn' ? '#d68910' : '#0b5c42';

  return (
    <div className="card health-card">
      <div className="section-heading">
        <div>
          <span className="eyebrow">CONFIABILIDADE</span>
          <h3>Saúde do sistema</h3>
          <p className="small-muted">Verificação automática a cada 30 segundos.</p>
        </div>
        <button type="button" className="ghost-btn" onClick={() => void load()}>
          Verificar
        </button>
      </div>

      {error ? <p className="status-msg">{error}</p> : null}

      {health ? (
        <>
          <div className="health-grid">
            <div>
              <span className="health-icon ok">✓</span>
              <strong>API</strong>
              <small>Operacional</small>
            </div>
            <div>
              <span className={`health-icon ${health.database === 'operacional' ? 'ok' : 'bad'}`}>
                {health.database === 'operacional' ? '✓' : '!'}
              </span>
              <strong>Banco</strong>
              <small>
                {health.database === 'operacional'
                  ? `Operacional${health.databaseLatencyMs !== null ? ` · ${health.databaseLatencyMs}ms` : ''}`
                  : 'Indisponível'}
              </small>
            </div>
            <div>
              <span
                className={`health-icon ${
                  health.notifications.automaticDispatch === 'configurado' ? 'ok' : 'warn'
                }`}
              >
                {health.notifications.automaticDispatch === 'configurado' ? '✓' : '!'}
              </span>
              <strong>E-mail</strong>
              <small>
                {health.notifications.automaticDispatch === 'configurado'
                  ? 'Automático ativo'
                  : 'Configuração pendente'}
              </small>
            </div>
          </div>

          {storage ? (
            <div className="neon-quota" style={{ marginTop: '1rem' }}>
              <div className="section-heading" style={{ marginBottom: '0.5rem' }}>
                <div>
                  <span className="eyebrow">NEON · ARMAZENAMENTO</span>
                  <h3 style={{ margin: 0, fontSize: '1rem' }}>Cota do banco</h3>
                </div>
                <strong
                  style={{
                    color: barColor,
                    fontSize: '0.95rem',
                  }}
                >
                  {storage.usedPercent}%
                </strong>
              </div>

              <div
                style={{
                  height: 10,
                  borderRadius: 999,
                  background: 'rgba(255,255,255,0.08)',
                  overflow: 'hidden',
                  border: '1px solid rgba(255,255,255,0.12)',
                }}
                role="progressbar"
                aria-valuenow={storage.usedPercent}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  style={{
                    width: `${Math.min(100, storage.usedPercent)}%`,
                    height: '100%',
                    background: barColor,
                    transition: 'width 0.4s ease',
                  }}
                />
              </div>

              <p className="small-muted" style={{ margin: '0.55rem 0 0.35rem' }}>
                <b>{storage.databaseLabel}</b> usados de <b>{storage.limitLabel}</b>
                {' · '}
                livre <b>{storage.freeLabel}</b>
              </p>

              <div
                style={{
                  display: 'grid',
                  gap: '0.35rem',
                  fontSize: '0.82rem',
                  marginTop: '0.65rem',
                }}
              >
                <div>
                  <span className="small-muted">Fotos no banco: </span>
                  <b>
                    {storage.photos.count.toLocaleString('pt-BR')} · {storage.photos.label}
                  </b>
                </div>
                <div>
                  <span className="small-muted">Este mês: </span>
                  <b>
                    {storage.month.punches.toLocaleString('pt-BR')} marcações
                    {storage.month.withPhoto
                      ? ` · ${storage.month.withPhoto.toLocaleString('pt-BR')} com foto (${storage.month.photoLabel})`
                      : ''}
                  </b>
                </div>
                <div>
                  <span className="small-muted">Projeção fim do mês: </span>
                  <b>
                    {storage.month.projectedTotalLabel} ({storage.month.projectedPercent}% da cota)
                  </b>
                </div>
              </div>

              <p
                style={{
                  margin: '0.75rem 0 0',
                  padding: '0.55rem 0.7rem',
                  borderRadius: 8,
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  background:
                    storage.month.safeUntilMonthEnd && storage.status === 'ok'
                      ? 'rgba(13, 92, 46, 0.2)'
                      : storage.status === 'critical'
                        ? 'rgba(192, 57, 43, 0.18)'
                        : 'rgba(214, 137, 16, 0.16)',
                  border: `1px solid ${
                    storage.month.safeUntilMonthEnd && storage.status === 'ok'
                      ? 'rgba(61, 214, 140, 0.35)'
                      : storage.status === 'critical'
                        ? 'rgba(231, 76, 60, 0.35)'
                        : 'rgba(243, 156, 18, 0.35)'
                  }`,
                }}
              >
                {storage.month.safeUntilMonthEnd && storage.status === 'ok'
                  ? '✓ Margem segura para as marcações até o fim do mês (pelo ritmo atual).'
                  : storage.status === 'critical'
                    ? '⚠ Cota crítica: risco de falha ao gravar novas marcações. Libere espaço (fotos antigas) ou amplie o plano Neon.'
                    : '⚠ Atenção: uso elevado. Acompanhe de perto; considere limpar fotos antigas antes do fim do mês.'}
              </p>

              {storage.tables?.length ? (
                <details style={{ marginTop: '0.65rem' }}>
                  <summary className="small-muted" style={{ cursor: 'pointer' }}>
                    Tabelas que mais ocupam espaço
                  </summary>
                  <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem', fontSize: '0.8rem' }}>
                    {storage.tables.map((t) => (
                      <li key={t.name}>
                        <code>{t.name}</code> — {t.label}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : health.database === 'operacional' ? (
            <p className="small-muted" style={{ marginTop: '0.75rem' }}>
              Não foi possível medir o armazenamento neste momento.
            </p>
          ) : null}
        </>
      ) : !error ? (
        <p className="small-muted">Consultando serviços...</p>
      ) : null}
    </div>
  );
}
