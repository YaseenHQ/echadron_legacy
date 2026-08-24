/**
 * Tool-panel surface background helpers.
 *
 * Wraps rendered lines in a subtle background colour so each tool execution
 * block reads as one visual unit — the same technique Prime Agent uses for
 * its ToolPanel. The surface token is chosen by status: neutral while
 * pending, slightly success-tinted on completion, slightly error-tinted on
 * failure.
 *
 * Lines are padded to the full terminal width with the background colour so
 * the panel is a solid rectangle, then the reset sequence is emitted. This
 * mirrors how chalk.bgHex works: \x1b[48;2;R;G;Bm...\x1b[49m.
 */

import { truncateToWidth, visibleWidth } from '@yaseenhq/pi-tui';
import chalk from 'chalk';

import { ACCENT_BAR } from '#/tui/constant/symbols';
import type { ColorToken } from '#/tui/theme';
import { currentTheme } from '#/tui/theme';

/** Left/right padding inside the panel (in terminal cells). */
export const TOOL_PANEL_PADDING_X = 1;

export function toolPanelContentWidth(width: number): number {
  return Math.max(1, width - TOOL_PANEL_PADDING_X * 2);
}

/**
 * Apply the panel background to a single rendered line.
 *
 * The line is truncated to `contentWidth`, padded with spaces to fill the
 * content area, and wrapped in the background colour so the whole row is a
 * solid rectangle. The total visible width always equals `width`.
 */
export function toolPanelLine(
  line: string,
  width: number,
  surface: ColorToken,
  railHex?: string,
): string {
  // At very narrow widths, skip side padding so the line fits.
  if (width < TOOL_PANEL_PADDING_X * 2 + 1) {
    const truncated = truncateToWidth(line, width, '');
    const pad = ' '.repeat(Math.max(0, width - visibleWidth(truncated)));
    return currentTheme.bg(surface, `${truncated}${pad}`);
  }
  const contentWidth = toolPanelContentWidth(width);
  const truncated = truncateToWidth(line, contentWidth, '');
  const pad = ' '.repeat(Math.max(0, contentWidth - visibleWidth(truncated)));
  const leftPad =
    railHex !== undefined ? chalk.hex(railHex)(ACCENT_BAR) : ' '.repeat(TOOL_PANEL_PADDING_X);
  const rightPad = ' '.repeat(TOOL_PANEL_PADDING_X);
  return currentTheme.bg(surface, `${leftPad}${truncated}${pad}${rightPad}`);
}

/**
 * Apply the panel background to an array of rendered lines.
 * Empty lines become solid background rows (panel top/bottom margins).
 */
export function toolPanelLines(
  lines: readonly string[],
  width: number,
  surface: ColorToken,
  railHex?: string,
): string[] {
  return lines.map((line) => toolPanelLine(line, width, surface, railHex));
}

/**
 * Choose the surface token for a tool panel based on its status.
 */
export function toolPanelSurface(
  isFinished: boolean,
  isError: boolean,
): ColorToken {
  if (isError) return 'surfaceToolError';
  if (isFinished) return 'surfaceToolSuccess';
  return 'surfaceTool';
}
