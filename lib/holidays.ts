/**
 * Feriados automáticos: nacionais + estado de SP + município de São Paulo,
 * incluindo móveis calculados a partir da Páscoa, mais ajustes locais do gestor.
 *
 * Regras de aplicação:
 * - Feriados automáticos valem a partir de AUTO_HOLIDAYS_FROM (não reabre meses já fechados/assinados).
 * - 07/09/2026 (já usado antes) continua valendo.
 * - Pontos facultativos (Carnaval, Quarta de Cinzas) NÃO abonam por padrão; o gestor pode ativar.
 * - O gestor pode adicionar feriados locais e desativar um automático (ex.: unidade fora da capital).
 */
export type HolidayScope = 'NACIONAL' | 'ESTADUAL' | 'MUNICIPAL' | 'FACULTATIVO' | 'LOCAL';
export type Holiday = { date: string; name: string; scope: HolidayScope; movable?: boolean; source: 'AUTO' | 'GESTOR' };
export type HolidayOverrides = { added: Array<{ date: string; name: string }>; disabled: string[]; enabled: string[] };

export const AUTO_HOLIDAYS_FROM = '2026-10-01';
const LEGACY: Record<string, string> = { '2026-09-07': 'Independência do Brasil' };

function key(y: number, m: number, d: number) { return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
function addDays(dateKey: string, days: number) { const d = new Date(`${dateKey}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano). */
export function easterSunday(year: number) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return key(year, month, day);
}

export function autoHolidays(year: number): Holiday[] {
  const easter = easterSunday(year);
  const fixed: Array<[number, number, string, HolidayScope]> = [
    [1, 1, 'Confraternização Universal', 'NACIONAL'],
    [1, 25, 'Aniversário de São Paulo', 'MUNICIPAL'],
    [4, 21, 'Tiradentes', 'NACIONAL'],
    [5, 1, 'Dia do Trabalho', 'NACIONAL'],
    [7, 9, 'Revolução Constitucionalista', 'ESTADUAL'],
    [9, 7, 'Independência do Brasil', 'NACIONAL'],
    [10, 12, 'Nossa Senhora Aparecida', 'NACIONAL'],
    [11, 2, 'Finados', 'NACIONAL'],
    [11, 15, 'Proclamação da República', 'NACIONAL'],
    [11, 20, 'Dia Nacional de Zumbi e da Consciência Negra', 'NACIONAL'],
    [12, 25, 'Natal', 'NACIONAL'],
  ];
  const list: Holiday[] = fixed.map(([m, d, name, scope]) => ({ date: key(year, m, d), name, scope, source: 'AUTO' }));
  list.push(
    { date: addDays(easter, -48), name: 'Carnaval (segunda)', scope: 'FACULTATIVO', movable: true, source: 'AUTO' },
    { date: addDays(easter, -47), name: 'Carnaval (terça)', scope: 'FACULTATIVO', movable: true, source: 'AUTO' },
    { date: addDays(easter, -46), name: 'Quarta-feira de Cinzas (até 14h)', scope: 'FACULTATIVO', movable: true, source: 'AUTO' },
    { date: addDays(easter, -2), name: 'Sexta-feira Santa', scope: 'NACIONAL', movable: true, source: 'AUTO' },
    { date: addDays(easter, 60), name: 'Corpus Christi', scope: 'MUNICIPAL', movable: true, source: 'AUTO' },
  );
  return list.sort((a, b) => a.date.localeCompare(b.date));
}

let current: HolidayOverrides = { added: [], disabled: [], enabled: [] };
/** Registra os ajustes do gestor (carregados do servidor) para os cálculos de horas. */
export function setHolidayOverrides(next: HolidayOverrides | null | undefined) { current = next ? { added: next.added || [], disabled: next.disabled || [], enabled: next.enabled || [] } : { added: [], disabled: [], enabled: [] }; }
export function getHolidayOverrides() { return current; }

/** Lista do ano com o estado final (ativo ou não) de cada feriado. */
export function holidaysForYear(year: number, overrides: HolidayOverrides = current) {
  const auto = autoHolidays(year).map((h) => {
    const defaultActive = h.scope !== 'FACULTATIVO' && h.date >= AUTO_HOLIDAYS_FROM;
    const active = overrides.disabled.includes(h.date) ? false : overrides.enabled.includes(h.date) ? true : defaultActive || Boolean(LEGACY[h.date]);
    return { ...h, active };
  });
  const added = overrides.added.filter((a) => a.date.startsWith(`${year}-`)).map((a) => ({ date: a.date, name: a.name, scope: 'LOCAL' as HolidayScope, source: 'GESTOR' as const, active: !overrides.disabled.includes(a.date) }));
  return [...auto.filter((h) => !added.some((a) => a.date === h.date)), ...added].sort((a, b) => a.date.localeCompare(b.date));
}

/** Feriado que abona o dia (ou null). */
export function resolveHoliday(dateKey: string, overrides: HolidayOverrides = current): Holiday | null {
  const year = Number(dateKey.slice(0, 4));
  if (!year) return null;
  const hit = holidaysForYear(year, overrides).find((h) => h.date === dateKey && h.active);
  return hit ? { date: hit.date, name: hit.name, scope: hit.scope, movable: (hit as any).movable, source: hit.source } : null;
}

export const SCOPE_LABEL: Record<HolidayScope, string> = { NACIONAL: 'Feriado nacional', ESTADUAL: 'Feriado estadual (SP)', MUNICIPAL: 'Feriado municipal (São Paulo)', FACULTATIVO: 'Ponto facultativo', LOCAL: 'Feriado local' };

/** Reconstrói os ajustes a partir dos eventos de auditoria (append-only), em ordem. */
export function overridesFromEvents(events: Array<{ action: string; metadata: any }>): HolidayOverrides {
  const added = new Map<string, string>(); const disabled = new Set<string>(); const enabled = new Set<string>();
  for (const e of events) {
    const date = String(e.metadata?.date || ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (e.action === 'FERIADO_LOCAL_ADICIONADO') { added.set(date, String(e.metadata?.name || 'Feriado local')); disabled.delete(date); }
    else if (e.action === 'FERIADO_LOCAL_REMOVIDO') added.delete(date);
    else if (e.action === 'FERIADO_DESATIVADO') { disabled.add(date); enabled.delete(date); }
    else if (e.action === 'FERIADO_ATIVADO') { enabled.add(date); disabled.delete(date); }
  }
  return { added: [...added].map(([date, name]) => ({ date, name })), disabled: [...disabled], enabled: [...enabled] };
}
export const HOLIDAY_ACTIONS = ['FERIADO_LOCAL_ADICIONADO', 'FERIADO_LOCAL_REMOVIDO', 'FERIADO_DESATIVADO', 'FERIADO_ATIVADO'];
