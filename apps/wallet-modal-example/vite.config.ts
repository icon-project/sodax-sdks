import path from 'node:path';
import react from '@vitejs/plugin-react';
import type { ConfigEnv } from 'vite';
import { defineConfig, loadEnv } from 'vite';
import { nodePolyfills } from '@bangjelkoski/vite-plugin-node-polyfills';
import tailwindcss from '@tailwindcss/vite';
import svgr from 'vite-plugin-svgr';
import viteTsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig(({ command, mode }: ConfigEnv) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    // depending on your application, base can also be "/"
    base: '/',
    plugins: [
      tailwindcss(),
      svgr({
        include: '**/*.svg',
        svgrOptions: {
          ref: true,
        },
      }),
      viteTsconfigPaths(),
      react({
        babel: {
          plugins: ['macros'],
        },
      }),
      nodePolyfills({ protocolImports: true }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        buffer: 'buffer/',
      },
      // Force a single React instance in the bundle. Without this, transitive
      // deps that still declare a React 18 peer (e.g. @ledgerhq/domain-service
      // pulled in via @injectivelabs/wallet-ledger) drag a second copy of
      // react/react-dom into the graph, and the dev server renders a blank
      // page because hooks fire on a different React than the renderer sees.
      dedupe: ['react', 'react-dom'],
    },

    optimizeDeps: {
      include: ['buffer'],
      esbuildOptions: {
        target: 'esnext',
      },
    },
    build: {
      target: 'esnext',
    },
    server: {
      open: true,
      port: 3002,
    },
    define: {
      global: 'globalThis',
      'process.env': env,
      'process.version': JSON.stringify(''),
    },
  };
});
