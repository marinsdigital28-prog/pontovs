import { describe, expect, it } from 'vitest';
import { autoHolidays, easterSunday, holidaysForYear, overridesFromEvents, resolveHoliday } from '../lib/holidays';
import { getOperationalAbono } from '../lib/operational-abonos';

const none = { added: [], disabled: [], enabled: [] };

describe('feriados automáticos', () => {
  it('calcula a Páscoa corretamente', () => {
    expect(easterSunday(2024)).toBe('2024-03-31');
    expect(easterSunday(2025)).toBe('2025-04-20');
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(easterSunday(2027)).toBe('2027-03-28');
  });

  it('gera os móveis a partir da Páscoa (2027)', () => {
    const map = Object.fromEntries(autoHolidays(2027).map((h) => [h.name, h.date]));
    expect(map['Sexta-feira Santa']).toBe('2027-03-26');
    expect(map['Corpus Christi']).toBe('2027-05-27');
    expect(map['Carnaval (terça)']).toBe('2027-02-09');
  });

  it('inclui nacionais, SP estado e capital', () => {
    const dates = autoHolidays(2027).map((h) => h.date);
    for (const d of ['2027-01-01', '2027-01-25', '2027-04-21', '2027-07-09', '2027-11-20', '2027-12-25']) expect(dates).toContain(d);
  });

  it('aplica a partir de out/2026, mantém 07/09/2026 e não abona ponto facultativo', () => {
    expect(resolveHoliday('2026-10-12', none)?.name).toBe('Nossa Senhora Aparecida');
    expect(resolveHoliday('2026-09-07', none)).not.toBeNull();
    expect(resolveHoliday('2026-07-09', none)).toBeNull();
    expect(resolveHoliday('2027-02-09', none)).toBeNull();
    expect(resolveHoliday('2027-03-26', none)?.scope).toBe('NACIONAL');
  });

  it('respeita ajustes do gestor reconstruídos da auditoria', () => {
    const o = overridesFromEvents([
      { action: 'FERIADO_LOCAL_ADICIONADO', metadata: { date: '2026-12-08', name: 'Padroeira local' } },
      { action: 'FERIADO_DESATIVADO', metadata: { date: '2026-11-20' } },
      { action: 'FERIADO_ATIVADO', metadata: { date: '2027-02-09' } },
      { action: 'FERIADO_LOCAL_ADICIONADO', metadata: { date: '2026-12-24', name: 'Véspera' } },
      { action: 'FERIADO_LOCAL_REMOVIDO', metadata: { date: '2026-12-24' } },
    ]);
    expect(resolveHoliday('2026-12-08', o)?.source).toBe('GESTOR');
    expect(resolveHoliday('2026-12-24', o)).toBeNull();
    expect(resolveHoliday('2026-11-20', o)).toBeNull();
    expect(resolveHoliday('2027-02-09', o)).not.toBeNull();
    expect(holidaysForYear(2026, o).find((h) => h.date === '2026-11-20')?.active).toBe(false);
  });

  it('feriado vira abono integral na folha', () => {
    expect(getOperationalAbono('1001', '2026-11-02')).toMatchObject({ kind: 'FULL_DAY', reason: 'Feriado nacional — Finados' });
    expect(getOperationalAbono('1001', '2026-09-07')?.reason).toBe('Feriado nacional — Independência do Brasil');
  });
});
