/**
 * `tsugite/provider` domain (L2) — shared OpenAI-family wire mechanics.
 *
 * Everything the Chat Completions and Responses bases share: content-part and
 * tool conversion, usage extraction, finish-reason normalization, the
 * capability constants, and the error converter.
 *
 * `convertOpenAIError`'s FIRST line is the contract's `throwIfAbortError`
 * guard: a user cancellation (SDK `APIUserAbortError`, bare `AbortError`, the
 * standard abort DOMException) is THROWN as the standard abort shape at the
 * very front of the classification chain — it can never be converted into,
 * nor returned as, a retryable provider error. After the guard,
 * already-converted `ChatProviderError`s pass through untouched; only then is
 * the optional trait-composed `convertError` hook consulted, so a vendor
 * classifies each RAW wire failure (e.g. quota 429s) exactly once before the
 * base rules run. The base itself classifies only OpenAI's own documented
 * `insufficient_quota` code as a non-retryable quota exhaustion —
 * vendor-specific quota signals belong on the vendor's trait.
 */

import {
  APIConnectionError as OpenAIConnectionError,
  APIConnectionTimeoutError as OpenAITimeoutError,
  APIError as OpenAIAPIError,
  OpenAIError,
} from 'openai';

import {
  APIConnectionError,
  APIProviderQuotaExhaustedError,
  APITimeoutError,
  ChatProviderError,
  classifyBaseApiError,
  normalizeAPIStatusError,
  parseRetryAfterMs,
  parseTraceId,
  throwIfAbortError,
} from '#/tsugite/contract/errors';
import { extractText } from '#/tsugite/contract/message';
import type { ContentPart, Message } from '#/tsugite/contract/message';
import type { FinishReason } from '#/tsugite/contract/provider';
import type { Tool } from '#/tsugite/contract/tool';
import type { TokenUsage } from '#/tsugite/contract/usage';

import { extractPromptCacheTokens, nonNegativeTokenCount } from '../prompt-cache';

export interface OpenAIContentPart {
  type: string;
  text?: string | undefined;
  image_url?: { url: string; id?: string | null } | undefined;
  audio_url?: { url: string; id?: string | null } | undefined;
  video_url?: { url: string; id?: string | null } | undefined;
}

export function convertContentPart(part: ContentPart): OpenAIContentPart | null {
  switch (part.type) {
    case 'text':
      return { type: 'text', text: part.text };
    case 'think':
      return null;
    case 'image_url':
      return {
        type: 'image_url',
        image_url:
          part.imageUrl.id === undefined
            ? { url: part.imageUrl.url }
            : { url: part.imageUrl.url, id: part.imageUrl.id },
      };
    case 'audio_url':
      return {
        type: 'audio_url',
        audio_url:
          part.audioUrl.id === undefined
            ? { url: part.audioUrl.url }
            : { url: part.audioUrl.url, id: part.audioUrl.id },
      };
    case 'video_url':
      return {
        type: 'video_url',
        video_url:
          part.videoUrl.id === undefined
            ? { url: part.videoUrl.url }
            : { url: part.videoUrl.url, id: part.videoUrl.id },
      };
    case 'openai_compaction':
      // Only the Responses API understands this opaque item.
      return null;
    default:
      throw new Error(`Unknown content part type: ${(part as ContentPart).type}`);
  }
}

