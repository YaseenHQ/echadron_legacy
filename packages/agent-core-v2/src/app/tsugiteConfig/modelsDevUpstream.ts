/**
 * `tsugiteConfig` domain (L3) — models.dev upstream: fetch the third-party
 * directory, in-memory cache, built-in snapshot fallback, and the pruned
 * item mapping behind `IModelsDevImportService`'s browse methods.
 *
 * The normalization decisions (wire resolution, base-URL adaptation, model
 * pruning) all come from the sibling `modelsDev` module, the same functions
 * the TUI/CLI import paths use (via the tsugite copy), so a GUI import stays
 * behavior-identical to a CLI import. The config write itself is
 * orchestrated by the import service through `IConfigService` sections
 * (never the node-sdk's `applyCatalogProvider`, which would also move the
 * global default pointers).
 */

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { Error2 } from '#/_base/errors/errors';
import type { ModelCapability } from '#/tsugite/contract/capability';
import type { ModelRecord } from '#/tsugite/model/model';

import { BUILT_IN_MODELS_DEV_JSON } from './builtInModelsDev';
import { ModelsDevImportErrors } from './errors';
import {
  modelsDevProviderModels,
  normalizeModelsDevCatalog,
  resolveModelsDevImport,
  type ModelsDevCatalog,
  type ModelsDevModel,
  type ModelsDevProviderEntry,
} from './modelsDev';
import type { ModelsDevModelItem, ModelsDevProviderItem } from './modelsDevImport';

export const MODELS_DEV_URL = 'https://models.dev/api.json';
/** Keep the in-process browser aligned with Echadron's persisted catalog window. */
export const MODELS_DEV_CACHE_TTL_MS = 4 * 60 * 60 * 1000;
/** Shared upstream timeout for both the models.dev and registry fetches. */
export const UPSTREAM_FETCH_TIMEOUT_MS = 10_000;

/** Parses a built-in directory snapshot string; undefined when missing/invalid. */
export function loadBuiltInModelsDevCatalog(text?: string): ModelsDevCatalog | undefined {
  if (typeof text !== 'string' || text.length === 0) return undefined;
  try {
    return normalizeModelsDevCatalog(JSON.parse(text));
  } catch {
    return undefined;
  }
}

interface ModelsDevCacheEntry {
  readonly catalog: ModelsDevCatalog;
  readonly fetchedAt: number;
  readonly etag?: string;
  readonly lastModified?: string;
}

let cache: ModelsDevCacheEntry | undefined;
let inFlight: Promise<ModelsDevCatalog> | undefined;
let builtInMemo: ModelsDevCatalog | undefined | null = null;
let fetchImpl: typeof fetch = fetch;
let nowImpl: () => number = Date.now;
let persistedSeed: Promise<void> | undefined;
let cacheHomeDir: string | undefined;

/**
 * Test hook: swap the fetch/clock used by `getModelsDevCatalog`. The cache is
 * kept, so TTL behavior can be exercised by advancing the injected clock;
 * pair with `resetModelsDevUpstreamForTest` in test setup/teardown for
 * isolation.
 */
export function setModelsDevUpstreamForTest(options: {
  fetchImpl?: typeof fetch;
  now?: () => number;
}): void {
  if (options.fetchImpl !== undefined) fetchImpl = options.fetchImpl;
  if (options.now !== undefined) nowImpl = options.now;
}

/** Test hook: drop the cache and restore the real fetch/clock. */
export function resetModelsDevUpstreamForTest(): void {
  cache = undefined;
  inFlight = undefined;
  builtInMemo = null;
  fetchImpl = fetch;
  nowImpl = Date.now;
  persistedSeed = undefined;
  cacheHomeDir = undefined;
}

/** The currently injected fetch — shared by the models.dev and registry upstreams. */
export function upstreamFetch(): typeof fetch {
  return fetchImpl;
}

