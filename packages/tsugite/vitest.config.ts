import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'tsugite',
    include: ['test/**/*.test.ts'],
  },
});
