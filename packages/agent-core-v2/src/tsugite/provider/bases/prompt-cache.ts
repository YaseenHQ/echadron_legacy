/** Shared prompt-cache wire limits and usage normalization for provider bases. */

export const PROMPT_CACHE_KEY_MAX_LENGTH = 64;

/**
 * OpenAI-compatible gateways use a short, stable prompt-cache key. Keep the
 * same Unicode-character limit as the provider SDKs so a multibyte key cannot
 * be split in the middle of a character.
 */
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

export interface PromptCacheTokenCounts {
  inputCacheRead: number;
  inputCacheCreation: number;
}

function firstTokenCount(
  object: Record<string, unknown>,
  keys: readonly string[],
): number | undefined {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(object, key)) {
      return nonNegativeTokenCount(object[key]);
    }
  }
  return undefined;
}

/** Read the cache counters used by OpenAI, Responses, and compatible gateways. */
export function extractPromptCacheTokens(
  usage: Record<string, unknown>,
): PromptCacheTokenCounts {
  const nested = [usage['prompt_tokens_details'], usage['input_tokens_details']].flatMap(
    (value) =>
      typeof value === 'object' && value !== null && !Array.isArray(value)
        ? [value as Record<string, unknown>]
        : [],
  );
  const nestedValue = (keys: readonly string[]): number | undefined => {
    for (const details of nested) {
      const value = firstTokenCount(details, keys);
      if (value !== undefined) return value;
    }
    return undefined;
  };

  return {
    inputCacheRead:
      firstTokenCount(usage, [
        'cached_tokens',
        'prompt_cache_hit_tokens',
        'cache_read_input_tokens',
      ]) ??
      (nestedValue(['cached_tokens', 'prompt_cache_hit_tokens', 'cache_read_input_tokens']) ?? 0),
    inputCacheCreation:
      firstTokenCount(usage, [
        'cache_write_tokens',
        'cache_creation_input_tokens',
        'cache_creation_tokens',
      ]) ??
      (nestedValue([
        'cache_write_tokens',
        'cache_creation_input_tokens',
        'cache_creation_tokens',
      ]) ?? 0),
  };
}
