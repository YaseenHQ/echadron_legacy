/**
 * `subagent` domain (L6) — subagent config-section schema, env binding, and
 * timeout / model resolution.
 *
 * Owns the `[subagent]` configuration section (`timeout_ms` on disk) together
 * with the `KIMI_SUBAGENT_TIMEOUT_MS` env override, mirroring v1's
 * `resolveSubagentTimeoutMs` precedence (env > config.toml > 2h default). While
 * the env var is set, `stripEnvBoundFields` restores the env-free raw value
 * before persistence, so the override never leaks into `config.toml`. Both
 * collaboration tools — `Agent` in this domain and `AgentSwarm` in the `swarm`
 * domain — resolve their per-run timeout through `resolveSubagentTimeoutMs`,
 * and render the timeout message with `formatSubagentTimeoutDescription`.
 *
 * The model half of the spawn binding is the secondary model (the section
 * and type in `app/kosongConfig` — `[secondary_model]` on disk): when its
 * experiment is enabled and the model is set, newly spawned subagents bind to
 * it by default instead of inheriting the caller's model, and the
 * `Agent`/`AgentSwarm` tools let the parent model pick per spawn via their
 * `model` parameter. When unset, spawning behavior is unchanged (subagents
 * inherit the caller's model). A recipe with patch fields binds the
 * synthesized derived entry (`SECONDARY_DERIVED_MODEL_ID`); a pointer-only
 * recipe binds the pointed entry directly. `default_effort` is passed as the
 * explicit subagent thinking; without it the subagent resolves thinking
 * naturally (global thinking config → the bound model's default effort)
 * rather than inheriting the caller's level. Both tools resolve spawn
 * bindings through `resolveSubagentBinding`, advertise the pair via
 * `buildSubagentModelDescriptions` (each line suffixed with the entry's
 * resolved capability flags, so the parent can route multimodal or
 * thinking-heavy subagent tasks instead of guessing from the model id),
 * and wrap spawn failures with
 * `wrapSubagentModelError`. Spawn reporting reads the display-facing
 * alias from `secondaryModelDisplayAlias`: the derived entry id means nothing to a
 * user, so it resolves back to the recipe's base alias — flag-independent on
 * purpose, since interpreting an already-persisted derived binding (resume)
 * must keep working after the experiment is switched off. Self-registered
 * at module load via `registerConfigSection`.
 * While the `secondary-model` experiment is off they also strip the no-op
 * `model` parameter from their advertised schemas via
 * `stripSubagentModelParameter`.
 */

import { z } from 'zod';

import { Error2, ErrorCodes, isError2 } from '#/errors';
import type { AgentModelPreference } from '#/app/agentProfileCatalog/agentProfileCatalog';
import { isPlainObject } from '#/app/config/toml';
import type { IFlagService } from '#/app/flag/flag';
import {
  MODELS_SECTION,
  SECONDARY_MODEL_ENV,
  SECONDARY_MODEL_SECTION,
} from '#/app/kosongConfig/configSection';
import {
  SECONDARY_DERIVED_MODEL_ID,
  secondaryModelDisplayAlias,
  secondaryModelPatch,
} from '#/app/kosongConfig/secondaryModelOverlay';
import { type SecondaryModelConfig } from '#/app/kosongConfig/configSection';
import {
  type EnvBindings,
  envBindings,
  stripEnvBoundFields,
  type IConfigService,
} from '#/app/config/config';
import { registerConfigSection } from '#/app/config/configSectionContributions';
import type { ModelCapability } from '#/kosong/contract/capability';
import type { IModelCatalog } from '#/kosong/model/catalog';

import { SECONDARY_MODEL_FLAG_ID } from './flag';

export const SUBAGENT_SECTION = 'subagent';

export const SubagentConfigSchema = z.object({
  timeoutMs: z.number().int().min(0).optional(),
});

export type SubagentConfig = z.infer<typeof SubagentConfigSchema>;

/** Default per-run subagent timeout: 2 hours, same as v1. */
export const DEFAULT_SUBAGENT_TIMEOUT_MS = 2 * 60 * 60 * 1000;

export const SUBAGENT_TIMEOUT_ENV = 'KIMI_SUBAGENT_TIMEOUT_MS';

/** Parse the env override; anything but a positive integer is ignored (v1 semantics). */
function parseTimeoutMsEnv(raw: string): number | undefined {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : undefined;
}

export const subagentEnvBindings: EnvBindings<SubagentConfig> = envBindings(
  SubagentConfigSchema,
  {
    timeoutMs: { env: SUBAGENT_TIMEOUT_ENV, parse: parseTimeoutMsEnv },
  },
);

export const stripSubagentEnv = stripEnvBoundFields(subagentEnvBindings);

