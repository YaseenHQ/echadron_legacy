/**
 * Small persistence helpers for CLI-owned data files.
 *
 * This module is intentionally for non-config files only. User-facing
 * configuration is owned by core/SDK; do not route `config.toml` through
 * these helpers.
 */

import { appendFile, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import type { z } from 'zod';

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT'
  );
}

function assertNonConfigWrite(filePath: string): void {
  if (basename(filePath) === 'config.toml') {
    throw new Error(
      'CLI persistence helpers must not write config.toml; use core/SDK config APIs.',
    );
  }
}

function tempPathFor(filePath: string): string {
  const dir = dirname(filePath);
  const base = basename(filePath);
  const nonce = `${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
  return join(dir, `.${base}.${nonce}.tmp`);
}

export async function readJsonFile<T>(
  filePath: string,
  schema: z.ZodType<T>,
  fallback: T,
): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch (error) {
    if (isNotFound(error)) return fallback;
    throw error;
  }
  const parsed = JSON.parse(raw) as unknown;
  return schema.parse(parsed);
}

/**
 * Age after which a leftover temp file is considered abandoned. Comfortably
 * longer than any write here takes, so a concurrent writer's file is never
 * removed out from under it.
 */
const STALE_TEMP_MS = 60 * 60 * 1000;

/**
 * Remove abandoned temp siblings of `filePath`.
 *
 * The write path unlinks its own temp file when a write *throws*, but a
 * process killed mid-write (Ctrl+C, SIGKILL) never runs that cleanup, so the
 * partial file survives forever. These accumulate silently — one cache
 * directory had fourteen of them, some tens of megabytes. Sweeping on the next
 * successful write makes the directory self-healing without a separate
 * maintenance path.
 *
 * Best-effort throughout: a sweep failure must never fail the write that
 * already succeeded.
 */
async function sweepStaleTemps(filePath: string): Promise<void> {
  const dir = dirname(filePath);
  const prefix = `.${basename(filePath)}.`;
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  const cutoff = Date.now() - STALE_TEMP_MS;
  await Promise.all(
    entries
      .filter((entry) => entry.startsWith(prefix) && entry.endsWith('.tmp'))
      .map(async (entry) => {
        const candidate = join(dir, entry);
        try {
          const info = await stat(candidate);
          if (info.mtimeMs < cutoff) await unlink(candidate);
        } catch {
          // Raced with another writer, or already gone. Either is fine.
        }
      }),
  );
}

export async function writeJsonFile<T>(
  filePath: string,
  schema: z.ZodType<T>,
  value: T,
): Promise<void> {
  assertNonConfigWrite(filePath);
  const parsed = schema.parse(value);
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = tempPathFor(filePath);
  try {
    await writeFile(tmpPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf-8');
    await rename(tmpPath, filePath);
  } catch (error) {
    await unlink(tmpPath).catch(() => {});
    throw error;
  }
  await sweepStaleTemps(filePath);
}

export async function readJsonlFile<T>(
  filePath: string,
  lineSchema: z.ZodType<T>,
): Promise<T[]> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }

  const entries: T[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const result = lineSchema.safeParse(parsed);
      if (result.success) entries.push(result.data);
    } catch {
      // JSONL is append-only user data; tolerate bad rows and keep the rest.
    }
  }
  return entries;
}

export async function appendJsonlLine<T>(
  filePath: string,
  lineSchema: z.ZodType<T>,
  value: T,
): Promise<void> {
  assertNonConfigWrite(filePath);
  const parsed = lineSchema.parse(value);
  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(parsed)}\n`, 'utf-8');
}
