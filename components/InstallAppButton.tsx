'use client';

import { useEffect, useState } from 'react';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

export default function InstallAppButton({ compact = false }: { compact?: boolean }) {
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    setInstalled(standalone);
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as InstallPromptEvent);
    };
    const onInstalled = () => { setInstalled(true); setInstallEvent(null); setFeedback('Aplicativo instalado neste dispositivo.'); };
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function install() {
    if (!installEvent) {
      setFeedback('A instalação será disponibilizada pelo navegador quando este dispositivo estiver pronto.');
      return;
    }
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    setInstallEvent(null);
    setFeedback(choice.outcome === 'accepted' ? 'Instalação iniciada.' : 'Instalação cancelada.');
  }

  if (installed) return <span className="install-app-status" role="status">Aplicativo instalado</span>;

  return <div className={`install-app-wrap${compact ? ' compact' : ''}`}>
    <button type="button" className="install-app-btn" onClick={() => void install()} aria-label="Instalar aplicativo">
      <span aria-hidden="true">＋</span> Instalar aplicativo
    </button>
    {feedback ? <span className="install-app-feedback" role="status">{feedback}</span> : null}
  </div>;
}
