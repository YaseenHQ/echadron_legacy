import { describe, expect, it } from 'vitest';

import { contextBarColor, formatContextBar, renderProgressBar } from '#/tui/utils/context-bar';
import { darkColors } from '#/tui/theme/colors';

const ANSI_SGR = /\u001B\[[0-9;]*m/g;

describe('context bar', () => {
  it('fills eighth-cell blocks', () => {
    expect(renderProgressBar(8, 0)).toBe('░░░░░░░░');
    expect(renderProgressBar(8, 1)).toBe('████████');
    expect(renderProgressBar(8, 0.5).startsWith('████')).toBe(true);
  });

  it('shifts color as usage climbs', () => {
    expect(contextBarColor(10)).toBe(darkColors.text);
    expect(contextBarColor(75)).toBe(darkColors.warning);
    expect(contextBarColor(95)).toBe(darkColors.error);
  });

  it('keeps the context percent label and adds a bar', () => {
    // Decimal, matching how context windows are configured and advertised.
    const line = formatContextBar(0.42, 420_000, 1_000_000).replaceAll(ANSI_SGR, '');
    expect(line).toContain('context: 42%');
    expect(line).toContain('420k/1M');
    expect(line).toMatch(/[█░]/);
  });
});
