import { execFile } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { appRoot } from '../../../scripts/native/paths.mjs';

const execFileAsync = promisify(execFile);
const resolveReleaseScript = resolve(appRoot, 'scripts/native/resolve-release.mjs');

async function resolveRelease(options: {
  readonly publishedPackages?: unknown;
  readonly nativeEnabled?: boolean;
}): Promise<Record<string, string>> {
  const outputDir = await mkdtemp(join(tmpdir(), 'echadron-resolve-release-'));
  const outputPath = join(outputDir, 'github-output.txt');
  const env = { ...process.env };
  delete env['CHANGESETS_PUBLISHED_PACKAGES'];
  delete env['ECHADRON_NATIVE_RELEASE_ENABLED'];
  env['GITHUB_OUTPUT'] = outputPath;
  if (options.publishedPackages !== undefined) {
    env['CHANGESETS_PUBLISHED_PACKAGES'] = JSON.stringify(options.publishedPackages);
  }
  if (options.nativeEnabled) {
    env['ECHADRON_NATIVE_RELEASE_ENABLED'] = 'true';
  }

  await execFileAsync(process.execPath, [resolveReleaseScript], { cwd: appRoot, env });
  return Object.fromEntries(
    (await readFile(outputPath, 'utf-8'))
      .trim()
      .split('\n')
      .map((line) => line.split('=', 2) as [string, string]),
  );
}

describe('native release resolution', () => {
  const publishedPackages = [{ name: 'echadron', version: '0.30.0' }];

  it('keeps native publishing disabled until the repository opts in', async () => {
    await expect(resolveRelease({ publishedPackages })).resolves.toMatchObject({
      should_publish: 'false',
      version: '0.30.0',
      tag: 'echadron@0.30.0',
    });
  });

  it('publishes native assets only for a newly published Echadron package', async () => {
    await expect(
      resolveRelease({ publishedPackages, nativeEnabled: true }),
    ).resolves.toMatchObject({
      should_publish: 'true',
      version: '0.30.0',
      tag: 'echadron@0.30.0',
    });

    await expect(
      resolveRelease({ publishedPackages: [], nativeEnabled: true }),
    ).resolves.toMatchObject({ should_publish: 'false' });
  });
});
