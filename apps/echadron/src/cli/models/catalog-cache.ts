/**
 * Echadron's persisted models.dev catalog.
 *
 * This is deliberately separate from provider credentials and config.toml.
 * A refresh only replaces model metadata, so it is safe to run alongside an
 * upstream Kimi Code installation and safe to retry after a partial failure.
 */

import { z } from 'zod';

import { DEFAULT_CATALOG_URL } from '@yaseenhq/echadron-sdk';
import type { Catalog } from '@yaseenhq/echadron-sdk';

import { getModelsDevCacheFile } from '#/utils/paths';
import { readJsonFile, writeJsonFile } from '#/utils/persistence';

export const MODELS_DEV_REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000;
const MODELS_DEV_FETCH_TIMEOUT_MS = 15_000;

export interface ModelsDevCache {
  readonly schemaVersion: 1;
  readonly source: string;
  readonly checkedAt: string;
  readonly etag?: string;
  readonly lastModified?: string;
  readonly catalog: Catalog;
}

export interface ModelsDevRefreshResult {
  readonly status: 'updated' | 'not-modified' | 'cached';
  readonly cache: ModelsDevCache;
}

export interface RefreshModelsDevCatalogOptions {
  readonly url?: string;
  readonly force?: boolean;
  readonly signal?: AbortSignal;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
  readonly userAgent?: string;
  readonly filePath?: string;
}

const ModelsDevCacheSchema: z.ZodType<ModelsDevCache> = z
  .object({
    schemaVersion: z.literal(1),
    source: z.string().min(1),
    checkedAt: z.string().min(1),
    etag: z.string().optional(),
    lastModified: z.string().optional(),
    // The upstream document is untrusted JSON. Keep the cache useful when a
    // provider entry is malformed, but never let malformed nested values
    // reach catalogProviderModels (which expects provider/model objects).
    catalog: z.unknown().transform((value) => normalizeCatalog(value)),
  })
  .strict();

function isCatalog(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeObjectKey(key: string): boolean {
  return key !== '__proto__' && key !== 'constructor' && key !== 'prototype';
}

/**
 * Keep only object-shaped provider/model entries from the external catalog.
 * This is intentionally a structural filter rather than a strict schema:
 * models.dev adds metadata over time, and unknown fields must remain intact.
 */
function normalizeCatalog(value: unknown): Catalog {
  if (!isCatalog(value)) return {} as Catalog;

  const catalog: Record<string, unknown> = {};
  for (const [providerId, rawProvider] of Object.entries(value)) {
    if (!isSafeObjectKey(providerId) || !isCatalog(rawProvider)) continue;

    const provider: Record<string, unknown> = { ...rawProvider };
    const rawModels = rawProvider['models'];
    if (rawModels !== undefined) {
      if (!isCatalog(rawModels)) {
        delete provider['models'];
      } else {
        const models: Record<string, unknown> = {};
        for (const [modelId, rawModel] of Object.entries(rawModels)) {
          if (isSafeObjectKey(modelId) && isCatalog(rawModel)) models[modelId] = rawModel;
        }
        provider['models'] = models;
      }
    }
    catalog[providerId] = provider;
  }
  return catalog as Catalog;
}

/** Read a valid persisted snapshot, ignoring a missing/corrupt cache. */
export async function readModelsDevCache(
  filePath: string = getModelsDevCacheFile(),
): Promise<ModelsDevCache | undefined> {
  try {
    return await readJsonFile(filePath, ModelsDevCacheSchema.optional(), undefined);
  } catch {
    return undefined;
  }
}

/** Return a fresh enough snapshot for catalog browsing, if one exists. */
export async function readFreshModelsDevCatalog(
  options: { readonly filePath?: string; readonly maxAgeMs?: number } = {},
): Promise<Catalog | undefined> {
  const cache = await readModelsDevCache(options.filePath);
  if (cache === undefined) return undefined;
  if (cache.source !== DEFAULT_CATALOG_URL) return undefined;
  const age = Date.now() - Date.parse(cache.checkedAt);
  if (!Number.isFinite(age) || age > (options.maxAgeMs ?? MODELS_DEV_REFRESH_INTERVAL_MS)) {
    return undefined;
  }
  return cache.catalog;
}

/**
 * Refresh models.dev using ETag/Last-Modified validators, preserving the old
 * snapshot on a 304. `force` is used by `echadron update --models`; normal
 * catalog browsing can use the freshness window and avoid network calls.
 */
export async function refreshModelsDevCatalog(
  options: RefreshModelsDevCatalogOptions = {},
): Promise<ModelsDevRefreshResult> {
  const filePath = options.filePath ?? getModelsDevCacheFile();
  const previous = await readModelsDevCache(filePath);
  const now = options.now ?? (() => new Date());
  if (
    options.force !== true &&
    previous !== undefined &&
    Number.isFinite(Date.parse(previous.checkedAt)) &&
    Date.now() - Date.parse(previous.checkedAt) < MODELS_DEV_REFRESH_INTERVAL_MS
  ) {
    return { status: 'cached', cache: previous };
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.userAgent !== undefined) headers['User-Agent'] = options.userAgent;
  if (previous?.etag !== undefined) headers['If-None-Match'] = previous.etag;
  if (previous?.lastModified !== undefined) headers['If-Modified-Since'] = previous.lastModified;

  const response = await (options.fetchImpl ?? fetch)(options.url ?? DEFAULT_CATALOG_URL, {
    headers,
    signal: options.signal ?? AbortSignal.timeout(MODELS_DEV_FETCH_TIMEOUT_MS),
  });
  if (response.status === 304 && previous !== undefined) {
    const cache: ModelsDevCache = {
      ...previous,
      checkedAt: now().toISOString(),
    };
    await writeJsonFile(filePath, ModelsDevCacheSchema, cache);
    return { status: 'not-modified', cache };
  }
  if (!response.ok) {
    throw new Error(`models.dev catalog returned HTTP ${String(response.status)}`);
  }
  const payload: unknown = await response.json();
  if (!isCatalog(payload)) throw new Error('models.dev catalog returned an invalid object.');

  const cache: ModelsDevCache = {
    schemaVersion: 1,
    source: options.url ?? DEFAULT_CATALOG_URL,
    checkedAt: now().toISOString(),
    ...(response.headers.get('etag') === null ? {} : { etag: response.headers.get('etag')! }),
    ...(response.headers.get('last-modified') === null
      ? {}
      : { lastModified: response.headers.get('last-modified')! }),
    catalog: normalizeCatalog(payload),
  };
  await writeJsonFile(filePath, ModelsDevCacheSchema, cache);
  return { status: 'updated', cache };
}
