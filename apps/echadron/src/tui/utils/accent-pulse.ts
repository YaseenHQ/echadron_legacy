/**
 * Accent-rail motion from Grok Build (`theme::pulse_brightness` /
 * `theme::wave_brightness` in xai-grok-pager-render).
 *
 * `sin²` so the bright→dim cycle is smooth and never goes negative.
 */

import { blendHex } from '#/tui/utils/logo-shimmer';

/** Grok waiting-cue / thinking cycle. One bright→dim→bright pass. */
export const ACCENT_PULSE_PERIOD_SECS = 1.31;

/** Rows per full traveling-wave cycle (Grok `[animation].wave_rows`). */
export const ACCENT_WAVE_ROWS = 32;

/** Radians per tick at Grok's ~30fps (`WAVE_SPEED`). */
export const ACCENT_WAVE_SPEED = 0.15;

/**
 * Temporal pulse in [0, 1]. All callers that share `secs` blink in unison.
 */
export function pulseBrightness(secs: number, periodSecs = ACCENT_PULSE_PERIOD_SECS): number {
  if (!Number.isFinite(secs) || periodSecs <= 0) return 0;
  const wave = Math.sin((Math.PI * secs) / periodSecs);
  return wave * wave;
}

/**
 * Spatial wave along a vertical accent rail. `row` is the line inside the
 * block; `tick` is a monotonic frame count.
 */
export function waveBrightness(
  tick: number,
  row: number,
  waveRows = ACCENT_WAVE_ROWS,
  speed = ACCENT_WAVE_SPEED,
): number {
  const rows = Math.max(1, waveRows);
  const phase = (row / rows) * Math.PI * 2;
  const wave = Math.sin(tick * speed + phase);
  return wave * wave;
}

/** Blend `base` → `pop` with a floor so the glyph never disappears. */
export function pulseHex(
  base: string,
  pop: string,
  secs: number,
  floor = 0.35,
): string {
  const t = floor + pulseBrightness(secs) * (1 - floor);
  return blendHex(base, pop, t);
}

export function waveHex(
  base: string,
  pop: string,
  tick: number,
  row: number,
  floor = 0.25,
): string {
  const t = floor + waveBrightness(tick, row) * (1 - floor);
  return blendHex(base, pop, t);
}
