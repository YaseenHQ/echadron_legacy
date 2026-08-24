import { describe, expect, it } from 'vitest';

import { formatTurnElapsed } from '#/tui/utils/turn-status';

describe('formatTurnElapsed', () => {
  it('uses tenths under ten seconds', () => {
    expect(formatTurnElapsed(0)).toBe('0.0s');
    expect(formatTurnElapsed(2400)).toBe('2.4s');
  });

  it('uses whole seconds then compact minutes', () => {
    expect(formatTurnElapsed(12_000)).toBe('12s');
    expect(formatTurnElapsed(80_000)).toBe('1m20s');
    expect(formatTurnElapsed(3_720_000)).toBe('1h02m');
  });
});