/**
 * Returns the models.dev directory: fresh cache hit → one shared network
 * fetch (concurrent misses join the same in-flight promise; cached on
 * success) → stale cache on fetch failure → built-in snapshot → throws
 * `modelsDev.catalog_unavailable`. `homeDir` is supplied by the bootstrap
 * service so the v2 server reads the same Echadron cache that
 * `update --models` writes; the environment fallback remains for standalone
 * SDK consumers.
 */
export async function getModelsDevCatalog(homeDir?: string): Promise<ModelsDevCatalog> {
  if (cacheHomeDir !== homeDir) {
    cache = undefined;
    inFlight = undefined;
    persistedSeed = undefined;
    cacheHomeDir = homeDir;
  }
  persistedSeed ??= readPersistedCache(homeDir).then((persisted) => {
    cache ??= persisted;
  });
  await persistedSeed;
  const now = nowImpl();
  if (cache !== undefined && now - cache.fetchedAt < MODELS_DEV_CACHE_TTL_MS) return cache.catalog;
  inFlight ??= fetchAndCache(homeDir).finally(() => {
    inFlight = undefined;
  });
  return inFlight;
}

async function fetchAndCache(homeDir?: string): Promise<ModelsDevCatalog> {
  const now = nowImpl();
  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'echadron-kap-server',
    };
    if (cache?.etag !== undefined) headers['If-None-Match'] = cache.etag;
    if (cache?.lastModified !== undefined) headers['If-Modified-Since'] = cache.lastModified;
    const res = await fetchImpl(MODELS_DEV_URL, {
      headers,
      signal: AbortSignal.timeout(UPSTREAM_FETCH_TIMEOUT_MS),
    });
    if (res.status === 304 && cache !== undefined) {
      cache = { ...cache, fetchedAt: now };
      await writePersistedCache(cache, homeDir);
      return cache.catalog;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload: unknown = await res.json();
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new Error('unexpected catalog payload shape');
    }
    cache = {
      catalog: normalizeModelsDevCatalog(payload),
      fetchedAt: now,
      ...(res.headers.get('etag') === null ? {} : { etag: res.headers.get('etag')! }),
      ...(res.headers.get('last-modified') === null
        ? {}
        : { lastModified: res.headers.get('last-modified')! }),
    };
    await writePersistedCache(cache, homeDir);
    return cache.catalog;
  } catch (error) {
    if (cache !== undefined) return cache.catalog;
    const builtIn = builtInCatalog();
    if (builtIn !== undefined) {
      // Cache the snapshot too — an offline install would otherwise pay the
      // full upstream timeout on every directory call before falling back.
      cache = { catalog: builtIn, fetchedAt: now };
      return builtIn;
    }
    throw new Error2(
      ModelsDevImportErrors.codes.CATALOG_UNAVAILABLE,
      `models.dev catalog unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Seed the core browser from the host's persisted `update --models` snapshot.
 * Composition roots pass their home explicitly; the Echadron home variables
 * are the primary fallback, with the historical names retained only for
 * migration.
 */
async function readPersistedCache(homeDir?: string): Promise<ModelsDevCacheEntry | undefined> {
  const home =
    homeDir ??
    process.env['ECHADRON_HOME'] ??
    process.env['ECHADRON_CODE_HOME'] ??
    process.env['IMPERIUM_HOME'] ??
    process.env['KIMI_CODE_HOME'];
  if (home === undefined || home.length === 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(
      await readFile(join(home, 'cache', 'models.dev.json'), 'utf8'),
    );
    if (!isPersistedCache(parsed)) return undefined;
    return {
      catalog: normalizeModelsDevCatalog(parsed.catalog),
      fetchedAt: Date.parse(parsed.checkedAt),
      ...(parsed.etag === undefined ? {} : { etag: parsed.etag }),
      ...(parsed.lastModified === undefined ? {} : { lastModified: parsed.lastModified }),
    };
  } catch {
    return undefined;
  }
}

async function writePersistedCache(entry: ModelsDevCacheEntry, homeDir?: string): Promise<void> {
  const home =
    homeDir ??
    process.env['ECHADRON_HOME'] ??
    process.env['ECHADRON_CODE_HOME'] ??
    process.env['IMPERIUM_HOME'] ??
    process.env['KIMI_CODE_HOME'];
  if (home === undefined || home.length === 0) return;
  let tempPath: string | undefined;
  try {
    const filePath = join(home, 'cache', 'models.dev.json');
    await mkdir(dirname(filePath), { recursive: true });
    tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(
      tempPath,
      `${JSON.stringify({
        schemaVersion: 1,
        source: MODELS_DEV_URL,
        checkedAt: new Date(entry.fetchedAt).toISOString(),
        ...(entry.etag === undefined ? {} : { etag: entry.etag }),
        ...(entry.lastModified === undefined ? {} : { lastModified: entry.lastModified }),
        catalog: entry.catalog,
      })}\n`,
      'utf8',
    );
    await rename(tempPath, filePath);
  } catch {
    // A read-only or unwritable cache must never make model discovery fail.
    if (tempPath !== undefined) await unlink(tempPath).catch(() => {});
  }
}

function isPersistedCache(value: unknown): value is {
  readonly source: typeof MODELS_DEV_URL;
  readonly checkedAt: string;
  readonly catalog: ModelsDevCatalog;
  readonly etag?: string;
  readonly lastModified?: string;
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record['source'] === MODELS_DEV_URL &&
    typeof record['checkedAt'] === 'string' &&
    Number.isFinite(Date.parse(record['checkedAt'])) &&
    typeof record['catalog'] === 'object' &&
    record['catalog'] !== null &&
    !Array.isArray(record['catalog']) &&
    (record['etag'] === undefined || typeof record['etag'] === 'string') &&
    (record['lastModified'] === undefined || typeof record['lastModified'] === 'string')
  );
}

/** The built-in snapshot, parsed at most once per process (it can be MBs). */
function builtInCatalog(): ModelsDevCatalog | undefined {
  if (builtInMemo === null) builtInMemo = loadBuiltInModelsDevCatalog(BUILT_IN_MODELS_DEV_JSON);
  return builtInMemo;
}

/** Own-property lookup — a parsed directory still carries the Object prototype
 *  chain, so `catalog['constructor']` must not masquerade as a real entry. */
export function modelsDevEntry(
  catalog: ModelsDevCatalog,
  id: string,
): ModelsDevProviderEntry | undefined {
  return Object.prototype.hasOwnProperty.call(catalog, id) ? catalog[id] : undefined;
}

// ---------------------------------------------------------------------------
// Pruned item mapping (the browse wire shape)
// ---------------------------------------------------------------------------

function capabilityToStrings(capability: ModelCapability): string[] | undefined {
  const caps: string[] = [];
  if (capability.image_in) caps.push('image_in');
  if (capability.video_in) caps.push('video_in');
  if (capability.audio_in) caps.push('audio_in');
  if (capability.thinking) caps.push('thinking');
  if (capability.tool_use) caps.push('tool_use');
  if (capability.dynamically_loaded_tools === true) caps.push('dynamically_loaded_tools');
  return caps.length > 0 ? caps : undefined;
}

function toModelItem(model: ModelsDevModel): ModelsDevModelItem {
  const caps = capabilityToStrings(model.capability);
  return {
    ...(model.name !== undefined ? { name: model.name } : {}),
    ...(caps !== undefined ? { capabilities: caps } : {}),
    id: model.id,
    max_context_size: model.capability.max_context_tokens,
    reasoning: model.capability.thinking,
    ...(model.supportEfforts === undefined ? {} : { support_efforts: [...model.supportEfforts] }),
    ...(model.thinkingBudget?.min === undefined
      ? {}
      : { thinking_budget_min: model.thinkingBudget.min }),
    ...(model.thinkingBudget?.max === undefined
      ? {}
      : { thinking_budget_max: model.thinkingBudget.max }),
    ...(model.defaultEffort === undefined ? {} : { default_effort: model.defaultEffort }),
    ...(model.offEffort === undefined ? {} : { off_effort: model.offEffort }),
    ...(model.alwaysThinking === undefined ? {} : { always_thinking: model.alwaysThinking }),
    ...(model.mode === undefined ? {} : { request_mode: model.mode }),
  };
}

/** Maps one directory entry to its pruned browse item, resolving import eligibility. */
export function toModelsDevProviderItem(
  id: string,
  entry: ModelsDevProviderEntry,
): ModelsDevProviderItem {
  const resolution = resolveModelsDevImport(entry);
  const models = modelsDevProviderModels(entry).map(toModelItem);
  const base = {
    id,
    // An empty-string upstream name is as useless as a missing one — fall back.
    name: entry.name || id,
    env_key: entry.env?.[0] ?? null,
    models,
  };
  switch (resolution.kind) {
    case 'ok':
      return {
        ...base,
        wire_type: resolution.wire,
        guessed: resolution.guessed,
        needs_base_url: false,
        rejected: false,
        reject_reason: null,
      };
    case 'needs-base-url':
      return {
        ...base,
        wire_type: resolution.wire,
        guessed: resolution.guessed,
        needs_base_url: true,
        rejected: false,
        reject_reason: null,
      };
    case 'invalid':
      return {
        ...base,
        wire_type: null,
        guessed: false,
        needs_base_url: false,
        rejected: true,
        reject_reason: resolution.reason,
      };
  }
  // Unreachable in practice: ModelsDevImportResolution is a closed three-way
  // union, but older TS control-flow cannot prove the switch exhaustive.
  throw new Error(`unhandled models.dev import resolution: ${JSON.stringify(resolution)}`);
}

// ---------------------------------------------------------------------------
// Config record mapping (used by the models.dev import)
// ---------------------------------------------------------------------------

/**
 * Builds the persisted model alias record for an imported models.dev model —
 * the same field set as the node-sdk's `catalogModelToAlias`, so a
 * GUI-imported provider is indistinguishable from a TUI-imported one.
 */
export function modelsDevModelToRecord(providerId: string, model: ModelsDevModel): ModelRecord {
  const caps = capabilityToStrings(model.capability);
  // A model that always reasons advertises `always_thinking` instead of
  // `thinking`, so the UI locks thinking on and offers no off option.
  const capabilities =
    model.alwaysThinking === true
      ? caps?.map((cap) => (cap === 'thinking' ? 'always_thinking' : cap))
      : caps;
  const record: ModelRecord = {
    provider: providerId,
    model: model.wireModel ?? model.id,
    maxContextSize: model.capability.max_context_tokens,
  };
  if (model.capability.max_input_tokens !== undefined) {
    record.maxInputSize = model.capability.max_input_tokens;
  }
  if (model.maxOutputSize !== undefined) record.maxOutputSize = model.maxOutputSize;
  if (capabilities !== undefined) record.capabilities = capabilities;
  if (model.name !== undefined) record.displayName = model.name;
  if (model.reasoningKey !== undefined) record.reasoningKey = model.reasoningKey;
  if (model.supportEfforts !== undefined) record.supportEfforts = [...model.supportEfforts];
  if (model.thinkingBudget?.min !== undefined) {
    record.thinkingBudgetMin = model.thinkingBudget.min;
  }
  if (model.thinkingBudget?.max !== undefined) {
    record.thinkingBudgetMax = model.thinkingBudget.max;
  }
  if (model.defaultEffort !== undefined) record.defaultEffort = model.defaultEffort;
  if (model.offEffort !== undefined) record.offEffort = model.offEffort;
  if (model.requestHeaders !== undefined) record.requestHeaders = { ...model.requestHeaders };
  if (model.requestBody !== undefined) record.requestBody = { ...model.requestBody };
  if (model.protocol !== undefined) record.protocol = model.protocol;
  if (model.baseUrl !== undefined) record.baseUrl = model.baseUrl;
  return record;
}
