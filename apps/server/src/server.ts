// Entry point: local HTTP API and web UI on 127.0.0.1 only.
import { ENV_FILE, hasApiKey, PORT } from '@darkroom/core/config';
import { buildApp } from './app.ts';

const app = await buildApp();
await app.listen({ host: '127.0.0.1', port: PORT });
console.log(`darkroom is running at http://localhost:${PORT}`);
if (!hasApiKey()) console.log(`Note: OPENROUTER_API_KEY is still missing. Add it to ${ENV_FILE} and restart.`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
