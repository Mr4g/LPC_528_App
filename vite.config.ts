import os from 'node:os';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const viteCacheDir = process.env.VITE_CACHE_DIR || path.join(os.tmpdir(), 'lpc-528-app-vite-cache');

export default defineConfig({
  plugins: [react()],
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
});
