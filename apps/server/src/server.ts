// Entry point: local HTTP API and web UI on 127.0.0.1 only.
import { ENV_FILE, hasApiKey, PORT } from '@darkroom/core/config';
import { checkForUpdate } from '@darkroom/core/update-check';
import { buildApp } from './app.ts';

const app = await buildApp();
await app.listen({ host: '127.0.0.1', port: PORT });
console.log(`darkroom is running at http://localhost:${PORT}`);
if (!hasApiKey())
  console.log(`No OpenRouter API key yet: enter it in the web UI, or add OPENROUTER_API_KEY to ${ENV_FILE}.`);
void checkForUpdate().then(({ current, update }) => {
  if (update) console.log(`darkroom ${update.version} is available (you have ${current}): ${update.command}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
