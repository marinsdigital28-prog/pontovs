'use client';

import { useState } from 'react';
import { usePwaInstall } from '@/lib/pwaInstall';

export default function InstallAppButton({ compact = false }: { compact?: boolean }) {
  const { canPrompt, installed, ios, install } = usePwaInstall();
  const [feedback, setFeedback] = useState('');

  async function onClick() {
    if (ios) { setFeedback('No iPhone/iPad: toque em Compartilhar e depois em "Adicionar à Tela de Início".'); return; }
    const r = await install();
    setFeedback(r === 'accepted' ? 'Instalação iniciada.' : r === 'dismissed' ? 'Instalação cancelada.'
      : 'Use o menu do navegador (⋮) e escolha "Instalar app" ou "Adicionar à tela inicial".');
  }

  if (installed) return <span className="install-app-status" role="status">Aplicativo instalado</span>;

  return <div className={`install-app-wrap${compact ? ' compact' : ''}`}>
    <button type="button" className="install-app-btn" onClick={() => void onClick()} aria-label="Instalar aplicativo" data-ready={canPrompt ? '1' : '0'}>
      <span aria-hidden="true">＋</span> Instalar aplicativo
    </button>
    {feedback ? <span className="install-app-feedback" role="status">{feedback}</span> : null}
  </div>;
}
