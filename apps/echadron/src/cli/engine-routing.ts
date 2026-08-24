/**
 * Agent-engine routing for Echadron's CLI surfaces.
 *
 * Agent-core-v2 is the supported/default engine. Set the legacy switch only
 * when an integration still needs the v1 SDK surface. Experimental feature
 * controls are independent from engine selection.
 */

/** Canonical opt-out switch for the legacy v1 engine. */
export const ECHADRON_LEGACY_ENV = 'ECHADRON_LEGACY_FLAG';
/** @deprecated Use ECHADRON_LEGACY_ENV. */
export const KIMI_LEGACY_ENV = 'KIMI_CODE_LEGACY_FLAG';

const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on']);

function isTruthyEnv(
  key: string,
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return TRUTHY_VALUES.has((env[key] ?? '').trim().toLowerCase());
}

export function isLegacyEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return isTruthyEnv(ECHADRON_LEGACY_ENV, env) || isTruthyEnv(KIMI_LEGACY_ENV, env);
}

/** True unless the caller explicitly opts into the legacy v1 engine. */
export function isNativeEngineEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return !isLegacyEnabled(env);
}
