import { describe, expect, it, vi } from 'vitest';

import { WaitingCueComponent } from '#/tui/components/chrome/waiting-cue';

const ANSI_SGR = /\u001B\[[0-9;]*m/g;

describe('WaitingCueComponent', () => {
  it('renders the waiting diamond, label, and elapsed', () => {
    const ui = { requestRender: vi.fn() };
    const cue = new WaitingCueComponent(
      ui as never,
      'waiting for approval',
      1_000,
      () => 4_400,
    );
    try {
      const line = (cue.render(80)[1] ?? '').replaceAll(ANSI_SGR, '');
      expect(line).toContain('◆');
      expect(line).toContain('waiting for approval');
      expect(line).toMatch(/3\.4s/);
    } finally {
      cue.dispose();
    }
  });
});
