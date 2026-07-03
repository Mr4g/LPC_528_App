import os from 'node:os';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const viteCacheDir = process.env.VITE_CACHE_DIR || path.join(os.tmpdir(), 'lpc-528-app-vite-cache');

export default defineConfig(({ mode }) => {
  const lpcEnv = loadEnv(mode, process.cwd(), 'LPC_');

  return {
    plugins: [react()],
    define: {
      'import.meta.env.LPC_ENABLE_ESTIMATED_LEAK_RATE': JSON.stringify(lpcEnv.LPC_ENABLE_ESTIMATED_LEAK_RATE ?? 'false'),
      'import.meta.env.LPC_ESTIMATED_LEAK_WINDOW_POINTS': JSON.stringify(lpcEnv.LPC_ESTIMATED_LEAK_WINDOW_POINTS ?? '10'),
    },
    cacheDir: viteCacheDir,
    server: {
      host: '0.0.0.0',
      proxy: {
        '/api': 'http://localhost:3000',
        '/socket.io': {
          target: 'http://localhost:3000',
          ws: true,
        },
      },
    },
  };
});
