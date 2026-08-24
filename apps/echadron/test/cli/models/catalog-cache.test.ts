import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  readFreshModelsDevCatalog,
  readModelsDevCache,
  refreshModelsDevCatalog,
} from '#/cli/models/catalog-cache';

const catalog = {
  openai: {
    name: 'OpenAI',
    models: {
      'gpt-test': { id: 'gpt-test', name: 'GPT Test' },
    },
  },
};

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function cachePath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'echadron-models-'));
  tempRoots.push(root);
  return join(root, 'models.dev.json');
}

describe('Echadron models.dev catalog cache', () => {
  it('persists a forced refresh and revalidates with ETag on 304', async () => {
    const filePath = await cachePath();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(catalog), {
          status: 200,
          headers: { etag: '"catalog-1"', 'last-modified': 'Sat, 25 Jul 2026 00:00:00 GMT' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 304 }));

    const first = await refreshModelsDevCatalog({ filePath, force: true, fetchImpl });
    expect(first.status).toBe('updated');
    expect((await readModelsDevCache(filePath))?.catalog).toEqual(catalog);

    const second = await refreshModelsDevCatalog({
      filePath,
      force: true,
      fetchImpl,
    });
    expect(second.status).toBe('not-modified');
    expect(fetchImpl).toHaveBeenLastCalledWith(
      'https://models.dev/api.json',
      expect.objectContaining({
        headers: expect.objectContaining({
          'If-None-Match': '"catalog-1"',
          'If-Modified-Since': 'Sat, 25 Jul 2026 00:00:00 GMT',
        }),
      }),
    );
    expect(second.cache.catalog).toEqual(catalog);
  });

  it('returns a fresh persisted catalog without a network request', async () => {
    const filePath = await cachePath();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(catalog), { status: 200 }),
    );
    await refreshModelsDevCatalog({ filePath, force: true, fetchImpl });

    await expect(readFreshModelsDevCatalog({ filePath })).resolves.toEqual(catalog);
  });

  it('ignores a corrupt cache instead of treating it as model metadata', async () => {
    const filePath = await cachePath();
    await writeFile(filePath, '{not-json', 'utf8');
    await expect(readModelsDevCache(filePath)).resolves.toBeUndefined();
  });

  it('drops malformed provider and model entries while preserving valid metadata', async () => {
    const filePath = await cachePath();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          openai: {
            name: 'OpenAI',
            models: {
              'gpt-test': { id: 'gpt-test', name: 'GPT Test' },
              'bad-model': null,
            },
          },
          'bad-provider': null,
          'bad-models': { name: 'Ignored models value', models: [] },
        }),
      ),
    );

    const result = await refreshModelsDevCatalog({ filePath, force: true, fetchImpl });
    expect(Object.keys(result.cache.catalog)).toEqual(['openai', 'bad-models']);
    expect(result.cache.catalog['openai']?.models).toEqual({
      'gpt-test': { id: 'gpt-test', name: 'GPT Test' },
    });
    expect(result.cache.catalog['bad-models']?.models).toBeUndefined();

    // The normalized snapshot is also what a later process reads from disk.
    await expect(readModelsDevCache(filePath)).resolves.toEqual(result.cache);
  });
});
