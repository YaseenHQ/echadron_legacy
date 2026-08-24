import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { appendJsonlLine, readJsonFile, readJsonlFile, writeJsonFile } from '#/utils/persistence';

interface TestJson {
  name: string;
  count: number;
}

const TestJsonSchema: z.ZodType<TestJson> = z.object({
  name: z.string(),
  count: z.number().int(),
});

interface TestLine {
  content: string;
}

const TestLineSchema: z.ZodType<TestLine> = z.object({
  content: z.string(),
});

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kimi-persistence-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('persistence helpers', () => {
  it('readJsonFile returns fallback when file is missing', async () => {
    const fallback = { name: 'fallback', count: 1 };
    await expect(
      readJsonFile(join(dir, 'missing.json'), TestJsonSchema, fallback),
    ).resolves.toEqual(fallback);
  });

  it('writeJsonFile writes schema-valid JSON atomically', async () => {
    const file = join(dir, 'nested', 'state.json');
    await writeJsonFile(file, TestJsonSchema, { name: 'ok', count: 2 });

    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({ name: 'ok', count: 2 });
    await expect(
      readJsonFile(file, TestJsonSchema, { name: 'fallback', count: 0 }),
    ).resolves.toEqual({ name: 'ok', count: 2 });
  });

  it('readJsonFile rejects schema-invalid JSON', async () => {
    const file = join(dir, 'bad.json');
    writeFileSync(file, JSON.stringify({ name: 'bad', count: 'nope' }), 'utf-8');

    await expect(
      readJsonFile(file, TestJsonSchema, { name: 'fallback', count: 0 }),
    ).rejects.toThrow();
  });

  it('writeJsonFile refuses to write config.toml', async () => {
    await expect(
      writeJsonFile(join(dir, 'config.toml'), TestJsonSchema, { name: 'bad', count: 1 }),
    ).rejects.toThrow(/config\.toml/);
  });

  it('readJsonlFile preserves valid line order', async () => {
    const file = join(dir, 'history.jsonl');
    writeFileSync(
      file,
      [
        JSON.stringify({ content: 'first' }),
        JSON.stringify({ content: 'second' }),
        JSON.stringify({ content: 'third' }),
      ].join('\n'),
      'utf-8',
    );

    await expect(readJsonlFile(file, TestLineSchema)).resolves.toEqual([
      { content: 'first' },
      { content: 'second' },
      { content: 'third' },
    ]);
  });

  it('readJsonlFile skips malformed and schema-invalid lines', async () => {
    const file = join(dir, 'history.jsonl');
    writeFileSync(
      file,
      [
        JSON.stringify({ content: 'good' }),
        'not json',
        JSON.stringify({ wrong: 'shape' }),
        '',
        JSON.stringify({ content: 'tail' }),
      ].join('\n'),
      'utf-8',
    );

    await expect(readJsonlFile(file, TestLineSchema)).resolves.toEqual([
      { content: 'good' },
      { content: 'tail' },
    ]);
  });

  it('appendJsonlLine creates the parent directory', async () => {
    const file = join(dir, 'nested', 'history.jsonl');
    await appendJsonlLine(file, TestLineSchema, { content: 'hello' });

    expect(readFileSync(file, 'utf-8').trim()).toBe(JSON.stringify({ content: 'hello' }));
  });
});

describe('abandoned temp files', () => {
  /**
   * The write path unlinks its temp file when a write throws, but a process
   * killed mid-write never runs that cleanup. Those partials accumulate
   * silently — a real cache directory had fourteen, tens of megabytes' worth.
   */
  const tempName = (base: string, nonce: string): string => `.${base}.${nonce}.tmp`;

  it('sweeps abandoned temps left by a killed process', async () => {
    const target = join(dir, 'state.json');
    const stale = join(dir, tempName('state.json', '999.1700000000000.abc'));
    writeFileSync(stale, 'partial write');
    // Backdate it past the staleness cutoff.
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(stale, old, old);

    await writeJsonFile(target, TestJsonSchema, { name: 'a', count: 1 });

    expect(existsSync(stale)).toBe(false);
    // The write it swept for still landed.
    await expect(readJsonFile(target, TestJsonSchema, { name: '', count: 0 })).resolves.toEqual({
      name: 'a',
      count: 1,
    });
  });

  it('leaves a fresh temp alone, since another writer may own it', async () => {
    const target = join(dir, 'state.json');
    const fresh = join(dir, tempName('state.json', '1234.1700000000001.def'));
    writeFileSync(fresh, 'in-flight write by another process');

    await writeJsonFile(target, TestJsonSchema, { name: 'a', count: 1 });

    expect(existsSync(fresh)).toBe(true);
  });

  it('never touches temps belonging to a different file', async () => {
    const target = join(dir, 'state.json');
    const other = join(dir, tempName('sessions.json', '999.1700000000000.abc'));
    writeFileSync(other, 'someone else');
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(other, old, old);

    await writeJsonFile(target, TestJsonSchema, { name: 'a', count: 1 });

    expect(existsSync(other)).toBe(true);
  });
});
