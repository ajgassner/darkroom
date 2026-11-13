import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // vi.stubGlobal('fetch', …) from the fake OpenRouter is undone after every test
    unstubGlobals: true,
    projects: [
      {
        test: {
          name: 'node',
          include: ['packages/*/src/**/*.test.ts', 'apps/server/src/**/*.test.ts', 'apps/cli/src/**/*.test.ts'],
          environment: 'node',
          // Own empty data folder per test file, no real API key, no network
          setupFiles: ['./packages/core/test/setup.ts'],
        },
      },
      {
        resolve: { alias: { '@': path.resolve(import.meta.dirname, 'apps/web/src') } },
        test: { name: 'web', include: ['apps/web/src/**/*.test.ts'], environment: 'node' },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/core/src/**/*.ts', 'apps/*/src/**/*.{ts,tsx}'],
      exclude: ['**/*.test.ts', '**/*-worker.ts'],
      reporter: ['text-summary', 'json', 'html'],
      reportsDirectory: 'coverage',
    },
  },
});
