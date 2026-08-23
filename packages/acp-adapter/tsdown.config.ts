import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['./src/index.ts'],
  format: ['esm'],
  dts: true,
  outDir: 'dist',
  clean: true,
  deps: {
    neverBundle: [
      '@agentclientprotocol/sdk',
      '@yaseenhq/agent-core',
      '@yaseenhq/echadron-sdk',
      '@yaseenhq/tsugite',
      '@yaseenhq/kaos',
    ],
  },
});