export type OpenAIToolParam = {
  type: string;
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export function toolToOpenAI(tool: Tool): OpenAIToolParam {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

export function isOpenAIInsufficientQuotaCode(code: string | null | undefined): boolean {
  return code === 'insufficient_quota';
}

function isOpenAIInsufficientQuotaError(error: OpenAIAPIError): boolean {
  if (error.status !== 429) return false;
  if (typeof error.code === 'string' && isOpenAIInsufficientQuotaCode(error.code)) return true;
  if (typeof error.type === 'string' && isOpenAIInsufficientQuotaCode(error.type)) return true;
  return error.message.toLowerCase().includes('insufficient_quota');
}

export function convertOpenAIError(
  error: unknown,
  convertErrorHook?: (error: unknown) => ChatProviderError | undefined,
): ChatProviderError {
  // Abort guard FIRST: throws (never returns) the standard abort DOMException
  // for any abort shape, so a user cancellation is never misclassified as a
  // retryable provider failure.
  throwIfAbortError(error);
  if (error instanceof ChatProviderError) {
    return error;
  }
  const hooked = convertErrorHook?.(error);
  if (hooked !== undefined) {
    return hooked;
  }
  if (error instanceof OpenAITimeoutError) {
    return new APITimeoutError(error.message);
  }
  if (error instanceof OpenAIConnectionError) {
    return new APIConnectionError(error.message);
  }
  if (error instanceof OpenAIAPIError && typeof error.status === 'number') {
    const reqId = error.requestID ?? null;
    const retryAfterMs = parseRetryAfterMs(error.headers);
    const traceId = parseTraceId(error.headers);
    if (isOpenAIInsufficientQuotaError(error)) {
      return new APIProviderQuotaExhaustedError(error.message, reqId, retryAfterMs, traceId);
    }
    return normalizeAPIStatusError(error.status, error.message, reqId, retryAfterMs, traceId);
  }
  if (
    error instanceof OpenAIAPIError &&
    error.constructor === OpenAIAPIError &&
    error.error === undefined
  ) {
    return classifyBaseApiError(error.message);
  }
  if (error instanceof OpenAIError) {
    return new ChatProviderError(`Error: ${error.message}`);
  }
  if (error instanceof Error) {
    return classifyBaseApiError(error.message);
  }
  return new ChatProviderError(`Error: ${String(error)}`);
}

export interface FunctionToolCallShape {
  type: 'function';
  id: string;
  function: { name: string; arguments: string | null };
}

export function isFunctionToolCall<T extends { type: string }>(
  tc: T,
): tc is T & FunctionToolCallShape {
  return tc.type === 'function';
}

export function extractUsage(usage: unknown): TokenUsage | null {
  if (usage === null || usage === undefined || typeof usage !== 'object') {
    return null;
  }
  const u = usage as Record<string, unknown>;
  const promptTokens = nonNegativeTokenCount(u['prompt_tokens']);
  const completionTokens = nonNegativeTokenCount(u['completion_tokens']);
  const { inputCacheRead, inputCacheCreation } = extractPromptCacheTokens(u);

  return {
    inputOther: Math.max(0, promptTokens - inputCacheRead - inputCacheCreation),
    output: completionTokens,
    inputCacheRead,
    inputCacheCreation,
  };
}

export function normalizeOpenAIFinishReason(raw: string | null | undefined): {
  finishReason: FinishReason | null;
  rawFinishReason: string | null;
} {
  if (raw === null || raw === undefined) {
    return { finishReason: null, rawFinishReason: null };
  }
  switch (raw) {
    case 'stop':
      return { finishReason: 'completed', rawFinishReason: raw };
    case 'tool_calls':
    case 'function_call':
      return { finishReason: 'tool_calls', rawFinishReason: raw };
    case 'length':
      return { finishReason: 'truncated', rawFinishReason: raw };
    case 'content_filter':
      return { finishReason: 'filtered', rawFinishReason: raw };
    default:
      return { finishReason: 'other', rawFinishReason: raw };
  }
}

export type ToolMessageConversion = 'extract_text' | null;

export const TOOL_RESULT_MEDIA_PROMPT = 'Attached media from tool result:';
export const TOOL_RESULT_MEDIA_PLACEHOLDER = '(see attached media)';

export function isMediaPart(part: ContentPart): boolean {
  return part.type !== 'text' && part.type !== 'think';
}

export function convertToolMessageContent(
  message: Message,
  conversion: ToolMessageConversion,
): string | OpenAIContentPart[] {
  if (conversion === 'extract_text') {
    return extractText(message);
  }
  return message.content
    .map((p) => convertContentPart(p))
    .filter((p): p is OpenAIContentPart => p !== null);
}

// ---------------------------------------------------------------------------
// Capability constants shared by the OpenAI-family base catalogs.
// ---------------------------------------------------------------------------

export const OPENAI_REASONING_CAPABILITY = Object.freeze({
  image_in: false,
  video_in: false,
  audio_in: false,
  thinking: true,
  tool_use: true,
  max_context_tokens: 0,
});

export const OPENAI_VISION_TOOL_CAPABILITY = Object.freeze({
  image_in: true,
  video_in: false,
  audio_in: false,
  thinking: false,
  tool_use: true,
  max_context_tokens: 0,
});

export const OPENAI_TEXT_TOOL_CAPABILITY = Object.freeze({
  image_in: false,
  video_in: false,
  audio_in: false,
  thinking: false,
  tool_use: true,
  max_context_tokens: 0,
});

export const OPENAI_VISION_TOOL_PREFIXES = ['gpt-4o', 'gpt-4-turbo', 'gpt-4.1', 'gpt-4.5'] as const;

export function isOpenAIReasoningModel(normalizedModelName: string): boolean {
  return /^o\d/.test(normalizedModelName);
}

export function hasModelPrefix(modelName: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => modelName.startsWith(prefix));
}
