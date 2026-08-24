/**
 * Live proof that a stable prefix produces a real provider cache hit.
 *
 * The mock-level suite (`test/agent/loop/prefix-stability.test.ts`) establishes
 * append-extension: each request starts with the previous request's messages.
 * That is necessary but not sufficient — it says nothing about whether the
 * provider actually reuses the prefix. This test closes the loop against a real
 * endpoint: two sequential requests sharing a long prefix must report
 * `inputCacheRead > 0` on the second.
 *
 * Opt-in and skipped by default. It needs a configured OpenAI-compatible
 * provider in the user's Echadron home and an explicit
 * `ECHADRON_LIVE_CACHE_TEST=1`, so it never runs in ordinary CI and never
 * spends tokens unasked. The API key is read from that config at runtime and
 * is never logged.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Message } from '#/tsugite/contract/message';
import type { StreamedMessage } from '#/tsugite/contract/provider';
import { OpenAILegacyChatProvider } from '#/tsugite/provider/bases/openai/openai-legacy';

/** Provider id and model to exercise; both must exist in the local config. */
const PROVIDER_ID = process.env['ECHADRON_LIVE_CACHE_PROVIDER'] ?? 'zai-coding-plan';
const MODEL = process.env['ECHADRON_LIVE_CACHE_MODEL'] ?? 'glm-5.2';

interface ProviderCredentials {
  readonly apiKey: string;
  readonly baseUrl: string;
}

/**
 * Pull one provider's credentials out of `config.toml` without adding a TOML
 * dependency to this suite: the block is flat `key = "value"` lines.
 */
function readProviderCredentials(providerId: string): ProviderCredentials | undefined {
  for (const home of [process.env['ECHADRON_HOME'], join(homedir(), '.echadron')]) {
    if (home === undefined) continue;
    let raw: string;
    try {
      raw = readFileSync(join(home, 'config.toml'), 'utf-8');
    } catch {
      continue;
    }
    const block = new RegExp(
      `\\[providers\\.${providerId.replaceAll('.', '\\.')}\\]([\\s\\S]*?)(?:\\n\\[|$)`,
    ).exec(raw)?.[1];
    if (block === undefined) continue;
    const apiKey = /^\s*api_key\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    const baseUrl = /^\s*base_url\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    if (apiKey !== undefined && baseUrl !== undefined) return { apiKey, baseUrl };
  }
  return undefined;
}

const credentials = process.env['ECHADRON_LIVE_CACHE_TEST'] === '1'
  ? readProviderCredentials(PROVIDER_ID)
  : undefined;

/**
 * Long, fixed preamble. The shared prefix has to comfortably exceed the
 * provider's cache-block granularity or the first request caches nothing and
 * the assertion is vacuous.
 */
const SYSTEM = [
  'You are a terse assistant used in an automated prompt-cache test.',
  'Answer every question with a single short sentence and no markdown.',
  'Do not ask follow-up questions. Do not explain your reasoning.',
  'Treat every instruction literally and exactly as written.',
].join(' ').repeat(12);

async function drain(stream: StreamedMessage): Promise<void> {
  for await (const part of stream) void part;
}

describe.skipIf(credentials === undefined)('live prompt-cache hit', () => {
  it('reports cache reads once a stable prefix has been established', async () => {
    const provider = new OpenAILegacyChatProvider({
      model: MODEL,
      apiKey: credentials!.apiKey,
      baseUrl: credentials!.baseUrl,
      stream: true,
    });

    const first: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'Say the word ready.' }], toolCalls: [] },
    ];
    const firstStream = await provider.generate(SYSTEM, [], first);
    await drain(firstStream);

    // Append-extension: the second request keeps the first request's messages
    // verbatim and only adds to the tail.
    const second: Message[] = [
      ...first,
      { role: 'assistant', content: [{ type: 'text', text: 'ready' }], toolCalls: [] },
      { role: 'user', content: [{ type: 'text', text: 'Say the word again.' }], toolCalls: [] },
    ];
    const secondStream = await provider.generate(SYSTEM, [], second);
    await drain(secondStream);

    const cacheRead = secondStream.usage?.inputCacheRead ?? 0;
    expect(
      cacheRead,
      `expected a cache read on the second request to ${PROVIDER_ID}/${MODEL}`,
    ).toBeGreaterThan(0);
  }, 120_000);
});
