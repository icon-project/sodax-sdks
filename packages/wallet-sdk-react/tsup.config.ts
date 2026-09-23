import { defineConfig } from 'tsup';

const isWatchMode = process.argv.includes('--watch');

export default defineConfig({
  // Multi-entry: barrel + per-chain sub-paths (e.g. @sodax/wallet-sdk-react/xchains/bitcoin).
  // Adding a new chain? Create src/xchains/<chain>/index.ts — the glob picks it up automatically.
  // `privy` is opt-in: nothing outside `src/privy/` may value-import it (checked after build).
  entry: ['src/index.ts', 'src/xchains/*/index.ts', 'src/xchains/*/index.tsx', 'src/privy/index.ts'],
  outDir: 'dist',
  format: ['esm'],
  // splitting shares class identity across entry points (barrel + sub-path exports),
  // so `instanceof XverseXConnector` works when imported from either location.
  splitting: true,
  clean: true,
  dts: !isWatchMode, // skip slow .d.ts generation during watch — only needed for production builds
  sourcemap: !process.env.CI, // On for local debug builds, off in CI (publish + ci.yml set CI=true)
  target: 'es2023',
  treeshake: true,
  external: ['react', 'react-dom', '@tanstack/react-query'],
  esbuildOptions(options) {
    options.platform = 'neutral';
    options.mainFields = ['module', 'main'];
  },
  outExtension() {
    return { js: '.mjs' };
  },
});
