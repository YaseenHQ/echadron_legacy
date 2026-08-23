import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { server: 'src/index.ts' },
  format: ['esm'],
  outDir: 'dist',
  clean: true,
  external: ['@yaseenhq/agent-core', '@yaseenhq/tsugite', '@yaseenhq/kaos'],
});
