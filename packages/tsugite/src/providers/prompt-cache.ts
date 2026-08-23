/**
 * OpenAI-compatible prompt-cache keys are limited to 64 Unicode characters.
 * Keep this normalization at the transport boundary so callers that construct
 * a provider directly get the same behavior as the agent runtime.
 */
export const PROMPT_CACHE_KEY_MAX_LENGTH = 64;

export function clampPromptCacheKey(key: string | undefined): string | undefined {
  if (key === undefined) return undefined;
  const characters = Array.from(key);
  return characters.length <= PROMPT_CACHE_KEY_MAX_LENGTH
    ? key
    : characters.slice(0, PROMPT_CACHE_KEY_MAX_LENGTH).join('');
}

export function nonNegativeTokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}
