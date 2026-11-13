import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PrivacyMode } from './contract.ts';
import { AppError } from './errors.ts';

export type { PrivacyMode };

/** Directory of this package's sources (workers are spawned from here). */
export const CORE_SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
/** Repository root: the app itself (presets.json, built web UI). */
const APP_DIR = path.resolve(CORE_SRC_DIR, '..', '..', '..');
/**
 * Data root: holds .env and the private data folders refs/, voices/, out/ and models/.
 * The repository root by default; DARKROOM_HOME moves it elsewhere (e.g. an empty folder for tests).
 */
export const ROOT = path.resolve(process.env.DARKROOM_HOME ?? APP_DIR);

/** Holds OPENROUTER_API_KEY and optional settings (see .env.example). */
export const ENV_FILE = path.join(ROOT, '.env');

try {
  process.loadEnvFile(ENV_FILE);
} catch {
  // no .env present: environment variables are enough
}

export const REFS_DIR = path.resolve(ROOT, process.env.REFS_DIR ?? 'refs');
export const OUT_DIR = path.resolve(ROOT, process.env.OUT_DIR ?? 'out');
export const VOICES_DIR = path.resolve(ROOT, process.env.VOICES_DIR ?? 'voices');
export const UPLOADS_DIR = path.join(OUT_DIR, 'uploads');
export const MANIFEST = path.join(OUT_DIR, 'manifest.jsonl');
export const PRESETS_FILE = path.join(APP_DIR, 'presets.json');
/** Built web UI (Vite output: index.html + assets/*); WEB_DIST_DIR overrides it (tests). */
export const WEB_DIST_DIR = path.resolve(process.env.WEB_DIST_DIR ?? path.join(APP_DIR, 'dist', 'web'));

/** Can be changed for tests (e.g. to a local mock), otherwise OpenRouter. */
export const API_BASE = process.env.OPENROUTER_BASE ?? 'https://openrouter.ai/api/v1';
export const PORT = Number(process.env.PORT ?? 5177);
/** Longest side of reference images before sending. */
export const REF_MAX_SIDE = Number(process.env.REF_MAX_SIDE ?? 1024);
/** Generations can take > 90 s. */
export const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS ?? 300_000);
/** Transcription of voice samples: "local" (Whisper offline) or "api" (OpenRouter, with ZDR). */
export const TRANSCRIBE_ENGINE = process.env.TRANSCRIBE === 'api' ? 'api' : 'local';
export const TRANSCRIBE_MODEL = process.env.TRANSCRIBE_MODEL ?? 'openai/whisper-large-v3-turbo';
export const DEFAULT_MODEL = process.env.DEFAULT_MODEL ?? 'google/gemini-3.1-flash-image';

export const DEFAULT_PRIVACY: PrivacyMode = parsePrivacy(process.env.PRIVACY) ?? 'zdr';

export function parsePrivacy(v: unknown): PrivacyMode | undefined {
  return v === 'zdr' || v === 'zdr-strict' || v === 'off' ? v : undefined;
}

export function hasApiKey(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

export function apiKey(): string {
  const k = process.env.OPENROUTER_API_KEY;
  if (!k) {
    throw new AppError(
      'api_key_missing',
      `OPENROUTER_API_KEY is missing. Enter it in the web UI (darkroom start), add it to ${ENV_FILE} or set it as an environment variable.`,
    );
  }
  return k;
}

/** Absolute path of a file below out/; throws for paths that would leave out/. */
export function resolveOut(rel: string): string {
  const p = path.resolve(OUT_DIR, rel);
  if (!p.startsWith(OUT_DIR + path.sep)) throw new AppError('invalid_path', `Invalid path: ${rel}`, { path: rel });
  return p;
}
