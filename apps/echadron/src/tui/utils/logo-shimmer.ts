/**
 * Welcome-logo sheen.
 *
 * The header logo is seven cells wide, which is the constraint that drives
 * everything here. At that resolution a narrow highlight cannot travel
 * smoothly — it lands on one or two cells and hops between them, reading as
 * a flash rather than a sheen. So the wash is deliberately *wider than the
 * logo*: every cell sits somewhere on the gradient at all times and they all
 * move together, which is what buys smoothness when there are no pixels to
 * spare. Amplitude stays low for the same reason; a near-white peak on a
 * seven-cell block looks like a rendering fault.
 *
 * A slow idle breath runs underneath the whole cycle so the header is never
 * completely static between passes.
 *
 * Callers pass wall-clock seconds so tests can freeze the phase.
 */

const TWO_PI = Math.PI * 2;

/** One sweep plus the rest that follows it. */
const CYCLE_SECS = 5.5;
/** Portion of the cycle the wash is travelling (~2.5s, slow enough to read). */
const TRAVEL_FRAC = 0.46;
/** Leading falloff, in logo widths. Wider than the logo on purpose. */
const LEAD_WIDTH = 0.7;
/** Trailing falloff. Slightly longer than the lead so the wash has direction. */
const TRAIL_WIDTH = 1;
/** Peak blend toward the highlight colour. Gentle — this is a sheen, not a flash. */
const PEAK = 0.34;
/** How far the lower row lags the upper one, as a fraction of logo width. */
const ROW_LAG = 0.1;
/**
 * Deepest row the lag applies to. The header cube is two rows, and the travel
 * extent below is sized to carry the tail clear of the last lagged cell —
 * clamping here keeps that guarantee (the wash reaches 0) if a caller ever
 * passes a taller block.
 */
const MAX_LAG_ROWS = 1;
/** Idle breath amplitude and period, so the logo is never fully static. */
const IDLE = 0.1;
const IDLE_SECS = 3.7;

/**
 * Weight resolution used only to merge adjacent cells that would render to
 * the same colour anyway. Fine enough to be invisible against an 8-bit
 * channel blend; it is not a visual effect.
 */
const WEIGHT_STEPS = 128;

export const LOGO_GLINT_FPS = 12;
export const LOGO_GLINT_INTERVAL_MS = Math.round(1000 / LOGO_GLINT_FPS);

export interface GlintSegment {
  readonly text: string;
  /** Blend factor toward the highlight colour, in `[0, 1]`. */
  readonly weight: number;
}

/**
 * Centre of the wash, in logo widths. Starts with its leading edge just off
 * the left of the logo and ends with its tail just clear of the right, so the
 * sweep contributes nothing at either end of the travel.
 */
export function glintHead(secs: number): number {
  if (!Number.isFinite(secs)) return -LEAD_WIDTH;
  const phase = (((secs % CYCLE_SECS) + CYCLE_SECS) % CYCLE_SECS) / CYCLE_SECS;
  const travel = smootherstep(phase / TRAVEL_FRAC);
  return -LEAD_WIDTH + travel * (1 + MAX_LAG_ROWS * ROW_LAG + LEAD_WIDTH + TRAIL_WIDTH);
}

/** Slow whole-logo breath that runs underneath the sweep. */
export function idleBreath(secs: number): number {
  if (!Number.isFinite(secs)) return 0;
  return IDLE * (0.5 - 0.5 * Math.cos((TWO_PI * secs) / IDLE_SECS));
}

/**
 * Blend weight in `[0, 1]` at normalised position `x` (0 = left edge, 1 =
 * right edge). The falloff is evaluated over a slightly narrower width ahead
 * of the centre than behind it, which gives the wash a direction without
 * costing smoothness. Both widths exceed the logo, so no cell is ever left
 * sitting on a hard edge.
 */
export function glintIntensity(x: number, secs: number): number {
  if (!Number.isFinite(x)) return 0;
  const offset = x - glintHead(secs);
  const width = offset >= 0 ? LEAD_WIDTH : TRAIL_WIDTH;
  const wash = smootherstep(1 - Math.abs(offset) / width);
  return clamp01(idleBreath(secs) + PEAK * wash);
}

/** Blend weight for one cell, rounded to the colour-merge resolution. */
export function glintLevel(col: number, row: number, cols: number, secs: number): number {
  const span = Math.max(1, cols - 1);
  const lagRows = Math.min(Math.max(0, row), MAX_LAG_ROWS);
  return Math.round(glintIntensity(col / span + lagRows * ROW_LAG, secs) * WEIGHT_STEPS);
}

/**
 * Split one logo row into runs whose cells would render to the same colour.
 * Callers map `weight` onto their own base/highlight pair, so this stays
 * colour-agnostic.
 */
export function glintRow(text: string, row: number, secs: number): readonly GlintSegment[] {
  const glyphs = Array.from(text);
  if (glyphs.length === 0) return [];

  const segments: GlintSegment[] = [];
  let run = '';
  let runLevel = glintLevel(0, row, glyphs.length, secs);
  for (const [col, glyph] of glyphs.entries()) {
    const level = glintLevel(col, row, glyphs.length, secs);
    if (level !== runLevel) {
      segments.push({ text: run, weight: runLevel / WEIGHT_STEPS });
      run = '';
      runLevel = level;
    }
    run += glyph;
  }
  segments.push({ text: run, weight: runLevel / WEIGHT_STEPS });
  return segments;
}

export function blendHex(base: string, hilite: string, t: number): string {
  const from = parseHex(base);
  const to = parseHex(hilite);
  if (from === undefined || to === undefined) return base;
  const clamped = clamp01(t);
  return rgbToHex(
    mix(from[0], to[0], clamped),
    mix(from[1], to[1], clamped),
    mix(from[2], to[2], clamped),
  );
}

/**
 * Quintic ease with zero slope at both ends, used for the travel ramp and
 * for the falloff on each side of the peak. Flat at the peak keeps the
 * brightest cell from reading as a hard edge.
 */
function smootherstep(v: number): number {
  const c = clamp01(v);
  return c * c * c * (c * (c * 6 - 15) + 10);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function parseHex(value: string): readonly [number, number, number] | undefined {
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (match === null) return undefined;
  const n = Number.parseInt(match[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
