/**
 * `config` domain (L2) — `IConfigRegistry` and `IConfigService` implementations.
 *
 * Owns the section registry and the layered global config state: resolves a
 * value by precedence across defaults, the user config file, and per-run memory
 * overrides (highest, never persisted), and persists writes only for the `User`
 * target — validating the merged patch and re-validating the stripped result,
 * so a strip can never smuggle an unvalidated raw value (e.g. an env-masked
 * invalid field) to disk. Maintains five layered views of a domain — `rawSnake` (snake_case
 * write base keyed by the on-disk section key, kept for lossless round-trip),
 * `raw` (camelCase, env-free), `validated` (validated `raw`, env-free — the
 * base every live env re-application starts from and never mutates, so a
 * degraded or removed env value falls back to the file instead of a stale
 * overlay), `effective`
 * (`validated` plus the env overlay, recomputed on load/set), and `memory`
 * (per-run overrides)
 * — plus a `delivered` snapshot per domain used as the diff base for
 * `onDidSectionChange`. Reads config paths and the environment overlay through
 * `bootstrap`, persists the TOML document through the `storage` TOML
 * atomic-document store (reloading when the document changes on disk), and logs
 * through `log`. Late section / overlay registration re-validates the
 * already-loaded raw value and re-runs overlays. Bound at App scope.
 */

