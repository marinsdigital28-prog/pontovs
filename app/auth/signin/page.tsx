"use client";

import React, { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';

export default function SignInPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await signIn('credentials', { redirect: false, password });
    setLoading(false);
    if (res?.ok) router.push('/admin');
    else setError('Senha administrativa inválida');
  }

  return (
    <main className="signin-wrapper">
      <div className="signin-box card">
        <div className="signin-title">Acesso do gestor</div>
        <p className="small-muted" style={{ marginTop: 0 }}>Digite a senha administrativa para continuar.</p>
        <form onSubmit={handleSubmit}>
          <div className="form-field">
            <label className="small-muted" htmlFor="admin-password">Senha</label>
            <input
              id="admin-password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete="current-password"
              required
              autoFocus
            />
          </div>
          {error ? <div style={{ color: 'var(--error)', marginBottom: 8 }}>{error}</div> : null}
          <button className="btn-secondary" disabled={loading} type="submit">
            {loading ? 'Entrando...' : 'Entrar no painel'}
          </button>
        </form>
      </div>
    </main>
  );
}
