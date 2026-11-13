// Setting the OpenRouter API key from the UI: checked with OpenRouter, then stored in the .env of the data folder.
import fs from 'node:fs/promises';
import path from 'node:path';
import { API_BASE, ENV_FILE } from './config.ts';
import { AppError } from './errors.ts';

const invalidKey = () => new AppError('api_key_invalid', 'OpenRouter rejected this API key.');

/** OpenRouter answers GET /key with the key's details, or 401 for an unknown key. */
async function verifyApiKey(key: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/key`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new AppError('api_key_unchecked', 'OpenRouter could not be reached to check the API key.');
  }
  if (res.status === 401 || res.status === 403) throw invalidKey();
  if (!res.ok) {
    throw new AppError('api_key_unchecked', `OpenRouter could not check the API key (HTTP ${res.status}).`, {
      status: res.status,
    });
  }
}

/** .env text with `name` set to `value`: replaces an existing line, otherwise appends one. */
export function withEnvValue(text: string, name: string, value: string): string {
  const line = `${name}=${value}`;
  const lines = text.split('\n');
  const i = lines.findIndex((l) => l.startsWith(`${name}=`));
  if (i >= 0) {
    lines[i] = line;
    return lines.join('\n');
  }
  return `${text}${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`;
}

/** Check the key, store it in .env (readable only by the user) and use it right away, without a restart. */
export async function saveApiKey(input: string): Promise<void> {
  const key = input.trim();
  if (!key || /\s/.test(key)) throw invalidKey();
  await verifyApiKey(key);
  const text = await fs.readFile(ENV_FILE, 'utf8').catch(() => '');
  await fs.mkdir(path.dirname(ENV_FILE), { recursive: true });
  await fs.writeFile(ENV_FILE, withEnvValue(text, 'OPENROUTER_API_KEY', key), { mode: 0o600 });
  await fs.chmod(ENV_FILE, 0o600);
  process.env.OPENROUTER_API_KEY = key;
}
