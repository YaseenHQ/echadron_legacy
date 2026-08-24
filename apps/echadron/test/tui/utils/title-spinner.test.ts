import { describe, expect, it } from 'vitest';

import {
  ACTION_REQUIRED_BLINK_MS,
  ACTION_REQUIRED_PREFIX,
  TITLE_SPINNER_FRAMES,
  TITLE_SPINNER_INTERVAL_MS,
  formatTerminalTitle,
  titleSpinnerShouldAnimate,
} from '#/tui/utils/title-spinner';

describe('formatTerminalTitle', () => {
  it('uses the base title when idle', () => {
    expect(
      formatTerminalTitle({
        base: 'Implement terminal title',
        maxLength: 32,
        busy: false,
        awaiting: false,
        focused: true,
        nowMs: 0,
      }),
    ).toBe('Implement terminal title');
  });

  it('prefixes a braille frame while the agent is working', () => {
    expect(
      formatTerminalTitle({
        base: 'Implement terminal title',
        maxLength: 32,
        busy: true,
        awaiting: false,
        focused: true,
        nowMs: 0,
      }),
    ).toBe(`${TITLE_SPINNER_FRAMES[0]} Implement terminal title`);
    expect(
      formatTerminalTitle({
        base: 'Implement terminal title',
        maxLength: 32,
        busy: true,
        awaiting: false,
        focused: true,
        nowMs: TITLE_SPINNER_INTERVAL_MS,
      }),
    ).toBe(`${TITLE_SPINNER_FRAMES[1]} Implement terminal title`);
  });

  it('shows a static action mark while awaiting focus', () => {
    expect(
      formatTerminalTitle({
        base: 'Review the patch',
        maxLength: 32,
        busy: false,
        awaiting: true,
        focused: true,
        nowMs: ACTION_REQUIRED_BLINK_MS,
      }),
    ).toBe(`${ACTION_REQUIRED_PREFIX} Review the patch`);
  });

  it('blinks the action mark when awaiting and unfocused', () => {
    expect(
      formatTerminalTitle({
        base: 'Review the patch',
        maxLength: 32,
        busy: false,
        awaiting: true,
        focused: false,
        nowMs: 0,
      }),
    ).toBe(`${ACTION_REQUIRED_PREFIX} Review the patch`);
    expect(
      formatTerminalTitle({
        base: 'Review the patch',
        maxLength: 32,
        busy: false,
        awaiting: true,
        focused: false,
        nowMs: ACTION_REQUIRED_BLINK_MS,
      }),
    ).toBe('Review the patch');
  });

  it('keeps the composed title inside the terminal length budget', () => {
    const title = formatTerminalTitle({
      base: 'A very long session title that should be clipped',
      maxLength: 16,
      busy: true,
      awaiting: false,
      focused: true,
      nowMs: 0,
    });
    expect(title.length).toBeLessThanOrEqual(16);
    expect(title.startsWith(`${TITLE_SPINNER_FRAMES[0]} `)).toBe(true);
    expect(title.endsWith('\u2026')).toBe(true);
  });
});

describe('titleSpinnerShouldAnimate', () => {
  it('animates only while working or blinking for attention', () => {
    expect(titleSpinnerShouldAnimate({ busy: true, awaiting: false, focused: true })).toBe(true);
    expect(titleSpinnerShouldAnimate({ busy: false, awaiting: true, focused: false })).toBe(true);
    expect(titleSpinnerShouldAnimate({ busy: false, awaiting: true, focused: true })).toBe(false);
    expect(titleSpinnerShouldAnimate({ busy: false, awaiting: false, focused: false })).toBe(false);
  });
});
