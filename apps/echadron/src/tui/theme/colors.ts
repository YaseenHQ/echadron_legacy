/**
 * Color palette definitions for dark and light themes.
 *
 * `darkColors` / `lightColors` are the semantic `ColorPalette` consumed by
 * every UI component via the global Theme singleton. Each token holds its hex
 * value directly — see the per-token docs on `ColorPalette` for what each one
 * controls.
 *
 * Light palette values are tuned for ≥ 4.5:1 contrast against #FFFFFF
 * for text tokens and ≥ 3:1 for chrome (border / large text), matching
 * WCAG AA.
 */

// Each token below documents where it is actually consumed, so theme authors
// know what changing it affects. "Widely" means the token is read across most
// dialogs/messages rather than in one specific place.
export interface ColorPalette {
  // ── Brand ──
  /** Chrome identity: selected items, focused editor text, links, inline code,
   *  tab fills. Built-in Dark/Light keep this gray so the pop stays on
   *  {@link accent} / {@link running}. */
  primary: string;
  /** Secondary highlight: approval prefix, device-code box, queue. */
  accent: string;
  /** Live-agent pop: thinking spinner, running badges, in-flight tool icons. */
  running: string;

  // ── Text ──
  /** Default body text: dialog bodies, todo titles, footer model label,
   *  markdown headings, tool/read output, and assistant-side message bullets
   *  (assistant / tool / agent / read) plus markdown list bullets. */
  text: string;
  /** Emphasised / bold text: input dialogs, status messages. */
  textStrong: string;
  /** Secondary, dimmed text (the most widely used dim shade): thinking blocks,
   *  hints, descriptions, completed todos, markdown quotes, and the footer
   *  status bar (cwd path, git badge). */
  textDim: string;
  /** Faintest text: counters, scroll info, descriptions, markdown link URLs,
   *  code-block borders. */
  textMuted: string;

  // ── Surface ──
  /** Borders: pane & editor borders, markdown horizontal rule. */
  border: string;
  /** Focus / attention border — currently only the approval panel. */
  borderFocus: string;
  /** Subtle background surface for tool execution panels — a near-black
   *  neutral tone that visually groups each tool call as one unit. */
  surfaceTool: string;
  /** Surface for tool panels that completed successfully — very slight
   *  success-tinted variant of {@link surfaceTool}. */
  surfaceToolSuccess: string;
  /** Surface for tool panels that errored — very slight error-tinted
   *  variant of {@link surfaceTool}. */
  surfaceToolError: string;
  /** Subtle background surface for user messages — distinguishes user input
   *  from assistant output at a glance. Slightly lighter than the tool
   *  panel surface to create visual hierarchy. */
  surfaceUser: string;

  // ── State ──
  /** Success: ✓ marks, "enabled", completed states. */
  success: string;
  /** Warning: auto/yolo badges, stale markers, plan-mode hint. */
  warning: string;
  /** Error: error messages, failed tool output. */
  error: string;

  // ── Diff (all consumed by components/media/diff-preview.ts) ──
  /** Added lines. */
  diffAdded: string;
  /** Removed lines. */
  diffRemoved: string;
  /** Added lines — intra-line changed words (bold). */
  diffAddedStrong: string;
  /** Removed lines — intra-line changed words (bold). */
  diffRemovedStrong: string;
  /** Line-number gutter (also approval panel/preview). */
  diffGutter: string;
  /** Meta / hunk headers. */
  diffMeta: string;

  // ── Roles ──
  /** User message: bullet & text, skill-activation name. Built-in themes keep
   *  this a readable secondary gray so the brand accent stays on chrome. */
  roleUser: string;

  // ── Shell mode ──
  /** Shell mode (`!`): the `!` prompt symbol, bash-mode editor border, and the
   *  echoed `$ command` line. */
  shellMode: string;

  /** Text that sits on a `primary` fill (selected tabs, selected question
   *  chips). Must contrast with `primary` at ≥ 4.5:1. */
  onPrimary: string;
}

/** Dark default. Neutral gray chrome; magenta on live work. */
export const darkColors: ColorPalette = {
  primary: '#E1E1E1',
  accent: '#1ABC9C',
  running: '#BB9AF7',

  text: '#E1E1E1',
  textStrong: '#F3F3F3',
  textDim: '#C8C8C8',
  textMuted: '#6C6C6C',

  border: '#505058',
  borderFocus: '#505058',

  surfaceTool: '#1C1C1C',
  surfaceToolSuccess: '#141A14',
  surfaceToolError: '#1C1215',
  surfaceUser: '#242424',

  success: '#9ECE6A',
  warning: '#E0AF68',
  error: '#F7768E',

  diffAdded: '#9ECE6A',
  diffRemoved: '#F7768E',
  diffAddedStrong: '#B4E07F',
  diffRemovedStrong: '#FF9AAD',
  diffGutter: '#6C6C6C',
  diffMeta: '#C8C8C8',

  roleUser: '#C8C8C8',
  shellMode: '#E0AF68',
  onPrimary: '#141414',
};

/** Light default. Same allocation as Dark, accents deepened for contrast on white. */
export const lightColors: ColorPalette = {
  primary: '#262626',
  // Source teal #0A8E70 is ~4.0:1 on white; deepen for small text (model name).
  accent: '#0A7A62',
  running: '#7D4BC6',

  text: '#262626',
  textStrong: '#141414',
  textDim: '#444444',
  textMuted: '#767676',

  // Source prompt border is too light on a white terminal; DARK5 clears 3:1.
  border: '#626262',
  borderFocus: '#626262',

  surfaceTool: '#E4E4E4',
  surfaceToolSuccess: '#DAF2DC',
  surfaceToolError: '#F5DADE',
  surfaceUser: '#DEDEDE',

  // Source green/gold sit at ~4.0:1; deepen for badge text.
  success: '#0E7A38',
  warning: '#8A5808',
  error: '#CD3048',

  diffAdded: '#0E7A38',
  diffRemoved: '#CD3048',
  diffAddedStrong: '#0E7A38',
  diffRemovedStrong: '#CD3048',
  diffGutter: '#626262',
  diffMeta: '#767676',

  roleUser: '#444444',
  shellMode: '#8A5808',
  onPrimary: '#FFFFFF',
};

export type ResolvedTheme = 'dark' | 'light';

/** Synchronous palette lookup for built-in themes only. */
export function getBuiltInPalette(resolved: ResolvedTheme): ColorPalette {
  return resolved === 'dark' ? darkColors : lightColors;
}
