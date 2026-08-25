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
  

  
  return React.createElement('main', { className: 'signin-wrapper' },
                             
    React.createElement('div', { className: 'signin-box card' },
                        
      React.createElement('div', { className: 'signin-title' }, 'Entrar'),
                        
      React.createElement('form', { onSubmit: handleSubmit },
                          
        React.createElement('div', { className: 'form-field' },
                            
          React.createElement('label', { className: 'small-muted' }, 'Email'),
                            
          React.createElement('input', { className: 'input', value: email, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value), type: 'email', autoComplete: 'username', required: true })
                            
        ),
                          
        React.createElement('div', { className: 'form-field' },
                            
          React.createElement('label', { className: 'small-muted' }, 'Senha'),
                            
          React.createElement('input', { className: 'input', value: password, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value), type: 'password', autoComplete: 'current-password', required: true })
                            
        ),
                          
        error ? React.createElement('div', { style: { color: 'var(--error)', marginBottom: 8 } }, error) : null,
                          
        React.createElement('button', { className: 'btn-secondary', disabled: loading, type: 'submit' }, loading ? 'Entrando...' : 'Entrar'),
                          
        React.createElement('a', { href: '/auth/forgot-password', className: 'small-muted', style: { display: 'block', marginTop: 14, textAlign: 'center' } }, 'Esqueci minha senha')
                          
      )
                        
    )
                             
  );
  
}




































