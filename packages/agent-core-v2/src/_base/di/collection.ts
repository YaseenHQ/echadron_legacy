/**
 * `di` domain (L0) — multi-provider contribution points (`collection()`) and
 * single-provider definitions (`definition()`).
 *
 * Upstream backs this with a scope-aware `CollectionStore` — records carry a
 * provider identity and a scope path, and a consumer's view is filtered to
 * ancestors/descendants of its own scope, wired through a Fiber-based dynamic
 * provide/unprovide DI container. This fork's DI container is the simpler
 * static `registerScopedService` model (App -> Session -> Agent), and nothing
 * here needs scope-filtered visibility — a contribution registered anywhere is
 * meant to be visible everywhere, exactly like `toolContribution.ts`'s
 * `_agentToolContributions` array. So the registry below is a flat process-
 * global map: same public surface (`CollectionToken`, `CollectionView`,
 * `collection()`, `definition()`), a plain-array backing instead of a
 * scope-graph one. Consumers written against the public surface — a
 * `@AgentRuntimeContributionPoint contributionView: CollectionView<T>`
 * constructor parameter — need no changes.
 */

import { Emitter, type Event } from '../event';
import { storeCustomDependency, type ServiceIdentifier } from './instantiation';

export interface CollectionToken<T> {
  (target: any, key: string | symbol | undefined, index: number): void;

  readonly name: string;

  readonly __t?: T;

  toString(): string;
}

export interface DefinitionToken<T> extends CollectionToken<T> {
  readonly __definition?: T;
}

export interface DefinitionRecord<T> {
  readonly definition: T;
  readonly owner: string;
  readonly generation: number;
}

export interface DefinitionChange<T> {
  readonly current: DefinitionRecord<T> | undefined;
  readonly previous: DefinitionRecord<T> | undefined;
}

export interface DefinitionView<T> {
  readonly current: DefinitionRecord<T> | undefined;
  readonly onDidChangeDefinition: Event<DefinitionChange<T>>;
}

export interface CollectionRecord<T> {
  readonly value: T;
  readonly providerName: string;
  readonly scopePath: string;
}

export interface CollectionChange<T> {
  readonly added: readonly T[];
  readonly removed: readonly T[];
}

export interface CollectionView<T> {
  readonly items: readonly T[];
  readonly records: readonly CollectionRecord<T>[];
  readonly onDidChange: Event<CollectionChange<T>>;
}

interface StoredRecord {
  readonly id: number;
  readonly value: unknown;
}

const _collectionTokens = new Map<string, CollectionToken<unknown>>();
const _collectionTokenSet = new WeakSet<object>();
const _definitionTokenSet = new WeakSet<object>();
const _collectionValidators = new WeakMap<
  object,
  (value: unknown, existing: readonly unknown[]) => void
>();
const _records = new Map<CollectionToken<unknown>, Map<number, StoredRecord>>();
const _changeEmitters = new Map<CollectionToken<unknown>, Emitter<CollectionChange<unknown>>>();
let _nextRecordId = 0;

export function collection<T>(
  name: string,
  options: { readonly validate?: (value: T, existing: readonly T[]) => void } = {},
): CollectionToken<T> {
  const existing = _collectionTokens.get(name);
  if (existing !== undefined) {
    return existing as CollectionToken<T>;
  }
  const token = function collectionDecorator(
    target: any,
    _key: string | symbol | undefined,
    index: number,
  ): void {
    if (arguments.length !== 3) {
      throw new Error('@CollectionToken-decorator can only be used to decorate a parameter');
    }
    storeCustomDependency(token as unknown as ServiceIdentifier<any>, 'collection', target, index);
  } as unknown as CollectionToken<T>;
  Object.defineProperty(token, 'toString', {
    value: () => `collection:${name}`,
    enumerable: false,
  });
  Object.defineProperty(token, 'name', { value: name, enumerable: false, configurable: true });
  _collectionTokens.set(name, token as CollectionToken<unknown>);
  _collectionTokenSet.add(token);
  if (options.validate !== undefined) {
    _collectionValidators.set(
      token,
      options.validate as (value: unknown, existing: readonly unknown[]) => void,
    );
  }
  return token;
}

