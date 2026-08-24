import { describe, expect, it } from 'vitest';

import { modelTablesEqual } from '#/tui/controllers/auth-flow';

describe('modelTablesEqual', () => {
  it('detects changed model metadata even when aliases are unchanged', () => {
    const current = {
      'xai/grok-4': {
        provider: 'xai',
        model: 'grok-4',
        maxContextSize: 131_072,
        displayName: 'Grok 4',
      },
    };
    const refreshed = {
      ...current,
      'xai/grok-4': {
        ...current['xai/grok-4'],
        maxContextSize: 1_000_000,
      },
    };

    expect(modelTablesEqual(current, refreshed)).toBe(false);
  });

  it('treats equivalent model tables as unchanged', () => {
    const current = {
      'xai/grok-4': {
        provider: 'xai',
        model: 'grok-4',
        requestHeaders: { beta: 'one', version: 'two' },
      },
    };
    const refreshed = {
      'xai/grok-4': {
        provider: 'xai',
        model: 'grok-4',
        requestHeaders: { beta: 'one', version: 'two' },
      },
    };

    expect(modelTablesEqual(current, refreshed)).toBe(true);
  });
});
