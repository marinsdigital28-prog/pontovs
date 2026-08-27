import { describe, expect, it } from 'vitest';
import { brazilDateKey, brazilDayRange } from '../lib/brazil-time';

describe('janela diária do ponto no horário de Brasília', () => {
  it('usa a data brasileira mesmo quando o servidor está em UTC', () => {
    const date = new Date('2026-08-27T02:00:00.000Z');
    expect(brazilDateKey(date)).toBe('2026-08-26');
  });

  it('cria uma janela de 24 horas para o dia brasileiro', () => {
    const { start, end } = brazilDayRange(new Date('2026-08-27T15:00:00.000Z'));
    expect(start.toISOString()).toBe('2026-08-27T03:00:00.000Z');
    expect(end.toISOString()).toBe('2026-08-28T03:00:00.000Z');
  });
});
