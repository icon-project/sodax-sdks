import path from 'node:path';
import { nodePolyfills } from '@bangjelkoski/vite-plugin-node-polyfills';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { type ConfigEnv, defineConfig } from 'vite';
import viteTsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig((_env: ConfigEnv) => {
  return {
    base: '/',
    plugins: [tailwindcss(), viteTsconfigPaths(), react(), nodePolyfills({ protocolImports: true })],
    resolve: {
      alias: { '@': path.resolve(__dirname, './src') },
    },
    define: {
      global: 'globalThis',
      // Keep empty: loading an unfiltered environment would expose build credentials in the bundle.
      // Dependencies still need process.env defined in the browser.
      'process.env': {},
    },
  };
});
