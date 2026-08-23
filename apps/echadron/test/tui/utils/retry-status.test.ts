import { describe, expect, it } from 'vitest';

import { RETRY_DETAIL_MAX_CHARS } from '#/tui/constant/rendering';
import { formatRetryStatus } from '#/tui/kimi-tui';
import type { StepRetryStatus } from '#/tui/types';

function status(overrides: Partial<StepRetryStatus> = {}): StepRetryStatus {
  return {
    failedAttempt: 1,
    nextAttempt: 2,
    maxAttempts: 3,
    delayMs: 1500,
    errorName: 'APIStatusError',
    errorMessage: 'rate limit exceeded',
    statusCode: 429,
    ...overrides,
  };
}

describe('formatRetryStatus', () => {
  it('names the attempt, the wait, and the provider reason', () => {
    expect(formatRetryStatus(status(), 'request')).toBe(
      'Retrying request 2/3 in 1.5s · 429 rate limit exceeded',
    );
  });

  it('distinguishes a compaction retry from a request retry', () => {
    expect(formatRetryStatus(status(), 'compaction')).toContain('Retrying compaction 2/3');
  });

  it('caps a huge provider body so it cannot flood the activity line', () => {
    // Providers occasionally return whole HTML error pages; uncapped, the
    // spinner label would carry the entire body.
    const line = formatRetryStatus(
      status({ statusCode: undefined, errorMessage: 'x'.repeat(4000) }),
      'request',
    );
    expect(line.length).toBeLessThan(RETRY_DETAIL_MAX_CHARS + 60);
    expect(line.endsWith('…')).toBe(true);
  });

  it('collapses newlines and tabs into a single line', () => {
    const line = formatRetryStatus(
      status({ statusCode: undefined, errorMessage: 'first\n\tsecond   third' }),
      'request',
    );
    expect(line).toContain('first second third');
    expect(line).not.toContain('\n');
  });
});
