"use client";

import React, { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await signIn('credentials', { redirect: false, email, password });
    setLoading(false);
    if (res && (res as any).ok) router.push('/admin');
    else setError((res as any)?.error || 'Falha ao autenticar');
  }

  return <main className="signin-wrapper"><div className="signin-box card"><div className="signin-title">Entrar</div><form onSubmit={handleSubmit}><div className="form-field"><label className="small-muted">Email</label><input className="input" value={email} onChange={(e)=>setEmail(e.target.value)} type="email" autoComplete="username" required /></div><div className="form-field"><label className="small-muted">Senha</label><input className="input" value={password} onChange={(e)=>setPassword(e.target.value)} type="password" autoComplete="current-password" required /></div>{error && <div style={{color:'var(--error)',marginBottom:8}}>{error}</div>}<button className="btn-secondary" disabled={loading} type="submit">{loading ? 'Entrando...' : 'Entrar'}</button></form></div></main>;
}