import { Disposable } from '#/_base/di/lifecycle';
import { LifecycleScope, ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { Emitter, type Event } from '#/_base/event';
import { Error2, ErrorCodes } from '#/errors';
import { IBootstrapService } from '#/app/bootstrap/bootstrap';
import { ILogService } from '#/_base/log/log';
import {
  IAtomicTomlDocumentStore,
  type IAtomicDocumentStore,
} from '#/persistence/interface/atomicDocumentStore';

import {
  type AnyEnvBindings,
  type ConfigChangedEvent,
  type ConfigDiagnostic,
  type ConfigSectionChangedEvent,
  type ConfigEffectiveOverlay,
  type ConfigInspectValue,
  type ConfigMerge,
  type ConfigOverlayRegisteredEvent,
  type ConfigSchema,
  type ConfigSection,
  type ConfigSectionRegisteredEvent,
  type ConfigChangeSource,
  type EnvBinding,
  type RegisterSectionOptions,
  type ResolvedConfig,
  ConfigScope,
  ConfigTarget,
  IConfigRegistry,
  IConfigService,
} from './config';
import { deepEqual, deepMerge, describeUnknownError, isPlainObject } from './configPure';
import { getConfigSectionContributions } from './configSectionContributions';
import { getConfigOverlayContributions } from './configOverlayContributions';
import { migrateThinkingEffortMaxToHigh } from './migrations';
import {
  applySectionToToml,
  camelToSnake,
  cloneRecord,
  describeTomlSyntaxError,
  TomlError,
  transformTomlData,
} from './toml';

const CONFIG_SCOPE = '';

type GetEnv = (name: string) => string | undefined;

function isEnvBinding(value: unknown): value is EnvBinding {
  return typeof value === 'string' || (isPlainObject(value) && 'env' in value);
}

function parseBoundRaw(binding: EnvBinding, raw: string): unknown {
  return typeof binding === 'string' ? raw : binding.parse ? binding.parse(raw) : raw;
}

function resolveBinding(binding: EnvBinding, getEnv: GetEnv, existing: unknown): unknown {
  if (typeof binding === 'string') {
    const raw = getEnv(binding);
    if (raw !== undefined) return raw;
  } else {
    const raw = getEnv(binding.env);
    if (raw !== undefined) {
      const parsed = parseBoundRaw(binding, raw);
      if (parsed !== undefined) return parsed;
    }
    if (binding.deprecatedEnv !== undefined) {
      const deprecatedRaw = getEnv(binding.deprecatedEnv);
      if (deprecatedRaw !== undefined) {
        const parsed = parseBoundRaw(binding, deprecatedRaw);
        if (parsed !== undefined) return parsed;
      }
    }
  }
  if (typeof binding === 'object' && binding.default !== undefined && existing === undefined) {
    return binding.default;
  }
  return existing;
}

function applyEnvBindings(
  target: Record<string, unknown>,
  bindings: AnyEnvBindings,
  getEnv: GetEnv,
): void {
  for (const [key, binding] of Object.entries(bindings)) {
    if (isEnvBinding(binding)) {
      const resolved = resolveBinding(binding, getEnv, target[key]);
      if (resolved !== undefined) target[key] = resolved;
    } else if (binding !== undefined) {
      const child: Record<string, unknown> = isPlainObject(target[key])
        ? { ...target[key] }
        : {};
      target[key] = child;
      applyEnvBindings(child, binding as AnyEnvBindings, getEnv);
      if (Object.keys(child).length === 0) {
        delete target[key];
      }
    }
  }
}

function applySectionEnv(base: unknown, env: AnyEnvBindings, getEnv: GetEnv): unknown {
  if (isEnvBinding(env)) {
    return resolveBinding(env, getEnv, base);
  }
  const target: Record<string, unknown> = isPlainObject(base) ? { ...base } : {};
  applyEnvBindings(target, env, getEnv);
  return target;
}

function isSameSection(
  existing: ConfigSection,
  schema: ConfigSchema<unknown>,
  options: RegisterSectionOptions<unknown>,
): boolean {
  return (
    existing.schema === schema &&
    existing.merge === (options.merge ?? deepMerge) &&
    existing.scope === (options.scope ?? ConfigScope.Core) &&
    existing.env === (options.env as ConfigSection['env']) &&
    existing.stripEnv === (options.stripEnv as ConfigSection['stripEnv']) &&
    existing.fromToml === options.fromToml &&
    existing.toToml === options.toToml &&
    deepEqual(existing.defaultValue, options.defaultValue) &&
    deepEqual(existing.deprecations, options.deprecations)
  );
}

export class ConfigRegistry implements IConfigRegistry {
  declare readonly _serviceBrand: undefined;
  private readonly sections = new Map<string, ConfigSection>();
  private readonly overlays: ConfigEffectiveOverlay[] = [];
  private readonly _onDidRegisterSection = new Emitter<ConfigSectionRegisteredEvent>();
  readonly onDidRegisterSection: Event<ConfigSectionRegisteredEvent> =
    this._onDidRegisterSection.event;
  private readonly _onDidRegisterOverlay = new Emitter<ConfigOverlayRegisteredEvent>();
  readonly onDidRegisterOverlay: Event<ConfigOverlayRegisteredEvent> =
    this._onDidRegisterOverlay.event;

  constructor() {
    for (const c of getConfigSectionContributions()) {
      this.registerSection(c.domain, c.schema, c.options);
    }
    for (const overlay of getConfigOverlayContributions()) {
      this.registerEffectiveOverlay(overlay);
    }
  }

  registerSection<T>(
    domain: string,
    schema: ConfigSchema<T>,
    options: RegisterSectionOptions<T> = {},
  ): void {
    const existing = this.sections.get(domain);
    if (existing !== undefined) {
      if (
        isSameSection(
          existing,
          schema as ConfigSchema<unknown>,
          options as RegisterSectionOptions<unknown>,
        )
      ) {
        return;
      }
      throw new Error(`ConfigRegistry: section '${domain}' is already registered`);
    }
    this.sections.set(domain, {
      domain,
      schema: schema as ConfigSchema<unknown>,
      defaultValue: options.defaultValue,
      merge: (options.merge ?? deepMerge) as ConfigMerge<unknown>,
      scope: options.scope ?? ConfigScope.Core,
      env: options.env as ConfigSection['env'],
      stripEnv: options.stripEnv as ConfigSection['stripEnv'],
      fromToml: options.fromToml,
      toToml: options.toToml,
      deprecations: options.deprecations,
    });
    this._onDidRegisterSection.fire({ domain });
  }

  getSection(domain: string): ConfigSection | undefined {
    return this.sections.get(domain);
  }

  listSections(): readonly ConfigSection[] {
    return [...this.sections.values()];
  }

  registerEffectiveOverlay(overlay: ConfigEffectiveOverlay): void {
    this.overlays.push(overlay);
    this._onDidRegisterOverlay.fire({ overlay });
  }

  listEffectiveOverlays(): readonly ConfigEffectiveOverlay[] {
    return [...this.overlays];
  }

  validate<T>(domain: string, value: unknown): T {
    const schema = this.sections.get(domain)?.schema;
    return (schema === undefined ? value : schema.parse(value)) as T;
  }

  merge<T>(domain: string, base: T | undefined, patch: unknown): T {
    const merge = this.sections.get(domain)?.merge ?? deepMerge;
    return merge(base, patch) as T;
  }

  defaultValue<T>(domain: string): T | undefined {
    return this.sections.get(domain)?.defaultValue as T | undefined;
  }
}

export class ConfigService extends Disposable implements IConfigService {
  declare readonly _serviceBrand: undefined;
  private readonly _onDidChangeConfiguration = this._register(new Emitter<ConfigChangedEvent>());
  readonly onDidChangeConfiguration: Event<ConfigChangedEvent> = this._onDidChangeConfiguration.event;
  private readonly _onDidSectionChange = this._register(new Emitter<ConfigSectionChangedEvent>());
  readonly onDidSectionChange: Event<ConfigSectionChangedEvent> = this._onDidSectionChange.event;
  readonly ready: Promise<void>;

  private stateChain: Promise<unknown> = Promise.resolve();

  private rawSnake: ResolvedConfig = {};
  private raw: ResolvedConfig = {};
  private validated: ResolvedConfig = {};
  private effective: ResolvedConfig = {};
  private memory: ResolvedConfig = {};
  private delivered: ResolvedConfig = {};
  private readonly diagnosticsList: ConfigDiagnostic[] = [];
  private readonly configKey: string;
  private tainted = false;

  constructor(
    @IConfigRegistry private readonly registry: IConfigRegistry,
    @IBootstrapService private readonly bootstrap: IBootstrapService,
    @ILogService private readonly log: ILogService,
    @IAtomicTomlDocumentStore private readonly documentStore: IAtomicDocumentStore,
  ) {
    super();
    this.configKey = this.bootstrap.configKey;
    this._register(this.registry.onDidRegisterSection((e) => this.revalidateDomain(e.domain)));
    this._register(this.registry.onDidRegisterOverlay(() => this.reapplyOverlays()));
    // One-shot config migrations run before the first load (best-effort, never
    // throws): rewrites a persisted thinking.effort "max" to "high" once.
    const { configKey } = this;
    const { homeDir } = this.bootstrap;
    this.ready = (async () => {
      await migrateThinkingEffortMaxToHigh(this.documentStore, configKey, homeDir);
      await this.load('load');
    })();
    this._register(
      this.documentStore.watch(CONFIG_SCOPE, this.configKey)(() => {
        void this.reload();
      }),
    );
  }

  get<T = unknown>(domain: string): T {
    if (Object.prototype.hasOwnProperty.call(this.memory, domain)) {
      return this.memory[domain] as T;
    }
    return this.freshEffective()[domain] as T;
  }

  inspect<T = unknown>(domain: string): ConfigInspectValue<T> {
    const memoryValue = this.memory[domain] as T | undefined;
    return {
      value: this.get<T>(domain),
      defaultValue: this.registry.defaultValue<T>(domain),
      userValue: this.raw[domain] as T | undefined,
      memoryValue,
    };
  }

  getAll(): ResolvedConfig {
    return { ...this.freshEffective(), ...this.memory };
  }

  private freshEffective(): ResolvedConfig {
    const effective: ResolvedConfig = { ...this.validated };
    this.applySectionEnvBindings(effective, false);
    this.applyEnvOverlay(effective, false);
    return effective;
  }

  diagnostics(): readonly ConfigDiagnostic[] {
    return [...this.diagnosticsList];
  }

  /**
   * Record a diagnostic, ignoring one already present. A persist that keeps
   * failing against the same unreadable file would otherwise pile up
   * identical entries for every attempt.
   */
  private pushDiagnostic(diagnostic: ConfigDiagnostic): void {
    const duplicate = this.diagnosticsList.some(
      (existing) =>
        existing.domain === diagnostic.domain &&
        existing.severity === diagnostic.severity &&
        existing.message === diagnostic.message,
    );
    if (!duplicate) this.diagnosticsList.push(diagnostic);
  }

  async set(
    domain: string,
    patch: unknown,
    target: ConfigTarget = ConfigTarget.User,
  ): Promise<void> {
    await this.ready;
    if (target === ConfigTarget.Memory) {
      const next = this.registry.merge(domain, this.memory[domain], patch);
      const validated = this.registry.validate(domain, next);
      if (validated === undefined) {
        delete this.memory[domain];
      } else {
        this.memory[domain] = validated;
      }
      this.commit('set', [domain]);
      return;
    }
    await this.enqueueStateTransition(async () => {
      this.assertPersistable();
      await this.persist(domain, (stagedRaw, stagedRawSnake) => {
        const next = this.registry.merge(domain, stagedRaw[domain], patch);
        const validated = this.registry.validate(domain, next);
        const stripped = this.stripEnv(domain, validated, stagedRaw, stagedRawSnake);
        if (stripped === undefined) {
          delete stagedRaw[domain];
        } else {
          this.registry.validate(domain, stripped);
          stagedRaw[domain] = stripped;
        }
      });
      this.rebuildEffective('set', [domain]);
    });
  }

  async replace(
    domain: string,
    value: unknown,
    target: ConfigTarget = ConfigTarget.User,
  ): Promise<void> {
    await this.ready;
    if (target === ConfigTarget.Memory) {
      if (value === undefined) {
        delete this.memory[domain];
      } else {
        this.memory[domain] = this.registry.validate(domain, value);
      }
      this.commit('set', [domain]);
      return;
    }
    await this.enqueueStateTransition(async () => {
      this.assertPersistable();
      await this.persist(domain, (stagedRaw, stagedRawSnake) => {
        const stripped = this.stripEnv(domain, value, stagedRaw, stagedRawSnake);
        if (stripped === undefined) {
          delete stagedRaw[domain];
        } else {
          stagedRaw[domain] = this.registry.validate(domain, stripped);
        }
      });
      this.rebuildEffective('set', [domain]);
    });
  }

  async replaceSections(
    sections: Readonly<Record<string, unknown>>,
    target: ConfigTarget = ConfigTarget.User,
  ): Promise<void> {
    await this.ready;
    const domains = Object.keys(sections);
    if (domains.length === 0) return;
    if (target === ConfigTarget.Memory) {
      const staged: ResolvedConfig = { ...this.memory };
      for (const domain of domains) {
        const value = sections[domain];
        if (value === undefined) {
          delete staged[domain];
        } else {
          staged[domain] = this.registry.validate(domain, value);
        }
      }
      this.memory = staged;
      this.commit('set', domains);
      return;
    }
    await this.enqueueStateTransition(async () => {
      this.assertPersistable();
      await this.persistDomains(domains, (stagedRaw, stagedRawSnake) => {
        for (const domain of domains) {
          const value = sections[domain] === null ? undefined : sections[domain];
          const stripped = this.stripEnv(domain, value, stagedRaw, stagedRawSnake);
          if (stripped === undefined) {
            delete stagedRaw[domain];
          } else {
            stagedRaw[domain] = this.registry.validate(domain, stripped);
          }
        }
      });
      this.rebuildEffective('set', domains);
    });
  }

  private stripEnv(
    domain: string,
    value: unknown,
    raw: ResolvedConfig,
    rawSnake: ResolvedConfig,
  ): unknown {
    let result = value;
    const section = this.registry.getSection(domain);
    if (section?.stripEnv !== undefined) {
      const getEnv = (name: string): string | undefined => this.bootstrap.getEnv(name);
      result = section.stripEnv(result, raw[domain], getEnv);
    }
    if (result === undefined) return result;
    for (const overlay of this.registry.listEffectiveOverlays()) {
      if (overlay.strip === undefined) continue;
      result = overlay.strip(domain, result, rawSnake);
      if (result === undefined) return result;
    }
    return result;
  }

  async reload(): Promise<void> {
    await this.ready;
    await this.enqueueStateTransition(() => this.load('reload'));
  }

  private enqueueStateTransition<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.stateChain.then(() => fn());
    this.stateChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async load(source: ConfigChangeSource): Promise<void> {
    this.diagnosticsList.length = 0;
    let fileData: ResolvedConfig = {};
    let failed = false;
    try {
      const data = await this.documentStore.get<ResolvedConfig>(CONFIG_SCOPE, this.configKey);
      fileData = data !== undefined && isPlainObject(data) ? data : {};
    } catch (error) {
      failed = true;
      const message =
        error instanceof TomlError
          ? `Failed to parse ${this.bootstrap.configPath}: ${describeTomlSyntaxError(error)}`
          : describeUnknownError(error);
      this.diagnosticsList.push({ severity: 'error', message });
      this.log.warn('config load failed', { error: describeUnknownError(error) });
      if (source !== 'load') {
        this.tainted = true;
        return;
      }
    }
    this.tainted = failed;
    const nextRawSnake = cloneRecord(fileData);
    if (source !== 'load' && JSON.stringify(nextRawSnake) === JSON.stringify(this.rawSnake)) {
      return;
    }
    this.rawSnake = nextRawSnake;
    this.raw = transformTomlData(fileData, this.registry);
    this.rebuildEffective(source);
  }

  private rebuildEffective(
    source: ConfigChangeSource = 'reload',
    domains?: readonly string[],
  ): void {
    const previous = this.effective;
    this.validated = this.buildValidated(this.raw);
    const next = { ...this.validated };
    this.applySectionEnvBindings(next, true);
    this.applyEnvOverlay(next);
    this.effective = next;

    // Commit candidates: the explicitly touched domains PLUS anything the
    // recompute actually changed. Section env bindings and effective overlays
    // rewrite sibling domains the caller's list never names (e.g. setting
    // `[secondary_model]` synthesizes a derived entry into `models`; removing
    // the recipe retracts it). `commit` re-checks every candidate with
    // deepEqual before firing, so widening the set is free — missing a real
    // change is what costs (a stale registry downstream).
    const candidates = new Set(
      domains ?? [...Object.keys(previous), ...Object.keys(next)],
    );
    for (const domain of new Set([...Object.keys(previous), ...Object.keys(next)])) {
      if (!deepEqual(previous[domain], next[domain])) candidates.add(domain);
    }
    this.commit(source, [...candidates]);
  }

  private deliveredValue(domain: string): unknown {
    return Object.prototype.hasOwnProperty.call(this.memory, domain)
      ? this.memory[domain]
      : this.effective[domain];
  }

  private commit(source: ConfigChangeSource, domains: readonly string[]): void {
    for (const domain of domains) {
      const previousValue = this.delivered[domain];
      const value = this.deliveredValue(domain);
      this._onDidChangeConfiguration.fire({ domain, source, value, previousValue });
      if (!deepEqual(value, previousValue)) {
        this._onDidSectionChange.fire({ domain, source, value, previousValue });
      }
      this.delivered[domain] = value;
    }
  }

  private buildValidated(raw: ResolvedConfig): ResolvedConfig {
    const validated: ResolvedConfig = {};
    for (const [domain, value] of Object.entries(raw)) {
      try {
        validated[domain] = this.registry.validate(domain, value);
      } catch (error) {
        this.diagnosticsList.push({
          domain,
          severity: 'warning',
          message: `Ignored invalid config section '${domain}': ${describeUnknownError(error)}`,
        });
      }
    }
    for (const section of this.registry.listSections()) {
      if (validated[section.domain] === undefined && section.defaultValue !== undefined) {
        validated[section.domain] = section.defaultValue;
      }
    }
    return validated;
  }

  private applySectionEnvBindings(effective: ResolvedConfig, reportErrors: boolean): void {
    const getEnv = (name: string): string | undefined => this.bootstrap.getEnv(name);
    for (const section of this.registry.listSections()) {
      if (section.env === undefined) continue;
      try {
        const base = effective[section.domain];
        const next = applySectionEnv(base, section.env, getEnv);
        effective[section.domain] = this.registry.validate(section.domain, next);
      } catch (error) {
        if (reportErrors) {
          this.diagnosticsList.push({
            domain: section.domain,
            severity: 'warning',
            message: `Ignoring env overlay for '${section.domain}': ${describeUnknownError(error)}`,
          });
        }
      }
    }
  }

  private applyEnvOverlay(effective: ResolvedConfig, reportErrors = true): void {
    const getEnv = (name: string): string | undefined => this.bootstrap.getEnv(name);
    const validate = (domain: string, value: unknown): unknown =>
      this.registry.validate(domain, value);
    for (const overlay of this.registry.listEffectiveOverlays()) {
      try {
        overlay.apply(effective, getEnv, validate);
      } catch (error) {
        if (reportErrors) {
          this.diagnosticsList.push({
            severity: 'warning',
            message: `Ignoring config environment overlay: ${describeUnknownError(error)}`,
          });
        }
      }
    }
  }

  private reapplyOverlays(): void {
    const before = this.effective;
    this.validated = this.buildValidated(this.raw);
    const next = { ...this.validated };
    this.applySectionEnvBindings(next, true);
    this.applyEnvOverlay(next);
    this.effective = next;
    this.commit('reload', [...new Set([...Object.keys(before), ...Object.keys(next)])]);
  }

  private revalidateDomain(domain: string): void {
    const section = this.registry.getSection(domain);
    if (section === undefined) return;

    if (section.fromToml !== undefined) {
      const rawSnakeValue = this.rawSnake[camelToSnake(domain)];
      if (rawSnakeValue !== undefined) {
        this.raw[domain] = section.fromToml(rawSnakeValue);
      }
    }

    if (this.raw[domain] !== undefined) {
      try {
        const validatedValue = this.registry.validate(domain, this.raw[domain]);
        this.validated[domain] = validatedValue;
        this.effective[domain] = validatedValue;
      } catch {
        return;
      }
    } else if (section.defaultValue !== undefined && this.effective[domain] === undefined) {
      this.validated[domain] = section.defaultValue;
      this.effective[domain] = section.defaultValue;
    } else {
      return;
    }

    this.applyEnvOverlay(this.effective);
    if (section.env !== undefined) {
      const getEnv = (name: string): string | undefined => this.bootstrap.getEnv(name);
      try {
        const next = applySectionEnv(this.effective[domain], section.env, getEnv);
        this.effective[domain] = this.registry.validate(domain, next);
      } catch (error) {
        this.diagnosticsList.push({
          domain,
          severity: 'warning',
          message: `Ignoring env overlay for '${domain}': ${describeUnknownError(error)}`,
        });
      }
    }
    this.commit('reload', [domain]);
  }

  private assertPersistable(): void {
    if (!this.tainted) return;
    throw new Error2(
      ErrorCodes.CONFIG_PERSIST_BLOCKED,
      `Refusing to persist config: ${this.bootstrap.configPath} could not be read; fix the file and reload before writing.`,
    );
  }

  private async persist(
    domain: string,
    rebase: (stagedRaw: ResolvedConfig, stagedRawSnake: ResolvedConfig) => void,
  ): Promise<void> {
    await this.persistDomains([domain], rebase);
  }

  private async persistDomains(
    domains: readonly string[],
    rebase: (stagedRaw: ResolvedConfig, stagedRawSnake: ResolvedConfig) => void,
  ): Promise<void> {
    this.assertPersistable();
    let onDisk: ResolvedConfig = {};
    try {
      const data = await this.documentStore.get<ResolvedConfig>(CONFIG_SCOPE, this.configKey);
      onDisk = data !== undefined && isPlainObject(data) ? data : {};
    } catch (error) {
      const message =
        error instanceof TomlError
          ? `Failed to parse ${this.bootstrap.configPath}: ${describeTomlSyntaxError(error)}`
          : describeUnknownError(error);
      this.pushDiagnostic({ severity: 'error', message });
      this.log.warn('config persist aborted: re-read failed', {
        error: describeUnknownError(error),
      });
      this.tainted = true;
      throw new Error2(
        ErrorCodes.CONFIG_PERSIST_BLOCKED,
        `Refusing to persist config: ${this.bootstrap.configPath} could not be read; fix the file and reload before writing.`,
        { cause: error },
      );
    }
    const stagedRawSnake = cloneRecord(onDisk);
    const stagedRaw = transformTomlData(onDisk, this.registry);
    rebase(stagedRaw, stagedRawSnake);
    for (const domain of domains) {
      applySectionToToml(stagedRawSnake, domain, stagedRaw[domain], this.registry);
    }
    await this.documentStore.set(CONFIG_SCOPE, this.configKey, stagedRawSnake);
    this.rawSnake = stagedRawSnake;
    this.raw = stagedRaw;
  }
}

registerScopedService(
  LifecycleScope.App,
  IConfigRegistry,
  ConfigRegistry,
  ScopeActivation.OnScopeCreated,
  'config',
);
registerScopedService(
  LifecycleScope.App,
  IConfigService,
  ConfigService,
  ScopeActivation.OnScopeCreated,
  'config',
);