export function definition<T>(name: string): DefinitionToken<T> {
  const token = collection<T>(name, {
    validate: (_value, existing) => {
      if (existing.length > 0) throw new Error(`Definition ${name} already has an active provider`);
    },
  }) as DefinitionToken<T>;
  _definitionTokenSet.add(token);
  return token;
}

export function isCollectionToken(thing: unknown): thing is CollectionToken<unknown> {
  return typeof thing === 'function' && _collectionTokenSet.has(thing);
}

export function isDefinitionToken(thing: unknown): thing is DefinitionToken<unknown> {
  return typeof thing === 'function' && _definitionTokenSet.has(thing);
}

/** Register a contribution. Returns an unregister function. */
export function addCollectionRecord<T>(token: CollectionToken<T>, value: T): () => void {
  const key = token as unknown as CollectionToken<unknown>;
  let records = _records.get(key);
  if (records === undefined) {
    records = new Map();
    _records.set(key, records);
  }
  _collectionValidators.get(key)?.(
    value,
    [...records.values()].map((entry) => entry.value),
  );
  const record: StoredRecord = { id: ++_nextRecordId, value };
  records.set(record.id, record);
  emitterFor(key).fire({ added: [value], removed: [] });
  return () => {
    if (!records.delete(record.id)) return;
    emitterFor(key).fire({ added: [], removed: [value] });
  };
}

function emitterFor(token: CollectionToken<unknown>): Emitter<CollectionChange<unknown>> {
  let emitter = _changeEmitters.get(token);
  if (emitter === undefined) {
    emitter = new Emitter();
    _changeEmitters.set(token, emitter);
  }
  return emitter;
}

/** Every currently-registered value for a token, in registration order. */
export function collectionItems<T>(token: CollectionToken<T>): readonly T[] {
  const records = _records.get(token as unknown as CollectionToken<unknown>);
  return records === undefined ? [] : [...records.values()].map((r) => r.value as T);
}

/** A live view over a token's registered values — the DI-injected shape. */
export function collectionView<T>(token: CollectionToken<T>): CollectionView<T> & DefinitionView<T> {
  const onDidChangeDefinition = new Emitter<DefinitionChange<T>>();
  if (isDefinitionToken(token)) {
    emitterFor(token as unknown as CollectionToken<unknown>).event((change) => {
      const currentValue = collectionItems(token)[0];
      onDidChangeDefinition.fire({
        current: currentValue === undefined ? undefined : toDefinitionRecord(currentValue),
        previous:
          change.removed.length > 0 ? toDefinitionRecord(change.removed[0] as T) : undefined,
      });
    });
  }
  return {
    get items(): readonly T[] {
      return collectionItems(token);
    },
    get records(): readonly CollectionRecord<T>[] {
      return collectionItems(token).map((value) => ({
        value,
        providerName: 'unknown',
        scopePath: '',
      }));
    },
    get onDidChange(): Event<CollectionChange<T>> {
      return emitterFor(token as unknown as CollectionToken<unknown>)
        .event as unknown as Event<CollectionChange<T>>;
    },
    get current(): DefinitionRecord<T> | undefined {
      const value = collectionItems(token)[0];
      return value === undefined ? undefined : toDefinitionRecord(value);
    },
    onDidChangeDefinition: onDidChangeDefinition.event,
  };
}

function toDefinitionRecord<T>(value: T): DefinitionRecord<T> {
  return { definition: value, owner: 'unknown', generation: 0 };
}

export function _clearCollectionsForTests(): void {
  _records.clear();
  for (const emitter of _changeEmitters.values()) emitter.dispose();
  _changeEmitters.clear();
}
