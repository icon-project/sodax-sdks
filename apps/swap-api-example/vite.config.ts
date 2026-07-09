import path from 'node:path';
import { nodePolyfills } from '@bangjelkoski/vite-plugin-node-polyfills';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { type ConfigEnv, defineConfig, loadEnv } from 'vite';
import viteTsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig(({ mode }: ConfigEnv) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    base: '/',
    plugins: [tailwindcss(), viteTsconfigPaths(), react(), nodePolyfills({ protocolImports: true })],
    resolve: {
      alias: { '@': path.resolve(__dirname, './src') },
    },
    define: {
      global: 'globalThis',
      'process.env': env,
    },
  };
});
