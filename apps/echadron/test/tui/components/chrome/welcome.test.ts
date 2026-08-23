import { visibleWidth } from '@yaseenhq/pi-tui';
import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { WelcomeComponent } from '#/tui/components/chrome/welcome';
import { setRainbowDance, type RainbowDanceController } from '#/tui/easter-eggs/dance';
import { darkColors } from '#/tui/theme/colors';
import type { AppState } from '#/tui/types';

const TRUECOLOR_PATTERN = /\u001B\[38;2;(\d+);(\d+);(\d+)m/g;

const appState: AppState = {
  version: '1.2.3',
  workDir: '/tmp/project',
  additionalDirs: [],
  sessionId: 'ses-1',
  sessionTitle: null,
  model: 'kimi-k2',
  permissionMode: 'manual',
  thinkingEffort: 'off',
  contextUsage: 0,
  contextTokens: 0,
  maxContextTokens: 0,
  isCompacting: false,
  isReplaying: false,
  streamingPhase: 'idle',
  streamingStartTime: 0,
  planMode: false,
  inputMode: 'prompt',
  swarmMode: false,
  theme: 'dark',
  editorCommand: null,
  notifications: { enabled: true, condition: 'unfocused' },
  upgrade: { autoInstall: true },
  availableModels: {},
  availableProviders: {},
  mcpServersSummary: null,
};

function truecolorCodes(text: string): Set<string> {
  const codes = new Set<string>();
  for (const match of text.matchAll(TRUECOLOR_PATTERN)) {
    codes.add(`${match[1]},${match[2]},${match[3]}`);
  }
  return codes;
}

function rgbOf(hex: string): string {
  const value = hex.replace(/^#/, '');
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ].join(',');
}

/** The two identity rows (logo + product/workspace metadata). */
function headerOf(lines: string[]): string {
  return [lines[1], lines[2]].join('\n');
}

function setDanceView(colored: boolean, phase: number): void {
  const dance: RainbowDanceController = {
    colored,
    phase,
    start: () => {},
    stop: () => {},
    dispose: () => {},
  };
  setRainbowDance(dance);
}

describe('WelcomeComponent', () => {
  const previousChalkLevel = chalk.level;

  beforeEach(() => {
    chalk.level = 3;
  });

  afterEach(() => {
    chalk.level = previousChalkLevel;
    setRainbowDance(undefined);
  });

  it('keeps the header gray without a teal model tint', () => {
    const header = headerOf(new WelcomeComponent(appState, { now: () => 0 }).render(80));
    const codes = truecolorCodes(header);

    expect(codes.has(rgbOf(darkColors.accent))).toBe(false);
    expect(codes.has(rgbOf(darkColors.running))).toBe(false);
    expect(codes.has(rgbOf(darkColors.textStrong))).toBe(true);
  });

  it('paints the banner in rainbow while colored', () => {
    setDanceView(true, 0);
    const codes = truecolorCodes(headerOf(new WelcomeComponent(appState).render(80)));

    expect(codes.size).toBeGreaterThanOrEqual(5);
  });

  it('renders exactly the default banner when not colored', () => {
    const now = () => 0;
    const base = headerOf(new WelcomeComponent(appState, { now }).render(80));
    setDanceView(false, 5);
    const off = headerOf(new WelcomeComponent(appState, { now }).render(80));

    expect(off).toBe(base);
  });

  it('draws the resting cube face with two open eyes', () => {
    const header = headerOf(new WelcomeComponent(appState, { now: () => 0 }).render(80));
    const plain = header.replaceAll(/\u001B\[[0-9;]*m/g, '');
    // Every cell is a full block so the painted background covers the whole
    // line box; the eyes are pupils drawn over filled cells, not holes.
    expect(plain).toContain('██▗█▗██');
    expect(plain).toContain('███████');
  });

  it('uses compact command-line hierarchy without a surrounding panel', () => {
    const rendered = new WelcomeComponent(appState).render(80).join('\n');

    expect(rendered).toContain('Echadron');
    expect(rendered).toContain('/tmp/project');
    expect(rendered).not.toContain('Ask, edit, or run anything');
    expect(rendered).toContain('/ commands');
    expect(rendered).not.toContain('Directory:');
    expect(rendered).not.toContain('Session:');
    expect(rendered).not.toContain('╭');
  });

  it('keeps every line within the requested width on narrow terminals', () => {
    for (const width of [0, 1, 2, 4, 10, 39, 80]) {
      for (const line of new WelcomeComponent(appState).render(width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });
});
