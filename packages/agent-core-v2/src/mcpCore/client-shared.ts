import { getCoreVersion } from '#/_base/version';
import {
  ProtocolError,
  SdkError,
  SdkErrorCode,
} from '@modelcontextprotocol/client';

import type { MCPClient, MCPToolDefinition, MCPToolResult } from './types';

export const KIMI_MCP_CLIENT_NAME = 'kimi-code';
export const KIMI_MCP_CLIENT_VERSION = getCoreVersion();

export interface UnexpectedCloseReason {
  readonly error?: Error;
  readonly stderr?: string;
}

export type UnexpectedCloseListener = (reason: UnexpectedCloseReason) => void;

export function isMcpConnectionClosedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { readonly code?: unknown }).code;
  // The numeric branch keeps injected/test clients built against the v1 SDK
  // compatible while all runtime errors now come from the v2 SDK.
  return code === SdkErrorCode.ConnectionClosed || code === -32000;
}

export function isMcpTransportFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (isMcpConnectionClosedError(error)) return true;
  const code = (error as Error & { readonly code?: unknown }).code;
  // JSON-RPC/MCP errors prove that bytes made a round trip. ProtocolError is
  // brand-matched by the v2 SDK, while the numeric fallback covers v1 test
  // doubles and servers that construct a plain Error with a wire code.
  if (error instanceof ProtocolError || (typeof code === 'number' && code <= -32000)) {
    return false;
  }
  return true;
}

/**
 * Timeout for the liveness probe sent after an ambiguous tool-call failure.
 * Kept short: the probe runs on an already-failed call, so it must not add
 * anywhere near a tool-call timeout to the turn.
 */
export const MCP_LIVENESS_PROBE_TIMEOUT_MS = 5_000;

/**
 * True when the error is a client-side validation failure of an otherwise
 * well-formed JSON-RPC response: the SDK rejects with a `ZodError` when the
 * result of `tools/call` does not match `CallToolResultSchema`
 * (shared/protocol.js rejects with `parseResult.error`). The server did
 * answer, so reconnecting is pointless — but the error is not a
 * `ProtocolError`,
 * so `isMcpTransportFailure` alone cannot tell it apart from a dead
 * transport. Matched by name because the repo carries more than one zod
 * copy, which makes `instanceof` unreliable.
 */
export function isMcpMalformedResultError(error: unknown): boolean {
  return error instanceof Error && error.name === 'ZodError';
}

/**
 * Probes whether the client's transport is still usable with a read-only
 * `tools/list` request. MCP 2026-07-28 removed the protocol-level `ping`
 * method, so using a required request keeps the probe compatible with both
 * modern stateless servers and older implementations. A server that answers
 * in any way — including a JSON-RPC error or an unparseable result — counts
 * as alive; only errors that prove the bytes never made a round trip (closed
 * connection, fetch failures) or a probe that itself timed out count as dead.
 * Never rejects; an abort surfaces as a dead verdict and is the caller's job
 * to detect via the signal.
 */
export async function probeMcpLiveness(client: MCPClient, signal: AbortSignal): Promise<boolean> {
  const probeSignal = AbortSignal.any([signal, AbortSignal.timeout(MCP_LIVENESS_PROBE_TIMEOUT_MS)]);
  try {
    await client.listTools(probeSignal);
    return true;
  } catch (error) {
    if (isMcpConnectionClosedError(error)) return false;
    if (isMcpMalformedResultError(error)) return true;
    if (error instanceof ProtocolError) {
      return true;
    }
    if (error instanceof SdkError) {
      return ![
        SdkErrorCode.RequestTimeout,
        SdkErrorCode.SendFailed,
        SdkErrorCode.NotConnected,
      ].includes(error.code);
    }
    // Keep old injected clients useful while they migrate from the v1 SDK.
    if (typeof (error as Error & { readonly code?: unknown }).code === 'number') {
      return (error as Error & { readonly code?: unknown }).code !== -32001;
    }
    return false;
  }
}

export interface McpRequestOptions {
  readonly timeout?: number;
  readonly signal?: AbortSignal;
}

export function buildRequestOptions(
  timeoutMs: number | undefined,
  signal: AbortSignal | undefined,
): McpRequestOptions | undefined {
  if (timeoutMs === undefined && signal === undefined) return undefined;
  return { timeout: timeoutMs, signal };
}

interface SdkListedTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: Record<string, unknown>;
}

export function toMcpToolDefinition(tool: SdkListedTool): MCPToolDefinition {
  return {
    name: tool.name,
    description: tool.description ?? '',
    inputSchema: tool.inputSchema,
  };
}

export function toMcpToolResult(result: unknown): MCPToolResult {
  if (typeof result === 'object' && result !== null && 'content' in result) {
    const typed = result as {
      content: unknown;
      isError?: unknown;
      structuredContent?: unknown;
      _meta?: unknown;
    };
    if (Array.isArray(typed.content)) {
      return {
        content: typed.content as MCPToolResult['content'],
        isError: typed.isError === true,
        structuredContent: typed.structuredContent,
        _meta:
          typeof typed._meta === 'object' && typed._meta !== null
            ? (typed._meta as Record<string, unknown>)
            : undefined,
      };
    }
  }
  if (typeof result === 'object' && result !== null && 'toolResult' in result) {
    const legacy = (result as { toolResult: unknown }).toolResult;
    return {
      content: [
        {
          type: 'text',
          text: typeof legacy === 'string' ? legacy : JSON.stringify(legacy),
        },
      ],
      isError: false,
    };
  }
  return { content: [], isError: false };
}
