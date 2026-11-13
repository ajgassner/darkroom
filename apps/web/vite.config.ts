import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The UI is built into ../dist/web and served by the Node server (src/server.ts).
// In development, Vite serves the UI on :5173 and proxies API and media requests to the server on :5177.
const API = `http://127.0.0.1:${process.env.PORT ?? 5177}`;

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  // Local app: one bundle is fine, so the size warning threshold is raised
  build: { outDir: path.resolve(import.meta.dirname, '../../dist/web'), emptyOutDir: true, chunkSizeWarningLimit: 900 },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: API, changeOrigin: false },
      '/out': { target: API, changeOrigin: false },
    },
  },
});
