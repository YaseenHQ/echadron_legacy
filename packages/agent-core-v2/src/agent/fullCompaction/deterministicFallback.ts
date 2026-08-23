/**
 * `fullCompaction` domain (L4) — the deterministic compaction fallback.
 *
 * Compaction normally asks a model to summarize the history. That call can
 * fail: the provider is down, the key expired mid-session, every shrink attempt
 * still overflows. Without a fallback the session dead-ends — the context is
 * too large to send and the only path that shrinks it needs the very model that
 * is failing.
 *
 * So this path exists: it shrinks the context using no model call at all. The
 * budget is a pure function of the model's context window, and the replacement
 * text states only facts read off the history — how many messages were folded,
 * how they split by role, which tools ran and under which call ids. It never
 * invents prose, because there is nothing here that could.
 *
 * A summary written this way is worse than a real one. It is much better than a
 * session that cannot continue.
 */

import type { ContextMessage } from '#/agent/contextMemory/types';

/**
 * Share of the context window the fallback text may occupy, before clamping.
 * A tuning knob — the invariant that matters is that the budget needs no model
 * call to compute.
 */
export const DEFAULT_FALLBACK_WINDOW_RATIO = 0.5;

/** Below this the replacement carries too little to continue from. */
export const MIN_FALLBACK_CHARS = 10_000;
/** Above this the replacement stops being a compaction. */
export const MAX_FALLBACK_CHARS = 400_000;

/** What the fallback did, recorded for telemetry. */
export interface CompactionOutcome {
  readonly mode: 'summarizer' | 'deterministic_fallback';
  readonly errorKind: string | null;
  readonly contextWindowTokens: number;
  readonly windowRatio: number;
  readonly maxChars: number;
  readonly fallbackTextLength: number;
  readonly totalMessages: number;
}

/**
 * The character budget for the replacement text: the window scaled by `ratio`,
 * clamped. A pure function of the window size — no model call, no history scan,
 * so it cannot fail for the same reason the summarizer just did.
 */
export function deterministicFallbackMaxChars(contextWindowTokens: number, ratio: number): number {
  const safeWindow = Number.isFinite(contextWindowTokens) && contextWindowTokens > 0 ? contextWindowTokens : 0;
  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : DEFAULT_FALLBACK_WINDOW_RATIO;
  const scaled = Math.floor(safeWindow * safeRatio);
  return Math.max(MIN_FALLBACK_CHARS, Math.min(MAX_FALLBACK_CHARS, scaled));
}

export function buildDeterministicSummary(
  messages: readonly ContextMessage[],
  maxChars: number,
): string {
  const byRole = new Map<string, number>();
  let toolCallCount = 0;
  for (const message of messages) {
    byRole.set(message.role, (byRole.get(message.role) ?? 0) + 1);
    toolCallCount += message.toolCalls.length;
  }

  const header: string[] = [
    '## Compacted history (deterministic fallback)',
    '',
    'The summarizer was unavailable, so this replaces the earlier conversation',
    'with facts only. No content below was written by a model.',
    '',
    `- Messages folded: ${String(messages.length)}`,
  ];
  for (const [role, count] of [...byRole].sort(([a], [b]) => a.localeCompare(b))) {
    header.push(`- ${role} messages: ${String(count)}`);
  }
  if (toolCallCount > 0) header.push(`- Tool calls: ${String(toolCallCount)}`);

  // The counts above identify the folded span and must always survive, so they
  // are rendered first and the per-call detail only fills what budget is left.
  // Rendering every call first and truncating afterwards would let a long tool
  // history build a huge string before the cap could apply.
  const lines = [...header];
  let used = lines.join('\n').length;
  if (toolCallCount > 0) {
    lines.push('', '### Tool calls, by id', '');
    used = lines.join('\n').length;
    let listed = 0;
    outer: for (const message of messages) {
      for (const call of message.toolCalls) {
        const line = `- ${call.name} (${call.id})`;
        if (used + line.length + 1 > maxChars) break outer;
        lines.push(line);
        used += line.length + 1;
        listed += 1;
      }
    }
    if (listed < toolCallCount) {
      lines.push(`- ... and ${String(toolCallCount - listed)} more, omitted for length`);
    }
  }

  const text = lines.join('\n');
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}
