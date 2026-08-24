#!/usr/bin/env node
/**
 * Run the TypeScript entrypoint with the same isolated home bridge as the
 * production bundle. This is used by the direct dev/server scripts, which do
 * not go through scripts/dev.mjs.
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDir, '..');
const repoRoot = resolve(appRoot, '../..');
const env = { ...process.env };
env.ECHADRON_HOME ??= join(homedir(), '.echadron');
env.IMPERIUM_HOME ??= env.ECHADRON_HOME;
env.KIMI_CODE_HOME ??= env.ECHADRON_HOME;

const child = spawn(
  process.execPath,
  [
    require.resolve('tsx/cli'),
    '--tsconfig',
    resolve(appRoot, 'tsconfig.dev.json'),
    '--import',
    pathToFileURL(resolve(repoRoot, 'build/register-raw-text-loader.mjs')).href,
    resolve(appRoot, 'src/main.ts'),
    ...process.argv.slice(2),
  ],
  { cwd: repoRoot, env, stdio: 'inherit' },
);

child.on('error', (error) => {
  console.error(`Failed to start Echadron dev CLI: ${error.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  process.exit(signal === null ? (code ?? 0) : 1);
});
