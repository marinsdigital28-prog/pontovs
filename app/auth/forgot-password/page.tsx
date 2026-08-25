'use client';



import React from 'react';



export default function ForgotPasswordPage() {
  
  return React.createElement('main', { className: 'signin-wrapper' },
                             
    React.createElement('div', { className: 'signin-box card' },
                        
      React.createElement('div', { className: 'signin-title' }, 'Esqueci minha senha'),
                        
      React.createElement('p', { className: 'small-muted' }, 'Para recuperar o acesso, solicite ao gestor uma redefinição de senha pelo painel administrativo.'),
                        
      React.createElement('p', { className: 'small-muted' }, 'Depois que o gestor redefinir sua senha, volte à tela de login e entre com o novo acesso.'),
                        
      React.createElement('a', { href: '/admin', className: 'btn-secondary', style: { display: 'block', textAlign: 'center', textDecoration: 'none', marginTop: 16 } }, 'Ir para o login'),
                        
      React.createElement('a', { href: '/auth/signin', className: 'small-muted', style: { display: 'block', marginTop: 14, textAlign: 'center' } }, 'Voltar')
                        
    )
                             
  );
  
}











