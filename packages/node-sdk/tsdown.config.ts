import { fileURLToPath } from 'node:url';

import { defineConfig } from 'tsdown';

import { rawTextPlugin } from '../../build/raw-text-plugin.mjs';

export default defineConfig({
  entry: ['./src/index.ts'],
  format: ['esm'],
  dts: false,
  outDir: 'dist',
  clean: true,
  plugins: [rawTextPlugin()],
  banner: {
    js: [
      "import { fileURLToPath as __cjsShimFileURLToPath } from 'node:url';",
      "import { dirname as __cjsShimDirname } from 'node:path';",
      'const __filename = __cjsShimFileURLToPath(import.meta.url);',
      'const __dirname = __cjsShimDirname(__filename);',
    ].join('\n'),
  },
  alias: {
    '@yaseenhq/agent-core': fileURLToPath(new URL('../agent-core/src/index.ts', import.meta.url)),
    '@yaseenhq/kaos': fileURLToPath(new URL('../kaos/src/index.ts', import.meta.url)),
    '@yaseenhq/echadron-oauth': fileURLToPath(new URL('../oauth/src/index.ts', import.meta.url)),
    '@yaseenhq/tsugite': fileURLToPath(new URL('../tsugite/src/index.ts', import.meta.url)),
  },
  deps: {
    alwaysBundle: [/^@moonshot-ai\//],
    neverBundle: [],
  },
});
