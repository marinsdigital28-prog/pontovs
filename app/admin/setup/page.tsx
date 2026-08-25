'use client';



import React, { useState } from 'react';



export default function AdminSetupPage() {
  
  const [status, setStatus] = useState('');
  
  const [loading, setLoading] = useState(false);
  

  
  async function createAdmin() {
    
    setLoading(true);
    
    setStatus('Criando o gestor...');
    
    try {
      
      const response = await fetch('/api/admin/bootstrap', { method: 'POST' });
      
      const data = await response.json();
      
      if (!response.ok) throw new Error(data.error || 'Nao foi possivel criar o gestor');
      
      setStatus('Gestor criado com sucesso. Acesse /admin para entrar.');
      
    } catch (error) {
      
      setStatus(error instanceof Error ? error.message : 'Erro inesperado');
      
    } finally {
      
      setLoading(false);
      
    }
    
  }
  

  
  return React.createElement('main', { className: 'signin-wrapper' },
                             
    React.createElement('div', { className: 'signin-box card' },
                        
      React.createElement('div', { className: 'signin-title' }, 'Configurar gestor'),
                        
      React.createElement('p', { className: 'small-muted' }, 'Use esta opcao uma unica vez para criar o acesso administrativo configurado em producao.'),
                        
      React.createElement('button', { className: 'btn-secondary', disabled: loading, onClick: createAdmin }, loading ? 'Criando...' : 'Criar gestor'),
                        
      status ? React.createElement('p', { className: 'small-muted', style: { marginTop: 12 } }, status) : null
                        
    )
                             
  );
  
}




























