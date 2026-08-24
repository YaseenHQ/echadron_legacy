import type { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';
import { createHash } from 'node:crypto';

import { basename } from 'pathe';

import { ErrorCodes, Error2 } from '#/errors';

const CREDENTIALS_SCOPE = 'credentials/mcp';

export function sanitizeStoreKey(name: string): string {
  const safe = basename(name)
    .replaceAll(/[^a-zA-Z0-9_-]/g, '_')
    .replaceAll(/_+/g, '_');
  if (safe.length === 0 || safe.startsWith('.')) {
    throw new Error2(ErrorCodes.CONFIG_INVALID, `Invalid MCP OAuth store key: "${name}"`);
  }
  return safe;
}

export function canonicalMcpOAuthResource(serverUrl: string | URL): string {
  const url = new URL(serverUrl);
  url.hash = '';
  return url.toString();
}

export function mcpOAuthStoreKey(serverName: string, serverUrl: string | URL): string {
  const safeName = sanitizeStoreKey(serverName);
  const resource = canonicalMcpOAuthResource(serverUrl);
  const digest = createHash('sha256')
    .update(serverName)
    .update('\0')
    .update(resource)
    .digest('hex')
    .slice(0, 24);
  return `${safeName}-${digest}`;
}

export interface McpOAuthStore {
  read<T>(key: string): Promise<T | undefined>;
  write(key: string, data: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  list(prefix?: string): Promise<readonly string[]>;
}

export function createMcpOAuthStore(docs: IAtomicDocumentStore): McpOAuthStore {
  return {
    list(prefix) {
      return docs.list(CREDENTIALS_SCOPE, prefix);
    },
    async read<T>(key: string): Promise<T | undefined> {
      try {
        return await docs.get<T>(CREDENTIALS_SCOPE, key);
      } catch {
        return undefined;
      }
    },
    write(key, data) {
      return docs.set(CREDENTIALS_SCOPE, key, data);
    },
    remove(key) {
      return docs.delete(CREDENTIALS_SCOPE, key);
    },
  };
}
