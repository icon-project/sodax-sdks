import path from 'node:path';
import { nodePolyfills } from '@bangjelkoski/vite-plugin-node-polyfills';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { type ConfigEnv, defineConfig } from 'vite';
import viteTsconfigPaths from 'vite-tsconfig-paths';

const MOCK_SPONSORING_TARGET = process.env.MOCK_SPONSORING_URL ?? 'http://localhost:9011';

export default defineConfig((_env: ConfigEnv) => {
  return {
    base: '/',
    plugins: [tailwindcss(), viteTsconfigPaths(), react(), nodePolyfills({ protocolImports: true })],
    resolve: {
      alias: { '@': path.resolve(__dirname, './src') },
    },
    server: {
      port: 3003,
      proxy: {
        // No proxy timeout: the hang scenario must exercise the SDK's timeout.
        '/__sponsor': {
          target: MOCK_SPONSORING_TARGET,
          changeOrigin: true,
          rewrite: requestPath => requestPath.replace(/^\/__sponsor/, ''),
        },
        // Preserve the prefix expected by Horizon's CallBuilder and the mock.
        '/__horizon': {
          target: MOCK_SPONSORING_TARGET,
          changeOrigin: true,
        },
      },
    },
    define: {
      global: 'globalThis',
      // Never inline the build machine's process.env; it can contain CI secrets.
      'process.env': {},
    },
  };
});
