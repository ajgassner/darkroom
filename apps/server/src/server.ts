// Entry point: local HTTP API and web UI on 127.0.0.1 only.
import { retryMissingCosts } from '@darkroom/core/audio-run';
import { ENV_FILE, hasApiKey, PORT } from '@darkroom/core/config';
import { checkForUpdate } from '@darkroom/core/update-check';
import { buildApp } from './app.ts';
import { listenErrorMessage, signalHandler } from './lifecycle.ts';

const app = await buildApp();
try {
  await app.listen({ host: '127.0.0.1', port: PORT });
} catch (err) {
  console.error(listenErrorMessage(err, PORT, ENV_FILE));
  process.exit(1);
}
console.log(`darkroom is running at http://localhost:${PORT}`);
if (!hasApiKey())
  console.log(`No OpenRouter API key yet: enter it in the web UI, or add OPENROUTER_API_KEY to ${ENV_FILE}.`);
void checkForUpdate().then(({ current, update }) => {
  if (update) console.log(`darkroom ${update.version} is available (you have ${current}): ${update.command}`);
});
// Speech costs that were still being looked up when the server (or CLI) stopped last time
if (hasApiKey()) void retryMissingCosts().catch(() => {});

// First Ctrl+C: abort running work and shut down cleanly (pending cost lookups are not waited for: they are retried
// at the next start). Second one: quit right away.
const onSignal = signalHandler(
  () => {
    console.log('Stopping darkroom… (press Ctrl+C again to quit immediately)');
    void app.close().then(() => process.exit(0));
  },
  (code) => process.exit(code),
);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, onSignal);
