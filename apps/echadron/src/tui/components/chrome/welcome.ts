/**
 * Compact welcome header shown at the top of the TUI.
 * Keeps identity, workspace, model, and entry-point hints visible without
 * surrounding the whole startup state in a large panel.
 *
 * Chad, the two-row character, runs an idle look/blink/wink (see
 * `logo-eyes.ts`) and a periodic specular glint (see `logo-shimmer.ts`) so the
 * header is alive.
 */

import type { Component, TUI } from '@yaseenhq/pi-tui';
import { truncateToWidth, visibleWidth } from '@yaseenhq/pi-tui';
import chalk from 'chalk';

import { effectiveModelAlias } from '@yaseenhq/echadron-sdk';

import { isRainbowDancing, renderDanceWelcomeHeader } from '#/tui/easter-eggs/dance';
import type { AppState } from '#/tui/types';
import { currentTheme } from '#/tui/theme';
import { logoFaceAt, paintLogoRun, type ChadMood } from '#/tui/utils/logo-eyes';
import { blendHex, glintRow, LOGO_GLINT_INTERVAL_MS } from '#/tui/utils/logo-shimmer';

export interface WelcomeOptions {
  readonly ui?: TUI;
  readonly now?: () => number;
}



export class WelcomeComponent implements Component {
  private state: AppState;
  private readonly ui: TUI | undefined;
  private readonly now: () => number;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(state: AppState, options: WelcomeOptions = {}) {
    this.state = state;
    this.ui = options.ui;
    this.now = options.now ?? Date.now;
    if (this.ui !== undefined) {
      this.intervalId = setInterval(() => {
        this.ui?.requestRender();
      }, LOGO_GLINT_INTERVAL_MS);
      this.intervalId.unref?.();
    }
  }

  invalidate(): void {}

  dispose(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  render(width: number): string[] {
    const safeWidth = Math.max(0, width);
    const dim = chalk.hex(currentTheme.palette.textDim);
    const muted = chalk.hex(currentTheme.palette.textMuted);
    const isLoggedOut = !this.state.model;
    const activeModel = this.state.availableModels[this.state.model];
    const effectiveActiveModel = activeModel === undefined ? undefined : effectiveModelAlias(activeModel);
    const modelValue = isLoggedOut
      ? chalk.hex(currentTheme.palette.warning)('/login to connect a model')
      : chalk.hex(currentTheme.palette.text)(
          effectiveActiveModel?.displayName ?? effectiveActiveModel?.model ?? this.state.model,
        );
    const shortcuts = muted('/ commands  ·  @ files  ·  ! shell');

    if (safeWidth < 24) {
      return [
        '',
        chalk.bold.hex(currentTheme.palette.textStrong)('Echadron'),
        dim(this.state.workDir),
        modelValue,
        shortcuts,
        '',
      ].map((line) =>
        truncateToWidth(line, safeWidth, '…'),
      );
    }

    const face = logoFaceAt(this.now() / 1000, this.mood());
    const logo = face.rows;
    const logoWidth = Math.max(...logo.map((row) => visibleWidth(row)));
    const gap = '  ';
    const textWidth = Math.max(4, safeWidth - logoWidth - gap.length);

    const rightRow0 = truncateToWidth(chalk.bold.hex(currentTheme.palette.textStrong)('Echadron'), textWidth, '…');
    const rightRow1 = truncateToWidth(
      dim(`${this.state.workDir}  ·  `) + modelValue,
      textWidth,
      '…',
    );

    let renderedHeaderLines = [
      this.renderLogoRow(logo[0], logoWidth, 0) + gap + rightRow0,
      this.renderLogoRow(logo[1], logoWidth, 1) + gap + rightRow1,
    ];
    if (isRainbowDancing()) {
      renderedHeaderLines = renderDanceWelcomeHeader(logo, textWidth, rightRow1);
    }

    const lines: string[] = ['', ...renderedHeaderLines, '', shortcuts];
    if (this.state.mcpServersSummary) lines.push(muted(`MCP  ${this.state.mcpServersSummary}`));
    lines.push('');

    return lines.map((line) => truncateToWidth(line, safeWidth, '…'));
  }

  /**
   * Chad's mood, derived from live session state. The header holds a live
   * `AppState` reference and already repaints on a timer, so this needs no
   * new state and no second face elsewhere in the UI.
   */
  private mood(): ChadMood {
    if (this.state.retryStatus !== undefined) return 'retry';
    switch (this.state.streamingPhase) {
      case 'thinking':
        return 'thinking';
      case 'composing':
        return 'composing';
      case 'shell':
        return 'tool';
      case 'waiting':
        return 'waiting';
      default:
        return 'idle';
    }
  }

  private renderLogoRow(row: string, logoWidth: number, rowIndex = 0): string {
    const base = currentTheme.palette.textMuted;
    const hilite = currentTheme.palette.text;
    // The pupil reads as a hole in the body, so keep it near the terminal's
    // own darkness rather than tying it to the animated body colour.
    const pupil = currentTheme.palette.surfaceTool;
    return glintRow(row.padEnd(logoWidth), rowIndex, this.now() / 1000)
      .map(({ text, weight }) => paintLogoRun(text, blendHex(base, hilite, weight), pupil))
      .join('');
  }
}
