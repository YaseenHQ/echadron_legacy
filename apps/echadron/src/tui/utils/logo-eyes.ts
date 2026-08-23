import chalk from 'chalk';

/**
 * Chad's idle face.
 *
 * Chad is Echadron's character — the name is the middle of "Echadron", and
 * doubles as one of the CLI's aliases alongside `maker`, which is roughly what
 * the name means. He is a two-row block with two eyes.
 *
 * Gaze, blinks and winks are functions of wall-clock seconds so tests can
 * freeze the pose.
 */

export const LOGO_BODY = '███████';

/**
 * Eyes live on the *top* row of a two-row cube, marked by `EYE_CELL`; gaze is
 * that pupil slid left or right.
 *
 * Every cell is a full block on purpose. Solid cells are painted by filling
 * the cell *background*, which covers the whole line box; a foreground-only
 * glyph covers just the font's glyph box and so renders visibly shorter than
 * its neighbours. Mixing the two — the previous half-block edges — left the
 * silhouette looking clipped down its sides. The pupil is drawn as a dark
 * quadrant over a filled cell rather than as a transparent notch, for the
 * same reason.
 */
const EYE_CELL = '▛';

const FACES = {
  center: '██▛█▛██',
  left: '█▛█▛███',
  right: '███▛█▛█',
  blink: '███████',
} as const;

type Gaze = keyof typeof FACES;

const BEATS: readonly { gaze: Gaze; hold: number }[] = [
  { gaze: 'center', hold: 3.4 },
  { gaze: 'left', hold: 1.5 },
  { gaze: 'center', hold: 2.8 },
  { gaze: 'right', hold: 1.5 },
];

const CYCLE_SECS = BEATS.reduce((sum, beat) => sum + beat.hold, 0);

/** Blink at the *end* of each window so t=0 stays open. */
const BLINK_EVERY_SECS = 5.4;
const BLINK_SECS = 0.18;
const DOUBLE_BLINK_GAP_SECS = 0.28;
/**
 * Occasionally the blink is a wink instead: one eye stays open. Held a little
 * longer than a blink, because a blink is a reflex and a wink is deliberate —
 * at blink speed it just reads as a dropped frame. Rare enough (every ninth
 * window, so roughly once a minute) to stay a surprise rather than a tic.
 */
const WINK_EVERY_WINDOWS = 9;
const WINK_OFFSET_WINDOWS = 4;
const WINK_SECS = 0.3;

/**
 * How Chad behaves while the agent works. Idle keeps the resting cadence;
 * the rest speed his gaze up or narrow his eyes so the one character at the
 * top of the TUI reflects what is happening, rather than a second face being
 * drawn somewhere else.
 */
export type ChadMood = 'idle' | 'waiting' | 'thinking' | 'composing' | 'tool' | 'retry';

/** Time scale and blink bias per mood. */
const MOOD_TEMPO: Record<ChadMood, { readonly rate: number; readonly lidded: boolean }> = {
  idle: { rate: 1, lidded: false },
  // Looking at you, waiting for input or approval: calm, no scanning.
  waiting: { rate: 0.55, lidded: false },
  // Reading around a problem: the gaze scans noticeably faster.
  thinking: { rate: 3.1, lidded: false },
  // Writing: brisk, blinking more often than scanning.
  composing: { rate: 1.9, lidded: true },
  // A tool is running: locked on, eyes half-lidded.
  tool: { rate: 0.7, lidded: true },
  // Something failed and is being retried: darting, unsettled.
  retry: { rate: 5.2, lidded: false },
};

export interface LogoFace {
  readonly rows: readonly [string, string];
  readonly eyeCols: readonly number[];
}

export function logoFaceAt(secs: number, mood: ChadMood = 'idle'): LogoFace {
  const raw = Number.isFinite(secs) ? Math.max(0, secs) : 0;
  const tempo = MOOD_TEMPO[mood];
  const t = raw * tempo.rate;
  const gaze = FACES[gazeAt(t)];
  // Lidded moods blink on a shorter duty cycle; winks are idle-only, since a
  // wink mid-task reads as a glitch rather than character.
  const blinking = tempo.lidded ? isBlinking(t) || isBlinking(t + BLINK_EVERY_SECS / 2) : isBlinking(t);
  const winking = mood === 'idle' && isWinking(t);
  const top = winking ? winkOf(gaze) : blinking ? FACES.blink : gaze;
  return {
    rows: [top, LOGO_BODY],
    eyeCols: eyeColumns(top),
  };
}

