import { describe, expect, it } from 'vitest';

import { isBlinking, isWinking, logoFaceAt } from '#/tui/utils/logo-eyes';
import {
  blendHex,
  glintHead,
  glintIntensity,
  glintRow,
  idleBreath,
} from '#/tui/utils/logo-shimmer';

const COLS = 7;
const CYCLE_SECS = 5.5;

/** Blend weight of every cell on one row at one instant. */
function rowWeights(row: number, secs: number): number[] {
  return glintRow('\u2590\u2588\u2588\u2588\u2588\u2588\u258C', row, secs).flatMap((segment) =>
    Array.from({ length: Array.from(segment.text).length }, () => segment.weight),
  );
}

function brightest(secs: number): number {
  return Math.max(...rowWeights(0, secs), ...rowWeights(1, secs));
}

/** Column carrying the peak on one row. */
function peakColumn(row: number, secs: number): number {
  const weights = rowWeights(row, secs);
  return weights.indexOf(Math.max(...weights));
}

function sampleCycle(step = 0.02): number[] {
  return Array.from({ length: Math.round(CYCLE_SECS / step) }, (_, i) => i * step);
}

describe('Chad: sheen', () => {
  it('stays a gentle lift, never a near-white flash', () => {
    const peak = Math.max(...sampleCycle().map(brightest));
    expect(peak).toBeGreaterThan(0.3);
    expect(peak).toBeLessThan(0.5);
  });

  it('keeps neighbouring cells close so seven cells read as a gradient', () => {
    // The failure this guards: a highlight narrow enough to light one or two
    // cells hops between them instead of sweeping, which reads as a glitch.
    let widestStep = 0;
    for (const secs of sampleCycle(0.05)) {
      for (const row of [0, 1]) {
        const weights = rowWeights(row, secs);
        for (let col = 1; col < weights.length; col += 1) {
          widestStep = Math.max(widestStep, Math.abs(weights[col]! - weights[col - 1]!));
        }
      }
    }
    expect(widestStep).toBeLessThan(0.2);
  });

  it('puts every cell somewhere on the gradient mid-sweep', () => {
    const weights = rowWeights(0, 1.25);
    expect(weights.every((weight) => weight > 0)).toBe(true);
    expect(new Set(weights).size).toBeGreaterThan(4);
  });

  it('travels left to right across Chad', () => {
    const columns = [0.8, 1.0, 1.25, 1.5].map((secs) => peakColumn(0, secs));
    expect(columns).toEqual([...columns].sort((a, b) => a - b));
    expect(columns.at(-1)!).toBeGreaterThan(columns[0]!);
  });

  it('falls off faster ahead of the centre than behind it', () => {
    const secs = 1.25;
    const head = glintHead(secs);
    expect(glintIntensity(head - 0.5, secs)).toBeGreaterThan(glintIntensity(head + 0.5, secs));
  });

  it('lags the lower row so Chad reads as a solid', () => {
    expect(peakColumn(1, 1.0)).toBeLessThanOrEqual(peakColumn(0, 1.0));
    expect(rowWeights(1, 0.75)[0]!).toBeLessThan(rowWeights(0, 0.75)[0]!);
  });

  it('breathes between sweeps so the header is never static for long', () => {
    // The failure this guards: dropping the idle breath left the logo frozen
    // for most of the cycle, so the sweep read as a flash out of nowhere.
    const quiet = [2.5, 3, 4, 4.5, 5].map(brightest);
    expect(Math.max(...quiet)).toBeGreaterThan(0);
    expect(idleBreath(1.85)).toBeGreaterThan(0.05);
  });

  it('merges cells that render to the same colour', () => {
    const resting = glintRow('\u2590\u2588\u2588\u2588\u2588\u2588\u258C', 0, 3.5);
    expect(resting).toHaveLength(1);
    expect(resting[0]!.text).toBe('\u2590\u2588\u2588\u2588\u2588\u2588\u258C');

    const sweeping = glintRow('\u2590\u2588\u2588\u2588\u2588\u2588\u258C', 0, 1.25);
    expect(sweeping.length).toBeGreaterThan(1);
    expect(sweeping.map((segment) => segment.text).join('')).toBe(
      '\u2590\u2588\u2588\u2588\u2588\u2588\u258C',
    );
  });

  it('survives empty rows and non-finite clocks', () => {
    expect(glintRow('', 0, 1)).toEqual([]);
    expect(glintIntensity(Number.NaN, 1)).toBe(0);
    expect(idleBreath(Number.NaN)).toBe(0);
  });

  it('blends hex channels', () => {
    expect(blendHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});

describe('Chad: eyes', () => {
  it('looks at you with the original small pupils at rest', () => {
    const face = logoFaceAt(0);
    expect(face.rows[0]).toBe('██▛█▛██');
    expect(face.rows[1]).toBe('███████');
    expect(face.eyeCols).toEqual([2, 4]);
    expect(isBlinking(0)).toBe(false);
  });

  it('blinks by closing the pupils inside the same cube', () => {
    expect(isBlinking(5.31)).toBe(true);
    expect(logoFaceAt(5.31).rows[0]).toBe('███████');
  });

  it('glances left and right by sliding the same small notch', () => {
    const left = logoFaceAt(3.6);
    expect(isBlinking(3.6)).toBe(false);
    expect(left.rows[0]).toBe('█▛█▛███');
    expect(left.eyeCols).toEqual([1, 3]);

    const right = logoFaceAt(8.0);
    expect(isBlinking(8.0)).toBe(false);
    expect(right.rows[0]).toBe('███▛█▛█');
    expect(right.eyeCols).toEqual([3, 5]);
  });

  it('winks by closing one eye while the other keeps looking', () => {
    // The first wink window lands just before 27s.
    const winking = 26.8;
    expect(isWinking(winking)).toBe(true);
    const face = logoFaceAt(winking);
    expect(face.eyeCols).toHaveLength(1);
    expect(face.rows[0]).toContain('▛');
    expect(face.rows[1]).toBe('███████');
  });

  it('never winks and blinks at once, which would close the whole face', () => {
    let winkFrames = 0;
    let overlaps = 0;
    for (let t = 0; t < 300; t += 0.02) {
      if (!isWinking(t)) continue;
      winkFrames += 1;
      if (isBlinking(t)) overlaps += 1;
    }
    expect(winkFrames).toBeGreaterThan(0);
    expect(overlaps).toBe(0);
  });

  it('winks from the live gaze instead of snapping to centre', () => {
    const faces = new Set<string>();
    for (let t = 0; t < 600; t += 0.02) {
      if (isWinking(t)) faces.add(logoFaceAt(t).rows[0]);
    }
    // Left, centre and right gazes each produce their own one-eyed face.
    expect(faces.size).toBeGreaterThan(1);
    for (const face of faces) {
      expect(Array.from(face).filter((glyph) => glyph === '▛')).toHaveLength(1);
    }
  });

  it('holds a wink longer than a blink so it reads as deliberate', () => {
    const frames = (predicate: (t: number) => boolean, from: number, to: number): number => {
      let count = 0;
      for (let t = from; t < to; t += 0.01) if (predicate(t)) count += 1;
      return count;
    };
    // One wink window versus one ordinary blink window.
    expect(frames(isWinking, 26, 27.5)).toBeGreaterThan(frames(isBlinking, 5, 5.5));
  });

  it('reacts to what the agent is doing, on the one face at the top', () => {
    // The header holds live app state, so Chad himself changes tempo — there is
    // no second face anywhere else in the UI.
    const gazesOver = (mood: Parameters<typeof logoFaceAt>[1], span: number): number => {
      const seen = new Set<string>();
      for (let t = 0; t < span; t += 0.05) seen.add(logoFaceAt(t, mood).rows[0]);
      return seen.size;
    };
    // Thinking scans faster than idle over the same window; a running tool is
    // calmer than thinking.
    expect(gazesOver('thinking', 3)).toBeGreaterThan(gazesOver('idle', 3));
    expect(gazesOver('retry', 3)).toBeGreaterThanOrEqual(gazesOver('thinking', 3));
    expect(gazesOver('tool', 3)).toBeLessThan(gazesOver('thinking', 3));
  });

  it('only winks when idle, never mid-task', () => {
    for (const mood of ['waiting', 'thinking', 'composing', 'tool', 'retry'] as const) {
      let winked = false;
      for (let t = 0; t < 120; t += 0.05) {
        if (logoFaceAt(t, mood).eyeCols.length === 1) winked = true;
      }
      expect(winked, mood).toBe(false);
    }
  });

  it('never opens Chad\'s roof with a half-block pupil', () => {
    for (let t = 0; t < 20; t += 0.25) {
      expect(logoFaceAt(t).rows[0]).not.toMatch(/[▄▙▟▀]/);
    }
  });
});
