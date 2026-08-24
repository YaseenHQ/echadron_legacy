import { beforeEach, describe, expect, it } from 'vitest';

import { InstantiationService } from '#/_base/di/instantiationService';
import { ServiceCollection } from '#/_base/di/serviceCollection';
import {
  addCollectionRecord,
  collection,
  collectionItems,
  collectionView,
  definition,
  isCollectionToken,
  isDefinitionToken,
  _clearCollectionsForTests,
  type CollectionView,
} from '#/_base/di/collection';

describe('collection() / definition()', () => {
  beforeEach(() => {
    _clearCollectionsForTests();
  });

  it('starts empty and reflects registrations in order', () => {
    const token = collection<string>('c1');
    expect(collectionItems(token)).toEqual([]);

    addCollectionRecord(token, 'a');
    addCollectionRecord(token, 'b');

    expect(collectionItems(token)).toEqual(['a', 'b']);
  });

  it('unregisters via the returned function', () => {
    const token = collection<string>('c2');
    const removeA = addCollectionRecord(token, 'a');
    addCollectionRecord(token, 'b');

    removeA();

    expect(collectionItems(token)).toEqual(['b']);
  });

  it('returns the same token for the same name (idempotent)', () => {
    const t1 = collection<string>('c3');
    const t2 = collection<string>('c3');
    expect(t1).toBe(t2);
  });

  it('runs the validator against existing entries before adding', () => {
    const token = collection<number>('c4', {
      validate: (value, existing) => {
        if (existing.includes(value)) throw new Error(`duplicate ${value}`);
      },
    });
    addCollectionRecord(token, 1);
    expect(() => addCollectionRecord(token, 1)).toThrow('duplicate 1');
    expect(collectionItems(token)).toEqual([1]);
  });

  it('definition() rejects a second active provider', () => {
    const token = definition<string>('d1');
    const remove = addCollectionRecord(token, 'only');
    expect(() => addCollectionRecord(token, 'second')).toThrow(/already has an active provider/);

    remove();
    // The slot is free again once the sole provider unregisters.
    expect(() => addCollectionRecord(token, 'second')).not.toThrow();
  });

  it('isCollectionToken / isDefinitionToken distinguish the two kinds', () => {
    const c = collection<string>('c5');
    const d = definition<string>('d2');
    expect(isCollectionToken(c)).toBe(true);
    expect(isDefinitionToken(c)).toBe(false);
    expect(isCollectionToken(d)).toBe(true);
    expect(isDefinitionToken(d)).toBe(true);
  });

  it('collectionView() fires onDidChange on add and remove', () => {
    const token = collection<string>('c6');
    const view = collectionView(token);
    const changes: { added: readonly string[]; removed: readonly string[] }[] = [];
    view.onDidChange((change) => changes.push(change));

    const remove = addCollectionRecord(token, 'x');
    expect(view.items).toEqual(['x']);
    remove();
    expect(view.items).toEqual([]);

    expect(changes).toEqual([
      { added: ['x'], removed: [] },
      { added: [], removed: ['x'] },
    ]);
  });

  it('a @collection() constructor parameter is DI-injected as a live CollectionView', () => {
    const token = collection<string>('c7');
    // Registered BEFORE the consumer is constructed...
    addCollectionRecord(token, 'first');

    class Consumer {
      constructor(@token public readonly view: CollectionView<string>) {}
    }

    const ix = new InstantiationService(new ServiceCollection());
    const consumer = ix.createInstance(Consumer);

    expect(consumer.view.items).toEqual(['first']);

    // ...and the SAME injected view keeps updating after construction, since
    // it reads the live registry rather than a snapshot taken at inject time.
    addCollectionRecord(token, 'second');
    expect(consumer.view.items).toEqual(['first', 'second']);
  });
});
