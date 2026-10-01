import { describe, expect, it } from 'vitest';
import { getOperationalAbono, operationalJustifiedMinutes } from '../lib/operational-abonos';

describe('abonos operacionais', () => {
  it('abona o restante da jornada da Viviane após a saída de 15:51 em 22/09/2026', () => {
    const abono = getOperationalAbono('1404', '2026-09-22');
    expect(abono).toMatchObject({
      kind: 'FROM_TIME',
      fromTime: '15:51',
      reason: 'Atestado de óbito — restante do expediente',
    });
    expect(operationalJustifiedMinutes(abono!, '08:00', '17:00', 480)).toBe(69);
  });

  it('não aplica o atestado da Viviane em outra data ou matrícula', () => {
    expect(getOperationalAbono('1404', '2026-09-23')).toBeNull();
    expect(getOperationalAbono('9999', '2026-09-22')).toBeNull();
  });
});
