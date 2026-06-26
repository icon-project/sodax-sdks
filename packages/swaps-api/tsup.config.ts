import { defineConfig } from 'tsup';

export default defineConfig(() => ({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'], // Dual format: ESM for web, CJS for Node.
  outDir: 'dist',
  splitting: false, // Flat output, easier for consumers.
  sourcemap: !process.env.CI, // On for local debug builds, off in CI.
  dts: true, // Type declarations.
  clean: true,
  target: 'es2023',
  treeshake: true,
  esbuildOptions(options) {
    options.platform = 'neutral'; // Works in both node and browser.
  },
  outExtension({ format }) {
    return {
      js: format === 'esm' ? '.mjs' : '.cjs', // Explicit extensions.
    };
  },
}));
