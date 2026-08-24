import { describe, expect, it } from 'vitest';

import { parseSgrMouse } from '#/tui/utils/sgr-mouse';

describe('parseSgrMouse', () => {
  it('parses a left-click press as 0-based cells', () => {
    expect(parseSgrMouse('\u001b[<0;12;8M')).toEqual({
      button: 0,
      col: 11,
      row: 7,
      press: true,
      wheel: false,
    });
  });

  it('parses a release and ignores wheel reports as wheel', () => {
    expect(parseSgrMouse('\u001b[<0;12;8m')?.press).toBe(false);
    expect(parseSgrMouse('\u001b[<64;12;8M')?.wheel).toBe(true);
  });

  it('ignores non-mouse input', () => {
    expect(parseSgrMouse('\u001b[A')).toBeUndefined();
    expect(parseSgrMouse('a')).toBeUndefined();
  });
});
