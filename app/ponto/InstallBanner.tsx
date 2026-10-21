'use client';

import { useEffect, useState } from 'react';
import { usePwaInstall } from '@/lib/pwaInstall';

const KEY = 'pontoInstallDismissedAt';
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

/** Convite de instalação do totem: aparece na primeira visita, some por 7 dias ao dispensar e nunca no app instalado. */
export default function InstallBanner() {
  const { canPrompt, installed, ios, install } = usePwaInstall();
  const [snoozed, setSnoozed] = useState(true);

  useEffect(() => {
    try { const at = Number(localStorage.getItem(KEY) || 0); setSnoozed(Date.now() - at < SNOOZE_MS); } catch { setSnoozed(false); }
  }, []);

  function dismiss() { try { localStorage.setItem(KEY, String(Date.now())); } catch { /* sem storage */ } setSnoozed(true); }

  if (installed || snoozed || (!canPrompt && !ios)) return null;

  return (
    <div className="t-install-banner" role="dialog" aria-modal="false" aria-labelledby="t-ib-title">
      <img src="/ponto-progredir-icon-circular.png" alt="" width={56} height={56} />
      <div className="t-ib-text">
        <strong id="t-ib-title">Instale o Ponto Progredir</strong>
        {ios
          ? <span>Toque em <b>Compartilhar</b> <span aria-hidden>⎋</span> &gt; <b>Adicionar à Tela de Início</b>.</span>
          : <span>Abre em tela cheia, mais rápido e funciona mesmo sem internet.</span>}
      </div>
      <div className="t-ib-actions">
        {!ios ? <button type="button" className="t-ib-install" onClick={async () => { const r = await install(); if (r === 'dismissed') dismiss(); }}>Instalar</button> : null}
        <button type="button" className="t-ib-close" onClick={dismiss} aria-label="Agora não">{ios ? 'Entendi' : 'Agora não'}</button>
      </div>
    </div>
  );
}
