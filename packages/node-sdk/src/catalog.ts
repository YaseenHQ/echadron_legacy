import type { KimiConfig, ModelAlias } from '@yaseenhq/agent-core';
import {
  catalogBaseUrl,
  catalogProviderModels,
  inferWireType,
  normalizeCatalog,
  resolveCatalogImport,
  type Catalog,
  type CatalogImportInvalidReason,
  type CatalogImportResolution,
  type CatalogModel,
  type CatalogProviderEntry,
  type ModelCapability,
  type ProviderType,
} from '@yaseenhq/tsugite';
import { XAI_PROVIDER_NAME, xaiWireTypeForModel } from '@yaseenhq/echadron-oauth';

export { catalogBaseUrl, catalogProviderModels, inferWireType, resolveCatalogImport };
export type { CatalogImportInvalidReason, CatalogImportResolution };
export type { Catalog, CatalogModel, CatalogProviderEntry };

export const DEFAULT_CATALOG_URL = 'https://models.dev/api.json';

export class CatalogFetchError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface FetchCatalogOptions {
  readonly signal?: AbortSignal;
  readonly fetchImpl?: typeof fetch;
  readonly userAgent?: string;
}

/**
 * Fetches a models.dev-style catalog. Public endpoint, no credentials needed.
 * `userAgent` identifies the host product (e.g. `kimi-code-cli/1.2.3`); when
 * omitted the request falls back to the runtime default (`User-Agent: node`).
 */
export async function fetchCatalog(
  url: string,
  options: FetchCatalogOptions = {},
): Promise<Catalog> {
  const { signal, fetchImpl = fetch, userAgent } = options;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (userAgent !== undefined) headers['User-Agent'] = userAgent;
  const res = await fetchImpl(url, { headers, signal });
  if (!res.ok) {
    throw new CatalogFetchError(`Failed to fetch catalog (HTTP ${res.status}).`, res.status);
  }
  const payload: unknown = await res.json();
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error(`Unexpected catalog response from ${url}.`);
  }
  return normalizeCatalog(payload);
}

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

/** Merge the latest xAI models.dev entries into an existing alias table. */
export function mergeXaiCatalogModels(
  models: Record<string, ModelAlias>,
  catalog: Catalog,
): Record<string, ModelAlias> {
  const entry = catalog[XAI_PROVIDER_NAME];
  if (entry === undefined) return models;
  const next = { ...models };
  for (const model of catalogProviderModels(entry)) {
    const alias = catalogModelToAlias(XAI_PROVIDER_NAME, model);
    if (xaiWireTypeForModel(model.id) === 'openai_responses') {
      alias.wire = 'openai_responses';
    }
    next[`${XAI_PROVIDER_NAME}/${model.id}`] = alias;
  }
  return next;
}

export function xaiCatalogModelCount(catalog: Catalog): number {
  const entry = catalog[XAI_PROVIDER_NAME];
  return entry === undefined ? 0 : catalogProviderModels(entry).length;
}

/** Builds a kimi-code model alias from a normalized catalog model. */
export function catalogModelToAlias(providerId: string, model: CatalogModel): ModelAlias {
  const caps = capabilityToStrings(model.capability);
  return {
    provider: providerId,
    model: model.wireModel ?? model.id,
    maxContextSize: model.capability.max_context_tokens,
    maxInputSize: model.capability.max_input_tokens,
    maxOutputSize: model.maxOutputSize,
    // A model that always reasons advertises `always_thinking` instead of
    // `thinking`, so the UI locks thinking on and offers no off option.
    capabilities:
      model.alwaysThinking === true
        ? caps?.map((cap) => (cap === 'thinking' ? 'always_thinking' : cap))
        : caps,
    displayName: model.name,
    reasoningKey: model.reasoningKey,
    supportEfforts: model.supportEfforts === undefined ? undefined : [...model.supportEfforts],
    thinkingBudgetMin: model.thinkingBudget?.min,
    thinkingBudgetMax: model.thinkingBudget?.max,
    defaultEffort: model.defaultEffort,
    offEffort: model.offEffort,
    ...(model.requestHeaders === undefined ? {} : { requestHeaders: { ...model.requestHeaders } }),
    ...(model.requestBody === undefined ? {} : { requestBody: { ...model.requestBody } }),
    protocol: model.protocol,
    baseUrl: model.baseUrl,
  };
}

export interface ApplyCatalogProviderOptions {
  readonly providerId: string;
  readonly wire: ProviderType;
  readonly baseUrl?: string;
  readonly apiKey: string;
  readonly models: readonly CatalogModel[];
  readonly selectedModelId: string;
  /**
   * Provenance for an imported catalog provider. Kept on the provider rather
   * than inferred from its wire type so a later catalog refresh can reconcile
   * aliases without losing the original adapter or endpoint.
   */
  readonly source?: CatalogProviderSource;
  /** Optional legacy global toggle. Omit it to preserve model-level defaults. */
  readonly thinking?: boolean;
}

export interface CatalogProviderSource {
  readonly kind: 'modelsDev';
  /** URL of the models.dev-shaped catalog document. */
  readonly url: string;
  /** Provider id in that document; may differ from the local provider id. */
  readonly catalogId: string;
  /** AI SDK adapter declared by the catalog, when present. */
  readonly npm?: string;
  /** Endpoint declared by the catalog, before any local override. */
  readonly api?: string;
  /** Effective endpoint used for this import when one was resolved. */
  readonly baseUrl?: string;
}

/**
 * Parses an optional pruned models.dev catalog string — typically the
 * `__KIMI_CODE_BUILT_IN_CATALOG__` constant injected by tsdown at build
 * time. Returns `undefined` when the argument is missing or invalid.
 */
export function loadBuiltInCatalog(text?: string): Catalog | undefined {
  if (typeof text !== 'string' || text.length === 0) return undefined;
  try {
    return normalizeCatalog(JSON.parse(text));
  } catch {
    return undefined;
  }
}

/**
 * Writes a catalog-selected provider and its model aliases into `config` and
 * marks it the default. Model metadata (context, output limit, capabilities)
 * comes from the catalog, so the user does not hand-write it. Returns the
 * default model key.
 *
 * NOTE: the same-provider cleanup below mutates the passed-in `config` only.
 * It clears stale aliases on disk solely when the caller overwrites the whole
 * config. Callers persisting via `setConfig` — a deep-merge patch that cannot
 * delete keys — must call `removeProvider` first, or removed aliases reappear
 * after the merge.
 */
export function applyCatalogProvider(
  config: KimiConfig,
  options: ApplyCatalogProviderOptions,
): { defaultModel: string } {
  config.providers[options.providerId] = {
    type: options.wire,
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    ...(options.source === undefined ? {} : { source: { ...options.source } }),
  };

  const models = config.models ?? {};
  for (const [key, alias] of Object.entries(models)) {
    if (alias.provider === options.providerId) delete models[key];
  }
  for (const model of options.models) {
    models[`${options.providerId}/${model.id}`] = catalogModelToAlias(options.providerId, model);
  }
  config.models = models;

  const defaultModel = `${options.providerId}/${options.selectedModelId}`;
  config.defaultModel = defaultModel;
  if (options.thinking !== undefined) {
    config.thinking = { ...config.thinking, enabled: options.thinking };
  }
  return { defaultModel };
}
