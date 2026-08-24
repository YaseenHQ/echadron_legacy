/**
 * "Waiting on you" pulse — Grok Build's pending diamond
 * (`views/turn_status.rs` USER_WAITING_PULSE_SPEED).
 *
 * Sits between the transcript and the prompt while an approval or question
 * is open, so the row does not go blank.
 */

import type { Component, TUI } from '@yaseenhq/pi-tui';
import { truncateToWidth, visibleWidth } from '@yaseenhq/pi-tui';
import chalk from 'chalk';

import { currentTheme } from '#/tui/theme';
import { blendHex } from '#/tui/utils/logo-shimmer';
import { formatTurnElapsed } from '#/tui/utils/turn-status';

const PULSE_PERIOD_SECS = 1.31;
const PULSE_INTERVAL_MS = 80;

export class WaitingCueComponent implements Component {
  private readonly ui: TUI;
  private readonly label: string;
  private readonly startedAt: number;
  private readonly now: () => number;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(
    ui: TUI,
    label: string,
    startedAt: number,
    now: () => number = Date.now,
  ) {
    this.ui = ui;
    this.label = label;
    this.startedAt = startedAt;
    this.now = now;
    this.intervalId = setInterval(() => {
      this.ui.requestRender();
    }, PULSE_INTERVAL_MS);
    this.intervalId.unref?.();
  }

  invalidate(): void {}

  dispose(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  render(width: number): string[] {
    const now = this.now();
    const t = now / 1000;
    const wave = Math.sin((Math.PI * t) / PULSE_PERIOD_SECS) ** 2;
    const color = blendHex(currentTheme.palette.textDim, currentTheme.palette.warning, 0.3 + wave * 0.7);
    const left = `${chalk.hex(color)('◆')} ${currentTheme.fg('text', this.label)}`;
    const elapsed =
      this.startedAt > 0
        ? currentTheme.fg('textDim', formatTurnElapsed(now - this.startedAt))
        : '';
    const pad = width - visibleWidth(left) - visibleWidth(elapsed);
    const line = pad >= 1 && elapsed.length > 0 ? left + ' '.repeat(pad) + elapsed : left;
    return ['', truncateToWidth(line, width, '…')];
  }
}
