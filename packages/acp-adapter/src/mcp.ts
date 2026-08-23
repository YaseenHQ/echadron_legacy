/**
 * ACP → kimi MCP server conversion.
 *
 * Translates ACP `McpServer[]` (per the ACP schema discriminated by
 * `type: 'http' | 'sse' | 'acp' | 'stdio'`) into kimi's
 * keyed `Record<string, McpServerConfig>` (the same shape the kernel's
 * `loadMcpServers` returns and what
 * `CreateSessionPayload.mcpServers` / `ResumeSessionPayload.mcpServers`
 * accept). The conversion is intentionally narrow:
 *
 *  - `http`  → kimi `transport: 'http'` with headers projected from
 *              `Array<{name, value}>` to `Record<string, string>`.
 *  - `sse`   → kimi `transport: 'sse'` with headers projected the same way.
 *  - `stdio` → kimi `transport: 'stdio'` with env projected similarly.
 *  - `acp`   → dropped with a `log.warn` (experimental ACP-transport MCP
 *              is not yet supported).
 *
 * The kernel keys MCP servers by name at the config-map level, so the
 * ACP `name` field becomes the Record key here. Duplicate names within a
 * single ACP request collapse with last-write-wins — same behaviour as
 * the kernel's own `loadMcpServers` user/project merge.
 *
 * @see packages/agent-core/src/config/schema.ts (McpServerConfigSchema)
 * @see packages/agent-core/src/mcp/session-config.ts (mergeCallerMcpServers)
 * @see node_modules/@agentclientprotocol/sdk/dist/schema/types.gen.d.ts (McpServer)
 */

import type { McpServer, McpServerStdio } from '@agentclientprotocol/sdk';
import type { McpServerConfig } from '@yaseenhq/agent-core';
import { log } from '@yaseenhq/echadron-sdk';

/**
 * Convert an ACP `McpServer[]` into the kernel-native
 * `Record<string, McpServerConfig>` keyed by server name. Unsupported
 * transports (`acp`) are warn-dropped — the caller never has to
 * filter them out.
 *
 * ACP v1 (0.23) represents stdio without a discriminator, while the ACP v2
 * draft adds `type: 'stdio'`. Both forms are accepted here so hosts can
 * forward either protocol generation through the same kernel boundary.
 */
export function acpMcpServersToConfigs(
  servers: readonly McpServer[] | undefined,
): Record<string, McpServerConfig> {
  if (!servers || servers.length === 0) return {};
  const out: Record<string, McpServerConfig> = {};
  for (const server of servers) {
    const converted = acpMcpServerToConfig(server);
    if (converted !== null) out[converted.name] = converted.config;
  }
  return out;
}

function acpMcpServerToConfig(
  server: McpServer,
): { name: string; config: McpServerConfig } | null {
  // ACP v1 has a bare stdio branch, while ACP v2 explicitly discriminates it
  // as `type: 'stdio'`.
  const transportType = (server as { type?: unknown }).type;
  if (transportType === undefined || transportType === 'stdio') {
    const stdio = server as McpServerStdio;
    const config: McpServerConfig = {
      transport: 'stdio',
      command: stdio.command,
      args: stdio.args,
      env: envArrayToRecord(stdio.env),
    };
    return { name: stdio.name, config };
  }
  switch (transportType) {
    case 'http': {
      const http = server as Extract<McpServer, { type: 'http' }>;
      const config: McpServerConfig = {
        transport: 'http',
        url: http.url,
        headers: headersArrayToRecord(http.headers),
      };
      return { name: http.name, config };
    }
    case 'sse': {
      const sse = server as Extract<McpServer, { type: 'sse' }>;
      const config: McpServerConfig = {
        transport: 'sse',
        url: sse.url,
        headers: headersArrayToRecord(sse.headers),
      };
      return { name: sse.name, config };
    }
    case 'acp':
    default: {
      // Defensive: future ACP transports land here too. The cast is the
      // narrowest way to read `name`/`type` off the leftover variant
      // without re-declaring the union.
      const fallback = server as { name?: string; type?: string };
      log.warn('acp: dropping unsupported MCP server transport', {
        name: fallback.name,
        type: fallback.type,
      });
      return null;
    }
  }
}

function headersArrayToRecord(
  headers: ReadonlyArray<{ readonly name: string; readonly value: string }>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of headers) out[h.name] = h.value;
  return out;
}

function envArrayToRecord(
  env: ReadonlyArray<{ readonly name: string; readonly value: string }>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of env) out[e.name] = e.value;
  return out;
}