registerConfigSection(SUBAGENT_SECTION, SubagentConfigSchema, {
  defaultValue: { timeoutMs: DEFAULT_SUBAGENT_TIMEOUT_MS },
  env: subagentEnvBindings,
  stripEnv: stripSubagentEnv,
});

/**
 * Resolve the effective per-run subagent timeout. Governs foreground and
 * background subagents (and AgentSwarm) through the task manager's per-task
 * timeout.
 */
export function resolveSubagentTimeoutMs(config: IConfigService): number {
  return (
    config.get<SubagentConfig | undefined>(SUBAGENT_SECTION)?.timeoutMs ??
    DEFAULT_SUBAGENT_TIMEOUT_MS
  );
}

/**
 * What a caller asked a subagent to run on: either a role keyword
 * (`'primary'` / `'secondary'`) or the id of a configured `[models]` entry.
 * The role keywords win over an identically-named entry, so a caller can
 * always reach the roles regardless of how models happen to be named.
 */
export type SubagentModelChoice = AgentModelPreference | (string & {});

export const SUBAGENT_MODEL_ROLES = ['primary', 'secondary'] as const;

export function isSubagentModelRole(choice: string): choice is AgentModelPreference {
  return (SUBAGENT_MODEL_ROLES as readonly string[]).includes(choice);
}

export function resolveSecondaryModel(
  config: IConfigService,
  flags: IFlagService,
): SecondaryModelConfig | undefined {
  if (!flags.enabled(SECONDARY_MODEL_FLAG_ID)) return undefined;
  return config.get<SecondaryModelConfig | undefined>(SECONDARY_MODEL_SECTION);
}

/** Ids of every configured `[models]` entry, minus reserved runtime entries. */
export function configuredModelAliases(config: IConfigService): readonly string[] {
  const models = config.get<Record<string, unknown> | undefined>(MODELS_SECTION);
  if (models === undefined) return [];
  return Object.keys(models)
    .filter((alias) => alias !== SECONDARY_DERIVED_MODEL_ID)
    .toSorted();
}

export function resolveSubagentBinding(
  config: IConfigService,
  flags: IFlagService,
  own: { modelAlias: string; thinkingLevel: string },
  requested?: SubagentModelChoice,
): { model: string; thinking?: string; displayModel: string } {
  // An explicit alias binds directly and lets thinking resolve naturally from
  // that entry, rather than inheriting a level tuned for a different model.
  if (requested !== undefined && !isSubagentModelRole(requested)) {
    return {
      model: requested,
      displayModel: secondaryModelDisplayAlias(config, requested),
    };
  }

  const secondary = resolveSecondaryModel(config, flags);
  if (requested !== 'primary' && secondary?.model !== undefined) {
    const model =
      secondaryModelPatch(secondary) === undefined ? secondary.model : SECONDARY_DERIVED_MODEL_ID;
    return {
      model,
      thinking: secondary.defaultEffort,
      displayModel: secondaryModelDisplayAlias(config, model),
    };
  }
  return {
    model: own.modelAlias,
    thinking: own.thinkingLevel,
    displayModel: secondaryModelDisplayAlias(config, own.modelAlias),
  };
}

/** Cap on individually-advertised aliases, so the tool schema stays bounded. */
export const MAX_ADVERTISED_SUBAGENT_MODELS = 24;

export function buildSubagentModelDescriptions(
  config: IConfigService,
  flags: IFlagService,
  callerModelAlias: string | undefined,
  modelCatalog?: IModelCatalog,
): string | undefined {
  if (callerModelAlias === undefined) return undefined;
  const secondary = resolveSecondaryModel(config, flags);
  const secondaryModel = secondary?.model;

  // With no secondary role and nothing else configured, every value of `model`
  // resolves to the caller's own model — advertising a one-item list would
  // just be noise in the schema.
  const routable = configuredModelAliases(config).filter((alias) => alias !== callerModelAlias);
  if (secondaryModel === undefined && routable.length === 0) return undefined;

  const lines: string[] = ['Available models (pass via model):'];
  if (secondaryModel !== undefined) {
    const boundSecondary =
      secondaryModelPatch(secondary) === undefined ? secondaryModel : SECONDARY_DERIVED_MODEL_ID;
    lines.push(
      `- secondary: ${secondaryModel} (default) — the configured secondary model; prefer it for routine subagent tasks${capabilitiesSuffix(resolvedCapabilities(modelCatalog, boundSecondary))}`,
    );
  }
  lines.push(
    `- primary: ${callerModelAlias}${secondaryModel === undefined ? ' (default)' : ''} — the main model you are running on; use it for hard, quality-sensitive subagent tasks${capabilitiesSuffix(resolvedCapabilities(modelCatalog, callerModelAlias))}`,
  );

  // Any other configured entry is routable by id, which lets a caller send a
  // multimodal or long-context task to the one model that fits it instead of
  // choosing between two roles.
  const roleAliases = new Set([callerModelAlias, ...(secondaryModel === undefined ? [] : [secondaryModel])]);
  const others = configuredModelAliases(config).filter((alias) => !roleAliases.has(alias));
  if (others.length > 0) {
    const shown = others.slice(0, MAX_ADVERTISED_SUBAGENT_MODELS);
    lines.push('Or pass any other configured model id:');
    for (const alias of shown) {
      lines.push(`- ${alias}${capabilitiesSuffix(resolvedCapabilities(modelCatalog, alias))}`);
    }
    if (others.length > shown.length) {
      lines.push(`- …and ${String(others.length - shown.length)} more configured models.`);
    }
  }

  return lines.length > 1 ? lines.join('\n') : undefined;
}

