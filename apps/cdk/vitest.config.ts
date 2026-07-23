import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    // CDK synth + asset bundling is slow; the migrator contract test synths several times.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
