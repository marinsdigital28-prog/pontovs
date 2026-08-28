import { describe, expect, it } from 'vitest';
import { EXIT_OVERRIDE_DATE, isExitOverrideActive } from '../lib/exit-override';

describe('temporary exit override', () => {
  it('is active only on the configured date', () => {
    expect(EXIT_OVERRIDE_DATE).toBe('2026-08-28');
    expect(isExitOverrideActive(new Date('2026-08-28T18:00:00.000Z'))).toBe(true);
    expect(isExitOverrideActive(new Date('2026-08-29T03:00:00.000Z'))).toBe(false);
  });
});
