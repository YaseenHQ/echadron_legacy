/**
 * Single-row toast above the prompt, after Grok Build's welcome toast
 * (`views/welcome/toast.rs`). Right-aligned, bold, auto-dismissed by the host.
 */

import type { Component } from '@yaseenhq/pi-tui';
import { truncateToWidth, visibleWidth } from '@yaseenhq/pi-tui';

import { currentTheme } from '#/tui/theme';

export const TOAST_DURATION_MS = 4_000;

export class ToastComponent implements Component {
  constructor(private readonly message: string) {}

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(0, width);
    if (safeWidth === 0) return [];
    const body = truncateToWidth(` ${this.message} `, Math.max(1, safeWidth - 1), '…');
    const styled = currentTheme.boldFg('primary', body);
    const pad = Math.max(0, safeWidth - visibleWidth(styled));
    return [' '.repeat(pad) + styled];
  }
}
