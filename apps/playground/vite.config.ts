import path from 'node:path';
import { nodePolyfills } from '@bangjelkoski/vite-plugin-node-polyfills';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import viteTsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  base: '/',
  plugins: [viteTsconfigPaths(), react(), nodePolyfills({ protocolImports: true })],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      buffer: 'buffer/',
    },
    // Force a single React instance: transitive deps that still declare a React 18 peer otherwise
    // drag a second copy into the graph and hooks fire on a different React than the renderer.
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: ['buffer'],
  },
  server: {
    port: 3005,
  },
  define: {
    global: 'globalThis',
    // Keep empty: loading an unfiltered environment would expose build credentials in the bundle.
    // Dependencies still need process.env defined in the browser.
    'process.env': {},
    'process.version': JSON.stringify(''),
  },
});
