import { brazilDateKey } from './brazil-time';

// Exceção operacional solicitada para liberar as saídas de 28/08/2026.
// A regra expira automaticamente à meia-noite no horário de São Paulo.
export const EXIT_OVERRIDE_DATE = '2026-08-28';

export function isExitOverrideActive(date = new Date()) {
  return brazilDateKey(date) === EXIT_OVERRIDE_DATE;
}
