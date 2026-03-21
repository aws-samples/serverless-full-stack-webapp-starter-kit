import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: '.',
    include: ['**/*.integ.test.ts'],
    testTimeout: 30_000,
  },
});
