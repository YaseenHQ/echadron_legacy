/**
 * Deployment profiles for the managed Kimi Code provider.
 *
 * Kimi Code runs two independent deployments — mainland-China (.com) and
 * global (.ai) — with separate accounts. A profile bundles the endpoints that
 * move together: OAuth host, managed API base, and site root. The OAuth
 * client id is shared across both and stays in `./constants`.
 *
 * Echadron ships the managed Kimi Code provider, so it needs both: a user
 * holding a kimi.ai account cannot sign in against auth.kimi.com. Only the
 * endpoints of this one provider live here — this is not a general
 * multi-provider mechanism, and other providers keep their own hosts.
 *
 * Resolution order (first match wins):
 *   1. env override (`KIMI_CODE_OAUTH_HOST` / `KIMI_OAUTH_HOST`)
 *   2. the `oauthHost` persisted in config.toml's oauth ref
 *   3. the default credential slot (`KIMI_CODE_OAUTH_KEY`) — a mainland-China
 *      login persists no `oauthHost`, so the slot's presence is itself an
 *      explicit mainland-cn signal
 *   4. the install-channel marker file (`<home>/region`), read only before a
 *      first login has been persisted
 *   5. default 'mainland-cn'
 *
 * Upstream's copy also routes a tips-banner CDN through here. Echadron
 * disables remote banners (see `ECHADRON_TIPS_BANNER_URL_ENV`), so that
 * helper is deliberately not ported.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import { DEFAULT_KIMI_CODE_OAUTH_HOST } from './constants';
import { KIMI_CODE_OAUTH_KEY, kimiCodeEnvBaseUrl, kimiCodeEnvOAuthHost } from './managed-kimi-code';
import { DEFAULT_KIMI_CODE_BASE_URL } from './managed-usage';

export type KimiRegion = 'mainland-cn' | 'global';

/** Zod schema for the wire/domain contract; parses to {@link KimiRegion}. */
export const kimiRegionSchema = z.enum(['mainland-cn', 'global']);

export interface KimiRegionProfile {
  /** OAuth host the device flow talks to (authorize/token derive from it). */
  readonly oauthHost: string;
  /** Managed API base (`/coding/v1`): usages, userinfo, models, feedback. */
  readonly baseUrl: string;
  /** Official site root (docs, console, signup, upgrade pages). */
  readonly siteBase: string;
}

export const KIMI_REGION_PROFILES: Record<KimiRegion, KimiRegionProfile> = {
  'mainland-cn': {
    oauthHost: DEFAULT_KIMI_CODE_OAUTH_HOST,
    baseUrl: DEFAULT_KIMI_CODE_BASE_URL,
    siteBase: 'https://www.kimi.com',
  },
  global: {
    oauthHost: 'https://auth.kimi.ai',
    baseUrl: 'https://api.kimi.ai/coding/v1',
    siteBase: 'https://www.kimi.ai',
  },
};

export function kimiRegionProfile(region: KimiRegion): KimiRegionProfile {
  return KIMI_REGION_PROFILES[region];
}

/**
 * Login hosts for an explicit region choice, or `undefined` when an env
 * override is in play — env keeps full control of endpoints, so a region pick
 * must not smuggle profile hosts past it.
 *
 * When returned, both hosts are always set, including for 'mainland-cn' whose
 * values equal the defaults. Passing them explicitly is what lets a switch
 * back to mainland China override a previously persisted global login.
 */
export function kimiRegionLoginHosts(
  region: KimiRegion,
  env: NodeJS.ProcessEnv = process.env,
): { readonly oauthHost: string; readonly baseUrl: string } | undefined {
  if (kimiCodeEnvOAuthHost(env) !== undefined || kimiCodeEnvBaseUrl(env) !== undefined) {
    return undefined;
  }
  const profile = kimiRegionProfile(region);
  return { oauthHost: profile.oauthHost, baseUrl: profile.baseUrl };
}

/**
 * Marker file under the Echadron home dir. An install script writes a single
 * line (`mainland-cn` or `global`) so a fresh client defaults to the region
 * matching the channel it came from. Consulted only while no login has been
 * persisted; config.toml always wins.
 */
export const KIMI_REGION_MARKER_FILENAME = 'region';

export interface ResolveKimiRegionOptions {
  /** Defaults to `process.env`. */
  readonly env?: NodeJS.ProcessEnv;
  /** The `oauthHost` persisted in config.toml's oauth ref, if any. */
  readonly configuredOAuthHost?: string;
  /**
   * The credential key persisted in config.toml's oauth ref, if any. The
   * default slot ({@link KIMI_CODE_OAUTH_KEY}) only ever holds a mainland-China
   * login, so its presence outranks the install-channel marker.
   */
  readonly configuredOAuthKey?: string;
  /** Echadron home dir; defaults to the same resolution `toolkit` uses. */
  readonly homeDir?: string;
  /** Set false to skip the install-channel marker. */
  readonly readMarker?: boolean;
}

function normalizeHost(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function regionForOAuthHost(oauthHost: string): KimiRegion | undefined {
  const normalized = normalizeHost(oauthHost);
  for (const region of Object.keys(KIMI_REGION_PROFILES) as KimiRegion[]) {
    if (normalizeHost(KIMI_REGION_PROFILES[region].oauthHost) === normalized) return region;
  }
  return undefined;
}

function readRegionMarker(homeDir: string): KimiRegion | undefined {
  let raw: string;
  try {
    raw = readFileSync(join(homeDir, KIMI_REGION_MARKER_FILENAME), 'utf-8');
  } catch {
    return undefined;
  }
  const value = raw.trim();
  return value === 'mainland-cn' || value === 'global' ? value : undefined;
}

// Mirrors `defaultKimiHome` in ./toolkit; keep the two in sync so the marker
// always lands next to the credentials dir it describes.
function defaultHomeDir(env: NodeJS.ProcessEnv): string {
  const override =
    env['ECHADRON_HOME'] ??
    env['ECHADRON_CODE_HOME'] ??
    env['IMPERIUM_HOME'] ??
    env['KIMI_CODE_HOME'];
  if (override !== undefined && override.length > 0) return override;
  return join(homedir(), '.echadron');
}

export function resolveKimiRegion(options: ResolveKimiRegionOptions = {}): KimiRegion {
  const env = options.env ?? process.env;
  // An env host matching a profile pins the region. An unknown env host means a
  // custom environment: the per-endpoint env overrides keep working regardless
  // of region, so fall to the default rather than letting a stale config or
  // marker point site links somewhere odd.
  const envHost = env['KIMI_CODE_OAUTH_HOST'] ?? env['KIMI_OAUTH_HOST'];
  if (envHost !== undefined && envHost.length > 0) {
    return regionForOAuthHost(envHost) ?? 'mainland-cn';
  }
  const configured = options.configuredOAuthHost;
  if (configured !== undefined && configured.length > 0) {
    const configuredRegion = regionForOAuthHost(configured);
    if (configuredRegion !== undefined) return configuredRegion;
  }
  if (options.configuredOAuthKey === KIMI_CODE_OAUTH_KEY) return 'mainland-cn';
  if (options.readMarker !== false) {
    const markerRegion = readRegionMarker(options.homeDir ?? defaultHomeDir(env));
    if (markerRegion !== undefined) return markerRegion;
  }
  return 'mainland-cn';
}
