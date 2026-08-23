/**
 * Terminal-title animation ported from Grok Build's pager title manager
 * and Prime Agent's titlebar-spinner extension.
 *
 * Terminals (notably Ghostty) debounce OSC 0 title writes, so the spinner
 * advances slowly (~250ms) rather than every UI tick.
 */

export const TITLE_SPINNER_FRAMES = [
  '\u{280B}',
  '\u{2819}',
  '\u{2839}',
  '\u{2838}',
  '\u{283C}',
  '\u{2834}',
  '\u{2826}',
  '\u{2827}',
] as const;

export const TITLE_SPINNER_INTERVAL_MS = 250;
export const ACTION_REQUIRED_BLINK_MS = 500;
export const ACTION_REQUIRED_PREFIX = '\u26A0';

export interface TerminalTitleInput {
  readonly base: string;
  readonly maxLength: number;
  readonly busy: boolean;
  readonly awaiting: boolean;
  readonly focused: boolean;
  readonly nowMs: number;
}

export function formatTerminalTitle(input: TerminalTitleInput): string {
  const base = input.base.trim();
  const prefix = titlePrefix(input);
  const room = Math.max(1, input.maxLength - prefix.length);
  return prefix + truncateTitle(base, room);
}

export function titleSpinnerShouldAnimate(input: {
  readonly busy: boolean;
  readonly awaiting: boolean;
  readonly focused: boolean;
}): boolean {
  return input.busy || (input.awaiting && !input.focused);
}

function titlePrefix(input: TerminalTitleInput): string {
  if (input.awaiting) {
    const showMark = input.focused || shouldShowActionBlink(input.nowMs);
    return showMark ? `${ACTION_REQUIRED_PREFIX} ` : '';
  }
  if (input.busy) {
    return `${TITLE_SPINNER_FRAMES[frameIndex(input.nowMs)]} `;
  }
  return '';
}

function frameIndex(nowMs: number): number {
  const tick = Math.floor(Math.max(0, nowMs) / TITLE_SPINNER_INTERVAL_MS);
  return tick % TITLE_SPINNER_FRAMES.length;
}

function shouldShowActionBlink(nowMs: number): boolean {
  return Math.floor(Math.max(0, nowMs) / ACTION_REQUIRED_BLINK_MS) % 2 === 0;
}

function truncateTitle(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  if (maxLength <= 1) return value.slice(0, maxLength);
  return `${value.slice(0, maxLength - 1)}\u2026`;
}
