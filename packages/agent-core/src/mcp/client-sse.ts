import type { McpServerSseConfig } from '#/config/schema';
import {
  Client,
  SSEClientTransport,
  type OAuthClientProvider,
} from '@modelcontextprotocol/client';

import {
  buildRequestOptions,
  KIMI_MCP_CLIENT_NAME,
  KIMI_MCP_CLIENT_VERSION,
  toMcpToolDefinition,
  toMcpToolResult,
  type UnexpectedCloseListener,
  type UnexpectedCloseReason,
} from './client-shared';
import { buildMcpRemoteHeaders } from './client-remote';
import type { MCPClient, MCPToolDefinition, MCPToolResult } from './types';

export interface SseMcpClientOptions {
  readonly clientName?: string;
  readonly clientVersion?: string;
  readonly startupTimeoutMs?: number;
  readonly toolCallTimeoutMs?: number;
  /**
   * Reads `process.env[name]` by default. Tests can inject a deterministic
   * lookup function so they do not have to mutate global env.
   */
  readonly envLookup?: (name: string) => string | undefined;
  /**
   * Lets tests inject a fake `fetch` for the underlying transport.
   */
  readonly fetch?: typeof fetch;
  readonly onToolsChanged?: (tools: MCPToolDefinition[]) => void;
  /**
   * OAuth client provider attached to the transport. Set only when the server
   * has no static token configuration; the connection manager wires this in
   * and surfaces `UnauthorizedError` as a `needs-auth` status.
   */
  readonly oauthProvider?: OAuthClientProvider;
}

/**
 * Wraps the SDK's deprecated HTTP+SSE transport as a tsugite
 * {@link MCPClient}. This exists for compatibility with older MCP servers;
 * new remote servers should prefer streamable HTTP.
 */
export class SseMcpClient implements MCPClient {
  private readonly client: Client;
  private readonly transport: SSEClientTransport;
  private readonly startupTimeoutMs?: number;
  private readonly toolCallTimeoutMs?: number;
  private started = false;
  private closed = false;
  // Mirrors HttpMcpClient: handshake failures surface through connect(), while
  // post-ready terminal transport errors become unexpected closes.
  private ready = false;
  private hooksInstalled = false;
  private unexpectedCloseListener: UnexpectedCloseListener | undefined;
  private lastTransportError: Error | undefined;
  private pendingUnexpectedClose: UnexpectedCloseReason | undefined;
  private unexpectedCloseFired = false;

  constructor(config: McpServerSseConfig, options: SseMcpClientOptions = {}) {
    const envLookup = options.envLookup ?? ((name) => process.env[name]);
    const headers = buildMcpRemoteHeaders(config, envLookup);

    this.transport = new SSEClientTransport(new URL(config.url), {
      requestInit: headers !== undefined ? { headers } : undefined,
      fetch: options.fetch,
      authProvider: options.oauthProvider,
    });
    this.client = new Client(
      {
        name: options.clientName ?? KIMI_MCP_CLIENT_NAME,
        version: options.clientVersion ?? KIMI_MCP_CLIENT_VERSION,
      },
      {
        // Prefer stateless MCP 2026 while retaining legacy compatibility.
        versionNegotiation: { mode: 'auto' },
        ...(options.onToolsChanged === undefined
          ? {}
          : {
              listChanged: {
                tools: {
                  onChanged: (error: Error | null, tools?: readonly unknown[] | null) => {
                    if (error !== null || tools === undefined || tools === null) return;
                    options.onToolsChanged?.(
                      tools.map((tool) => toMcpToolDefinition(tool as Parameters<typeof toMcpToolDefinition>[0])),
                    );
                  },
                },
              },
            }),
      },
    );
    this.startupTimeoutMs = options.startupTimeoutMs;
    this.toolCallTimeoutMs = options.toolCallTimeoutMs;
  }

  async connect(): Promise<void> {
    if (this.closed) {
      throw new Error('MCP SSE client is closed');
    }
    if (this.started) return;
    this.started = true;
    this.installTransportHooks();
    try {
      await this.client.connect(
        this.transport,
        buildRequestOptions(this.startupTimeoutMs, undefined),
      );
    } catch (error) {
      await this.closeStartedClient();
      throw error;
    }
    if (this.closed) {
      await this.closeStartedClient();
      throw new Error('MCP SSE client was closed during startup');
    }
    this.ready = true;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.closeStartedClient();
  }

  /**
   * Register a listener for unsolicited terminal transport drops. Brief SSE
   * stream flaps are left to EventSource's retry loop; terminal HTTP status
   * errors after startup remove the tools from the agent.
   */
  onUnexpectedClose(listener: UnexpectedCloseListener): void {
    this.unexpectedCloseListener = listener;
    const pending = this.pendingUnexpectedClose;
    if (pending !== undefined) {
      this.pendingUnexpectedClose = undefined;
      listener(pending);
    }
  }

  async listTools(): Promise<MCPToolDefinition[]> {
    const result = await this.client.listTools(
      undefined,
      buildRequestOptions(this.startupTimeoutMs, undefined),
    );
    return result.tools.map(toMcpToolDefinition);
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<MCPToolResult> {
    const requestOptions = buildRequestOptions(this.toolCallTimeoutMs, signal);
    const result = await this.client.callTool({ name, arguments: args }, requestOptions);
    return toMcpToolResult(result);
  }

  private async closeStartedClient(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    await this.client.close();
  }

  private installTransportHooks(): void {
    if (this.hooksInstalled) return;
    this.hooksInstalled = true;
    this.client.onclose = () => {
      if (this.closed) return;
      if (!this.ready) return;
      this.fireUnexpectedClose({ error: this.lastTransportError });
    };
    this.client.onerror = (error) => {
      this.lastTransportError = error;
      if (this.closed) return;
      if (!this.ready) return;
      if (isTerminalSseTransportError(error)) {
        this.fireUnexpectedClose({ error });
      }
    };
  }

  private fireUnexpectedClose(reason: UnexpectedCloseReason): void {
    if (this.unexpectedCloseFired) return;
    this.unexpectedCloseFired = true;
    const listener = this.unexpectedCloseListener;
    if (listener !== undefined) {
      listener(reason);
    } else {
      this.pendingUnexpectedClose = reason;
    }
  }
}

export function isTerminalSseTransportError(error: Error): boolean {
  if (error.name === 'UnauthorizedError') return true;
  // Keep this structural so a v1 SDK error produced by a legacy test/server
  // is still recognized after the runtime client moves to the v2 SDK. Both
  // SDK lines expose the HTTP status as a numeric `code`.
  return typeof (error as Error & { readonly code?: unknown }).code === 'number';
}
