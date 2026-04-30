// @ts-nocheck
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/shared/services/spoke/SonicSpokeService.test.ts'],
    exclude: ['src/e2e-tests/**'],
  },
});
