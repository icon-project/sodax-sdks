import { defineConfig } from 'tsup';

export default defineConfig(options => ({
  entry: ['./src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: !options.watch,
  external: ['react', 'react-dom', '@tanstack/react-query'], // <— important
  treeshake: true,
  splitting: true,
  sourcemap: true,
  target: 'es2023',
  outExtension() {
    return { js: '.mjs' };
  },
}));