const ADVERTISED_CAPABILITY_FLAGS = [
  'image_in',
  'video_in',
  'audio_in',
  'thinking',
  'tool_use',
  'dynamically_loaded_tools',
] as const satisfies readonly (keyof ModelCapability)[];

function capabilitiesSuffix(capability: ModelCapability | undefined): string {
  if (capability === undefined) return '';
  const names = ADVERTISED_CAPABILITY_FLAGS.filter((flag) => capability[flag] === true);
  return `; capabilities: ${names.length === 0 ? 'none' : names.join(', ')}`;
}

function resolvedCapabilities(
  modelCatalog: IModelCatalog | undefined,
  model: string,
): ModelCapability | undefined {
  if (modelCatalog === undefined) return undefined;
  try {
    return modelCatalog.get(model).capabilities;
  } catch {
    return undefined;
  }
}

/**
 * Strip the `model` property from a subagent collaboration tool's advertised
 * JSON schema. While the `secondary-model` experiment is off the parameter is
 * a silent no-op, so the schema the model sees (and the args validator
 * compiled from the same advertised schema) drops it entirely — the
 * secondary-model concept never enters the prompt, and a stray `model`
 * argument is rejected instead of silently inheriting the caller's model.
 * Returns the input unchanged when there is no `model` property; otherwise a
 * shallow copy — the input is never mutated, so callers can keep both
 * variants as shared constants.
 */
export function stripSubagentModelParameter(
  parameters: Record<string, unknown>,
): Record<string, unknown> {
  const properties = parameters['properties'];
  if (!isPlainObject(properties) || !('model' in properties)) return parameters;
  const nextProperties = { ...properties };
  delete nextProperties['model'];
  const next: Record<string, unknown> = { ...parameters, properties: nextProperties };
  const required = parameters['required'];
  if (Array.isArray(required) && required.includes('model')) {
    next['required'] = required.filter((entry) => entry !== 'model');
  }
  return next;
}

export function wrapSubagentModelError(
  error: unknown,
  boundModel: string,
  callerModelAlias: string,
  options: { readonly requestedExplicitly?: boolean } = {},
): unknown {
  if (boundModel === callerModelAlias) return error;
  if (!isError2(error) || error.code !== ErrorCodes.CONFIG_INVALID) return error;
  if (error.details?.['model'] !== boundModel) return error;

  // An alias the caller named itself is a bad argument, not bad config —
  // pointing at `[secondary_model]` would send them to the wrong place.
  if (options.requestedExplicitly === true) {
    return new Error2(
      error.code,
      `${error.message} (model "${boundModel}" was requested for this subagent — pass a configured [models] entry id, or "primary" / "secondary")`,
      { cause: error, name: error.name, details: { ...error.details, requestedModel: boundModel } },
    );
  }

  const displayModel =
    boundModel === SECONDARY_DERIVED_MODEL_ID
      ? `the derived entry "${SECONDARY_DERIVED_MODEL_ID}"`
      : `"${boundModel}"`;
  return new Error2(
    error.code,
    `${error.message} (secondary model ${displayModel} comes from [secondary_model].model / ${SECONDARY_MODEL_ENV} — check that it names a valid [models] entry)`,
    {
      cause: error,
      name: error.name,
      details: {
        ...error.details,
        secondaryModel: boundModel,
        secondaryModelConfig: {
          section: 'secondaryModel.model',
          environment: SECONDARY_MODEL_ENV,
        },
      },
    },
  );
}

/** Human-readable duration for the subagent timeout message. */
export function formatSubagentTimeoutDescription(ms: number): string {
  if (ms % (60 * 60 * 1000) === 0) {
    const h = ms / (60 * 60 * 1000);
    return `${h} hour${h === 1 ? '' : 's'}`;
  }
  if (ms % (60 * 1000) === 0) {
    const m = ms / (60 * 1000);
    return `${m} minute${m === 1 ? '' : 's'}`;
  }
  if (ms % 1000 === 0) {
    const s = ms / 1000;
    return `${s} second${s === 1 ? '' : 's'}`;
  }
  return `${ms} ms`;
}
