'use client';

import { useEffect, useState } from 'react';

export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

declare global { interface Window { __pwaPrompt?: InstallPromptEvent | null } }

export function isStandalone() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
    || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

/** iPhone/iPad no Safari: não existe beforeinstallprompt, só "Compartilhar > Adicionar à Tela de Início". */
export function isIosSafari() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}

/** Lê o convite capturado cedo pelo script do layout (window.__pwaPrompt) e acompanha novos eventos. */
export function usePwaInstall() {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    setInstalled(isStandalone());
    setIos(isIosSafari());
    if (window.__pwaPrompt) setPromptEvent(window.__pwaPrompt);
    const onReady = () => setPromptEvent(window.__pwaPrompt ?? null);
    const onBip = (e: Event) => { e.preventDefault(); window.__pwaPrompt = e as InstallPromptEvent; setPromptEvent(e as InstallPromptEvent); };
    const onInstalled = () => { window.__pwaPrompt = null; setPromptEvent(null); setInstalled(true); };
    window.addEventListener('pwa-prompt-ready', onReady);
    window.addEventListener('beforeinstallprompt', onBip);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('pwa-prompt-ready', onReady);
      window.removeEventListener('beforeinstallprompt', onBip);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function install(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
    const ev = promptEvent ?? window.__pwaPrompt ?? null;
    if (!ev) return 'unavailable';
    await ev.prompt();
    const choice = await ev.userChoice;
    window.__pwaPrompt = null;
    setPromptEvent(null);
    if (choice.outcome === 'accepted') setInstalled(true);
    return choice.outcome;
  }

  return { canPrompt: Boolean(promptEvent), installed, ios, install };
}
