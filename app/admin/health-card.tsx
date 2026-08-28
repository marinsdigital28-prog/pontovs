'use client';

import { useCallback, useEffect, useState } from 'react';

type Health = { checkedAt: string; api: string; database: string; databaseLatencyMs: number | null; notifications: { provider: string; automaticDispatch: string } };

export default function HealthCard() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/health', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Não foi possível consultar a saúde do sistema.');
      setHealth(data); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível consultar a saúde do sistema.'); }
  }, []);
  useEffect(() => { void load(); const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 30000); return () => window.clearInterval(timer); }, [load]);

  return <div className="card health-card"><div className="section-heading"><div><span className="eyebrow">CONFIABILIDADE</span><h3>Saúde do sistema</h3><p className="small-muted">Verificação automática a cada 30 segundos.</p></div><button type="button" className="ghost-btn" onClick={() => void load()}>Verificar</button></div>{error ? <p className="status-msg">{error}</p> : health ? <div className="health-grid"><div><span className="health-icon ok">✓</span><strong>API</strong><small>Operacional</small></div><div><span className={`health-icon ${health.database === 'operacional' ? 'ok' : 'bad'}`}>{health.database === 'operacional' ? '✓' : '!'}</span><strong>Banco</strong><small>{health.database === 'operacional' ? `Operacional${health.databaseLatencyMs !== null ? ` · ${health.databaseLatencyMs}ms` : ''}` : 'Indisponível'}</small></div><div><span className={`health-icon ${health.notifications.automaticDispatch === 'configurado' ? 'ok' : 'warn'}`}>{health.notifications.automaticDispatch === 'configurado' ? '✓' : '!'}</span><strong>E-mail</strong><small>{health.notifications.automaticDispatch === 'configurado' ? 'Automático ativo' : 'Configuração pendente'}</small></div></div> : <p className="small-muted">Consultando serviços...</p>}</div>;
}
