import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: 'src/client',
  publicDir: false,
  build: {
    outDir: resolve(__dirname, 'dist/client'),
    emptyOutDir: true,
    target: 'es2020',
    assetsInlineLimit: 0,
  },
  server: {
    port: 5173,
    fs: { allow: [resolve(__dirname)] },
    proxy: { '/socket.io': { target: 'http://localhost:3000', ws: true } },
  },
  test: { root: __dirname },
} as never);