export function isBlinking(secs: number): boolean {
  const t = Number.isFinite(secs) ? Math.max(0, secs) : 0;
  const window = Math.floor(t / BLINK_EVERY_SECS);
  // A wink replaces that window's blink rather than stacking with it.
  if (isWinkWindow(window)) return false;
  const phase = t - window * BLINK_EVERY_SECS;
  const first = phase >= BLINK_EVERY_SECS - BLINK_SECS;
  if (window % 4 !== 2) return first;
  const secondStart = BLINK_EVERY_SECS - BLINK_SECS - DOUBLE_BLINK_GAP_SECS;
  const second = phase >= secondStart && phase < secondStart + BLINK_SECS;
  return first || second;
}

export function isWinking(secs: number): boolean {
  const t = Number.isFinite(secs) ? Math.max(0, secs) : 0;
  const window = Math.floor(t / BLINK_EVERY_SECS);
  if (!isWinkWindow(window)) return false;
  const phase = t - window * BLINK_EVERY_SECS;
  return phase >= BLINK_EVERY_SECS - WINK_SECS;
}

function isWinkWindow(window: number): boolean {
  return window % WINK_EVERY_WINDOWS === WINK_OFFSET_WINDOWS;
}

/**
 * Close the trailing eye of a gaze face, leaving the other open. Derived from
 * the live gaze rather than a fixed face so a wink mid-glance keeps looking
 * where the cube was already looking.
 */
function winkOf(face: string): string {
  const glyphs = Array.from(face);
  const closing = glyphs.lastIndexOf(EYE_CELL);
  if (closing < 0) return face;
  glyphs[closing] = SOLID_LOGO_CELL;
  return glyphs.join('');
}

function gazeAt(secs: number): Gaze {
  let cursor = secs % CYCLE_SECS;
  if (cursor < 0) cursor += CYCLE_SECS;
  for (const beat of BEATS) {
    if (cursor < beat.hold) return beat.gaze;
    cursor -= beat.hold;
  }
  return 'center';
}

function eyeColumns(top: string): number[] {
  const cols: number[] = [];
  for (const [i, ch] of Array.from(top).entries()) {
    if (ch === EYE_CELL) cols.push(i);
  }
  return cols.length > 0 ? cols : [2, 4];
}

/** The one glyph that must cover its whole line box for stacked rows to join. */
export const SOLID_LOGO_CELL = '\u2588';
export const LOGO_EYE_CELL = EYE_CELL;

/**
 * Paint one logo cell in `colour`.
 *
 * A font paints only its own glyph box, so in a terminal that adds line
 * spacing (Terminal.app does) two stacked rows of `█` leave a seam between
 * them. Setting the cell background makes the terminal fill the whole cell
 * rect regardless of font metrics, which closes it. Partial glyphs — the
 * half-block edges and the quadrant that carves the eyes — stay
 * foreground-only so their empty parts still show the terminal through.
 */
export function paintLogoCell(glyph: string, colour: string, pupil?: string): string {
  if (glyph === SOLID_LOGO_CELL) return chalk.bgHex(colour).hex(colour)(glyph);
  if (glyph === EYE_CELL && pupil !== undefined) {
    // Fill the cell, then punch the pupil as a dark lower-right quadrant so the
    // eye cell is exactly as tall as the body around it.
    return chalk.bgHex(colour).hex(pupil)(PUPIL_GLYPH);
  }
  return chalk.hex(colour)(glyph);
}

/** Paint a run of same-coloured cells, batching solid runs into one sequence. */
/** Lower-right quadrant: the pupil, drawn over a filled eye cell. */
export const PUPIL_GLYPH = '\u2597';

export function paintLogoRun(text: string, colour: string, pupil?: string): string {
  let out = '';
  let solid = '';
  const flush = (): void => {
    if (solid.length === 0) return;
    out += chalk.bgHex(colour).hex(colour)(solid);
    solid = '';
  };
  for (const glyph of Array.from(text)) {
    if (glyph === SOLID_LOGO_CELL) {
      solid += glyph;
      continue;
    }
    flush();
    out += paintLogoCell(glyph, colour, pupil);
  }
  flush();
  return out;
}
