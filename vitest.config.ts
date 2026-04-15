import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // Default to Node environment for all tests to avoid jsdom's
      // ArrayBuffer class mismatch in binary parsing tests.
      // Component tests that need DOM can opt in per-file via
      // `// @vitest-environment jsdom` pragma.
      environment: 'node',
      include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
      globals: false,
      reporters: ['default'],
      passWithNoTests: true,
    },
  }),
);
