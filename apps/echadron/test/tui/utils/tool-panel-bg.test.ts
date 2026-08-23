import { describe, expect, it } from 'vitest';

import { toolPanelSurface } from '#/tui/utils/tool-panel-bg';

describe('toolPanelSurface', () => {
  it('keeps in-flight panels neutral', () => {
    expect(toolPanelSurface(false, false)).toBe('surfaceTool');
  });

  it('uses the success surface after a completed tool call', () => {
    expect(toolPanelSurface(true, false)).toBe('surfaceToolSuccess');
  });

  it('keeps failures on the error surface', () => {
    expect(toolPanelSurface(true, true)).toBe('surfaceToolError');
  });
});
