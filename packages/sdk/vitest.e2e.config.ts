// packages/sdk/vitest.e2e.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/e2e-tests/**/*.test.ts'],
  },
});
