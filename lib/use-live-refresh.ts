'use client';

import { useEffect } from 'react';

/** Atualiza uma consulta ao voltar à aba e em intervalos curtos, com pausa quando a página está oculta. */
export function useLiveRefresh(refresh: () => void | Promise<void>, intervalMs = 15000) {
  useEffect(() => {
    let running = false;
    const run = async () => {
      if (running || document.visibilityState === 'hidden') return;
      running = true;
      try { await refresh(); } finally { running = false; }
    };
    const timer = window.setInterval(() => { void run(); }, intervalMs);
    const onFocus = () => { void run(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, [refresh, intervalMs]);
}
