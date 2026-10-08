import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';
import { streamRelay } from './vite-plugin/stream-relay.ts';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    // Relays http-only streams so a secure-context page can play them.
    // Set WORLDLINE_STREAM_RELAY=0 to leave it out — the relay's only real cost
    // is host bandwidth, so the deployer decides.
    ...(process.env.WORLDLINE_STREAM_RELAY === '0' ? [] : [streamRelay()]),
    ...(mode === 'single' ? [viteSingleFile()] : []),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    open: false,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // `three.js` is a single ~550 KB dependency. It is already isolated behind a
    // lazy route, so it never reaches the initial load (the shell is ~70 KB
    // gzip). Raising the limit rather than leaving a warning that always fires —
    // a permanent warning trains you to ignore warnings.
    chunkSizeWarningLimit: 700,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.*', 'src/**/*.spec.*', 'src/dev/**', 'src/main.tsx'],
    },
  },
}));
