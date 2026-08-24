/**
 * Prompt-cache prefix stability.
 *
 * Providers cache on the request prefix, so a cache hit requires each request
 * in a turn to be an *append-extension* of the one before it: same system
 * prompt, same tool schemas, and a history that starts with the previous
 * history unchanged. Any mid-history rewrite — re-ordering, editing, or
 * dropping an earlier message — silently invalidates the cache from that point
 * on and shows up only as a cost/latency regression in production.
 *
 * These assertions make that invariant checkable in CI: the harness already
 * records every provider call with its system prompt, tools, and full history,
 * so no extra instrumentation is needed.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { Message } from '#/tsugite/contract/message';
import { IAgentSwarmService } from '#/agent/swarm/swarm';
import { createTestAgent, type TestAgentContext } from '../../harness';

interface GenerateCallLike {
  readonly systemPrompt: string;
  readonly tools: Array<{ name: string }>;
  readonly history: Message[];
}

/** Identity of one history entry for prefix comparison. */
function messageKey(message: Message): string {
  return JSON.stringify({
    role: message.role,
    content: message.content,
    toolCalls: message.toolCalls,
    toolCallId: message.toolCallId,
  });
}

/**
 * Assert every call extends its predecessor without rewriting shared history.
 * Returns the per-call history lengths so a caller can also pin growth.
 */
function expectAppendExtension(calls: readonly GenerateCallLike[]): number[] {
  expect(calls.length).toBeGreaterThan(1);
  for (let i = 1; i < calls.length; i += 1) {
    const previous = calls[i - 1]!;
    const current = calls[i]!;

    // Header must not change mid-turn: either one busts the whole prefix.
    expect(current.systemPrompt, `call ${String(i)} system prompt`).toBe(previous.systemPrompt);
    expect(
      current.tools.map((tool) => tool.name),
      `call ${String(i)} tool set`,
    ).toEqual(previous.tools.map((tool) => tool.name));

    // History must only grow, and the shared span must be byte-identical.
    expect(current.history.length, `call ${String(i)} history shrank`).toBeGreaterThanOrEqual(
      previous.history.length,
    );
    const sharedBefore = previous.history.map(messageKey);
    const sharedAfter = current.history.slice(0, previous.history.length).map(messageKey);
    expect(sharedAfter, `call ${String(i)} rewrote earlier history`).toEqual(sharedBefore);
  }
  return calls.map((call) => call.history.length);
}

describe('prompt-cache prefix stability', () => {
  let ctx: TestAgentContext;

  afterEach(async () => {
    await ctx.dispose();
  });

  it('extends the prefix across the steps of a tool-calling turn', async () => {
    ctx = createTestAgent();

    // A builtin tool runs in-process, so the turn takes a second step with the
    // call and its result appended.
    ctx.mockNextResponse({
      type: 'function',
      id: 'g1',
      name: 'GetGoal',
      arguments: JSON.stringify({}),
    });
    ctx.mockNextResponse({ type: 'text', text: 'done' });

    await ctx.rpc.prompt({ input: [{ type: 'text', text: 'Check the goal' }] });
    await ctx.untilTurnEnd();

    const lengths = expectAppendExtension(ctx.llmCalls as unknown as GenerateCallLike[]);
    // The tool call and its result both land before the second request.
    expect(lengths[1]).toBeGreaterThan(lengths[0]!);
  });

  it('survives a swarm-mode toggle between turns', async () => {
    // Swarm mode appends an enter reminder and, on exit, the `swarm_mode.exit`
    // reducer pops it back off. A pop is a history rewrite, which is exactly
    // the shape that silently invalidates the cache — pin that it only ever
    // trims the tail rather than disturbing earlier messages.
    ctx = createTestAgent();
    const swarm = ctx.get(IAgentSwarmService);

    ctx.mockNextResponse({ type: 'text', text: 'first' });
    await ctx.rpc.prompt({ input: [{ type: 'text', text: 'one' }] });
    await ctx.untilTurnEnd();

    swarm.enter('manual');
    ctx.mockNextResponse({ type: 'text', text: 'second' });
    await ctx.rpc.prompt({ input: [{ type: 'text', text: 'two' }] });
    await ctx.untilTurnEnd();

    swarm.exit();
    ctx.mockNextResponse({ type: 'text', text: 'third' });
    await ctx.rpc.prompt({ input: [{ type: 'text', text: 'three' }] });
    await ctx.untilTurnEnd();

    const calls = ctx.llmCalls as unknown as GenerateCallLike[];
    expect(calls.length).toBe(3);
    // The first turn's prefix must survive both the enter and the exit.
    const firstKeys = calls[0]!.history.map(messageKey);
    for (const [index, call] of calls.entries()) {
      expect(call.history.slice(0, firstKeys.length).map(messageKey), `call ${String(index)}`).toEqual(
        firstKeys,
      );
    }
  });

  it('extends the prefix across turns rather than rebuilding it', async () => {
    ctx = createTestAgent();

    ctx.mockNextResponse({ type: 'text', text: 'first' });
    await ctx.rpc.prompt({ input: [{ type: 'text', text: 'one' }] });
    await ctx.untilTurnEnd();

    ctx.mockNextResponse({ type: 'text', text: 'second' });
    await ctx.rpc.prompt({ input: [{ type: 'text', text: 'two' }] });
    await ctx.untilTurnEnd();

    // A second turn must reuse the first turn's prefix verbatim; rebuilding
    // history between turns is the most expensive cache miss of all.
    expectAppendExtension(ctx.llmCalls as unknown as GenerateCallLike[]);
  });
});
