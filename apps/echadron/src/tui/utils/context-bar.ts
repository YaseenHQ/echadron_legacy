/**
 * Footer context chrome ported from Grok Build's context bar + eighth-cell
 * progress bar (`views/context_bar.rs`, `views/progress_bar.rs`).
 */

import chalk from 'chalk';

import { currentTheme } from '#/tui/theme';
import { blendHex } from '#/tui/utils/logo-shimmer';
import {
  formatTokenCount,
  usagePercent,
  usagePercentFromRatio,
} from '#/utils/usage/usage-format';

const BLOCKS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'] as const;
const BAR_WIDTH = 8;

export function renderProgressBar(width: number, value: number): string {
  const cells = Math.max(0, Math.trunc(width));
  const fill = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const eighths = Math.round(fill * cells * 8);
  const full = Math.min(cells, Math.floor(eighths / 8));
  const rem = eighths % 8;
  let out = '';
  for (let index = 0; index < cells; index += 1) {
    if (index < full) out += '█';
    else if (index === full && rem > 0) out += BLOCKS[rem];
    else out += '░';
  }
  return out;
}

export function contextBarColor(pct: number): string {
  const palette = currentTheme.palette;
  if (pct >= 95) return palette.error;
  if (pct >= 85) return blendHex(palette.warning, palette.error, (pct - 85) / 10);
  if (pct >= 75) return palette.warning;
  if (pct >= 50) return blendHex(palette.text, palette.warning, (pct - 50) / 25);
  return palette.text;
}

export function formatContextBar(
  usage: number,
  tokens?: number,
  maxTokens?: number,
): string {
  const pct =
    maxTokens !== undefined && maxTokens > 0 && tokens !== undefined
      ? usagePercent(tokens, maxTokens)
      : usagePercentFromRatio(usage);
  const bar = chalk.hex(contextBarColor(pct))(renderProgressBar(BAR_WIDTH, pct / 100));
  const label = currentTheme.fg('text', `context: ${String(pct)}%`);
  if (maxTokens !== undefined && maxTokens > 0 && tokens !== undefined) {
    const counts = currentTheme.fg(
      'textDim',
      `${formatTokenCount(tokens)}/${formatTokenCount(maxTokens)}`,
    );
    return `${label} ${bar} ${counts}`;
  }
  return `${label} ${bar}`;
}
