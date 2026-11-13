// Runs before every node test file: each file gets its own empty data folder, a fake API key and an
// unreachable API base, so tests can never touch the real refs/, out/, voices/ or .env, nor call OpenRouter.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'darkroom-test-'));

process.env.DARKROOM_HOME = home;
// No built web UI in tests (the server then shows its "UI not built yet" page)
process.env.WEB_DIST_DIR = path.join(home, 'no-web-build');
for (const key of [
  'OUT_DIR',
  'REFS_DIR',
  'VOICES_DIR',
  'PORT',
  'PRIVACY',
  'DEFAULT_MODEL',
  'REF_MAX_SIDE',
  'TRANSCRIBE',
]) {
  delete process.env[key];
}
process.env.OPENROUTER_API_KEY = 'test-key';
process.env.OPENROUTER_BASE = 'http://openrouter.test/api/v1';
process.env.LOG_LEVEL = 'silent';
// No update check against GitHub (tests that cover it switch it on)
process.env.DARKROOM_UPDATE_CHECK = 'off';

afterAll(() => fs.rmSync(home, { recursive: true, force: true }));
