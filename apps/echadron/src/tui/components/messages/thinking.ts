/**
 * Renders thinking content in the transcript.
 * Supports live in-place updates while thinking streams, then finalizes
 * without replacing the component.
 * Supports expand/collapse via Ctrl+O (shared with tool output).
 */

import { Text, truncateToWidth, type Component, type TUI } from '@yaseenhq/pi-tui';
import chalk from 'chalk';

import {
  BRAILLE_SPINNER_FRAMES,
  BRAILLE_SPINNER_INTERVAL_MS,
  MESSAGE_INDENT,
  THINKING_PREVIEW_LINES,
} from '#/tui/constant/rendering';
import { ACCENT_BAR } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';
import { pulseHex, waveHex } from '#/tui/utils/accent-pulse';
import { isRenderCacheEnabled } from '#/tui/utils/render-cache';

export type ThinkingRenderMode = 'live' | 'finalized';

export class ThinkingComponent implements Component {
  private text: string;
  private showMarker: boolean;
  private mode: ThinkingRenderMode;
  private expanded = false;
  private readonly ui: TUI | undefined;
  private spinnerFrame = 0;
  private spinnerInterval: ReturnType<typeof setInterval> | undefined;
  private readonly startedAt: number | undefined = undefined;
  private elapsedMs: number | undefined;
  // Hold a single Text instance so pi-tui's (text, width) → lines cache
  // actually survives across renders. Re-constructing per render destroys
  // the cache and forces full re-wrap on every frame, which dominates CPU
  // once the transcript accumulates many finalized thinking blocks.
  private readonly textComponent: Text;

  private renderCache: { width: number; lines: string[] } | undefined;

  constructor(
    text: string,
    showMarker: boolean = true,
    mode: ThinkingRenderMode = 'finalized',
    ui?: TUI,
  ) {
    this.text = text;
    this.showMarker = showMarker;
    this.mode = mode;
    this.ui = ui;
    this.textComponent = new Text(this.styled(text), 0, 0);
    if (mode === 'live') {
      this.startedAt = Date.now();
      this.startSpinner();
    }
  }

  private markRenderDirty(): void {
    this.renderCache = undefined;
  }

  invalidate(): void {
    this.markRenderDirty();
    this.textComponent.setText(this.styled(this.text));
  }

  setText(text: string): void {
    if (this.text === text) return;
    this.text = text;
    this.markRenderDirty();
    this.textComponent.setText(this.styled(text));
  }

  private styled(text: string): string {
    return currentTheme.italicFg('textDim', text);
  }

  finalize(): void {
    this.mode = 'finalized';
    if (this.startedAt !== undefined && this.elapsedMs === undefined) {
      this.elapsedMs = Math.max(0, Date.now() - this.startedAt);
    }
    this.markRenderDirty();
    this.stopSpinner();
  }

  dispose(): void {
    this.stopSpinner();
  }

  setExpanded(expanded: boolean): void {
    if (this.expanded === expanded) return;
    this.expanded = expanded;
    this.markRenderDirty();
  }

  render(width: number): string[] {
    if (
      isRenderCacheEnabled() &&
      this.renderCache !== undefined &&
      this.renderCache.width === width
    ) {
      return this.renderCache.lines;
    }

    const contentWidth = Math.max(1, width - MESSAGE_INDENT.length);
    const contentLines = this.text.length > 0 ? this.textComponent.render(contentWidth) : [''];

    let rendered: string[];
    if (this.mode === 'live') {
      const visibleLines =
        contentLines.length > THINKING_PREVIEW_LINES
          ? contentLines.slice(contentLines.length - THINKING_PREVIEW_LINES)
          : contentLines;
      const palette = currentTheme.palette;
      const secs = this.spinnerFrame * (BRAILLE_SPINNER_INTERVAL_MS / 1000);
      const pop = pulseHex(palette.textMuted, palette.running, secs);
      const rail = chalk.hex(pop)(ACCENT_BAR) + ' ';
      const spinner = chalk.hex(pop)(
        `${BRAILLE_SPINNER_FRAMES[this.spinnerFrame] ?? BRAILLE_SPINNER_FRAMES[0]} `,
      );
      rendered = [
        '',
        rail + spinner + chalk.hex(pop)('thinking...'),
        ...visibleLines.map((line, row) => {
          const bar = waveHex(palette.textMuted, palette.running, this.spinnerFrame, row + 1);
          return chalk.hex(bar)(ACCENT_BAR) + ' ' + line;
        }),
      ];
    } else {
      const lines: string[] = [''];
      const rail = currentTheme.fg('textMuted', ACCENT_BAR) + ' ';
      if (this.showMarker) {
        lines.push(rail + currentTheme.italicFg('textDim', formatThoughtElapsed(this.elapsedMs)));
      }
      for (let i = 0; i < contentLines.length; i++) {
        const prefix = this.showMarker ? rail : MESSAGE_INDENT;
        lines.push(prefix + contentLines[i]);
      }

      if (this.expanded || contentLines.length <= THINKING_PREVIEW_LINES) {
        rendered = lines;
      } else {
        // Leading blank + optional header + first PREVIEW_LINES content lines.
        const headerLines = this.showMarker ? 1 : 0;
        const truncated = lines.slice(0, 1 + headerLines + THINKING_PREVIEW_LINES);
        const remaining = contentLines.length - THINKING_PREVIEW_LINES;
        const hint = `... (${String(remaining)} more lines, ctrl+o to expand)`;
        const indentWidth = Math.min(MESSAGE_INDENT.length, Math.max(0, width));
        const hintWidth = Math.max(0, width - indentWidth);
        truncated.push(
          ' '.repeat(indentWidth) + currentTheme.dim(truncateToWidth(hint, hintWidth, '…')),
        );
        rendered = truncated;
      }
    }

    if (isRenderCacheEnabled()) {
      this.renderCache = { width, lines: rendered };
    }
    return rendered;
  }

  private startSpinner(): void {
    if (this.ui === undefined || this.spinnerInterval !== undefined) return;
    this.spinnerInterval = setInterval(() => {
      this.spinnerFrame = (this.spinnerFrame + 1) % BRAILLE_SPINNER_FRAMES.length;
      this.markRenderDirty();
      this.ui?.requestRender();
    }, BRAILLE_SPINNER_INTERVAL_MS);
  }

  private stopSpinner(): void {
    if (this.spinnerInterval === undefined) return;
    clearInterval(this.spinnerInterval);
    this.spinnerInterval = undefined;
  }
}

function formatThoughtElapsed(ms: number | undefined): string {
  if (ms === undefined) return 'Thought';
  const secs = Math.max(0, ms) / 1000;
  if (secs < 60) return `Thought for ${secs.toFixed(1)}s`;
  const mins = Math.floor(secs / 60);
  const rem = Math.round(secs - mins * 60);
  return `Thought for ${String(mins)}m${String(rem)}s`;
}
