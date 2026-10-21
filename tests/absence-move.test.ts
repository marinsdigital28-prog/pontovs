import { describe, expect, it } from 'vitest';
import { dateKey, dropBlockReason, moveBlockReason, periodsTouched, shiftRange } from '../lib/absence-move';

const d = (s: string) => { const [y, m, day] = s.split('-').map(Number); return new Date(y, m - 1, day); };

describe('absence move rules', () => {
  it('keeps duration of multi-day events', () => {
    const r = shiftRange(d('2026-10-05'), d('2026-10-07'), d('2026-10-30'));
    expect([dateKey(r.start), dateKey(r.end)]).toEqual(['2026-10-30', '2026-11-01']);
  });
  it('lists touched periods', () => {
    expect(periodsTouched(d('2026-10-30'), d('2026-11-01'))).toEqual(['2026-10', '2026-11']);
  });
  it('blocks certificates, holidays, canceled and closed periods', () => {
    const base = { source: 'SOLICITAÇÃO' as const, type: 'AUSENCIA', status: 'APROVADO', start: d('2026-10-05'), end: d('2026-10-05') };
    expect(moveBlockReason(base)).toBeNull();
    expect(moveBlockReason({ ...base, source: 'ATESTADO' })).toMatch(/documento/);
    expect(moveBlockReason({ ...base, source: 'FERIADO' })).toMatch(/fixos/);
    expect(moveBlockReason({ ...base, status: 'CANCELADO' })).toMatch(/cancelados/);
    expect(moveBlockReason({ ...base, type: 'ESQUECI_PONTO' })).toMatch(/não pode/);
    expect(moveBlockReason(base, ['2026-10'])).toMatch(/10\/2026/);
  });
  it('blocks drop into closed period or same date', () => {
    const base = { source: 'SOLICITAÇÃO' as const, type: 'AUSENCIA', status: 'PENDENTE', start: d('2026-10-30'), end: d('2026-10-30') };
    expect(dropBlockReason(base, d('2026-10-30'))).toMatch(/já está/);
    expect(dropBlockReason(base, d('2026-09-28'), ['2026-09'])).toMatch(/09\/2026/);
    expect(dropBlockReason(base, d('2026-10-20'), ['2026-09'])).toBeNull();
  });
});
