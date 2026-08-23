import spinners, { type BrailleSpinnerName } from 'unicode-animations';

// Continuation indent for transcript rows that use a two-cell leading marker.
export const MESSAGE_INDENT = '  ';

// Outer left/right padding applied to the transcript, panels, and the
// statusline so the chrome's left edge lines up with the input box's
// interior (the `>` prompt). The editor itself stays at column 0 — its
// vertical borders are the visual anchor everything else aligns against.
export const CHROME_GUTTER = 1;

// Shared preview caps used by thinking, tool results, and shell snippets.
export const RESULT_PREVIEW_LINES = 3;
// Collapsed row cap for a finished `!` shell command's output card.
export const SHELL_OUTPUT_PREVIEW_LINES = 10;
export const THINKING_PREVIEW_LINES = 2;
export const COMMAND_PREVIEW_LINES = 10;

// Animation frames are shared by the login/update loaders and live thinking.
// Keep the animation catalogue in one place so every TUI surface uses the same
// timing and can be tuned without introducing ad-hoc frame arrays.
export type UnicodeAnimationName = BrailleSpinnerName;

// The palette is semantic on purpose: call sites describe the state being
// rendered, while this table owns the visual language and can be tuned later
// without touching the session or transcript controllers.
export const TUI_ANIMATIONS = {
  default: 'braille',
  retry: 'scanline',
  progress: 'pulse',
  composing: 'breathe',
  tool: 'orbit',
  subagent: 'dna',
  mcp: 'helix',
} as const satisfies Record<string, UnicodeAnimationName>;

export const BRAILLE_SPINNER_FRAMES = [...spinners.braille.frames];
export const BRAILLE_SPINNER_INTERVAL_MS = spinners.braille.interval;

export const SUBAGENT_SPINNER_FRAMES = [...spinners[TUI_ANIMATIONS.subagent].frames];
export const SUBAGENT_SPINNER_INTERVAL_MS = spinners[TUI_ANIMATIONS.subagent].interval;

export function animationFrames(name: UnicodeAnimationName = 'braille'): string[] {
  return [...spinners[name].frames];
}

export function animationInterval(name: UnicodeAnimationName = 'braille'): number {
  return spinners[name].interval;
}

// Cap on the step-retry detail line under the waiting spinner, so huge
// provider error bodies (occasionally whole HTML error pages) can't flood
// the activity pane.
export const RETRY_DETAIL_MAX_CHARS = 160;
