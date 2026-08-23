/**
 * `tsugiteConfig` domain (L3) — the tsugite persistence bridge contract.
 *
 * `ITsugiteConfigService` is the two-way sync between the config service
 * (persistence) and tsugite's in-memory provider/model registries:
 *
 *  - **Startup / config → tsugite**: once config is ready, the registries are
 *    hydrated from the effective config view; later config section changes
 *    (TOML edits, `config.reload`, direct `config.set/replace` writes such as
 *    the OAuth flows) are pushed into tsugite the same way.
 *  - **tsugite → config**: mutations that land in tsugite (klient `addProvider`,
 *    discovery refresh results, default-pointer changes) fire tsugite change
 *    events, which the bridge persists back through `config.replace`.
 *
 * Tsugite itself never sees the config service — this bridge is the only
 * component that knows both sides. Bound at App scope; instantiated by the
 * composition root (`bootstrap`) so hydration is guaranteed before any
 * consumer can await the tsugite registries' `ready`.
 */

import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';

export interface ITsugiteConfigService {
  readonly _serviceBrand: undefined;

  /** Resolves once the initial config → tsugite hydration has completed. */
  readonly ready: Promise<void>;
}

export const ITsugiteConfigService: ServiceIdentifier<ITsugiteConfigService> =
  createDecorator<ITsugiteConfigService>('tsugiteConfigService');
