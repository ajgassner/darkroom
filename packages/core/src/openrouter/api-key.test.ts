import fs from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeOpenRouter, json } from '../../test/fake-openrouter.ts';
import { ENV_FILE } from '../config.ts';
import { saveApiKey, withEnvValue } from './api-key.ts';

const original = process.env.OPENROUTER_API_KEY;
afterEach(async () => {
  process.env.OPENROUTER_API_KEY = original;
  await fs.rm(ENV_FILE, { force: true });
});

describe('withEnvValue', () => {
  it('replaces an existing line and keeps the others', () => {
    expect(withEnvValue('PORT=1\nOPENROUTER_API_KEY=old\n', 'OPENROUTER_API_KEY', 'new')).toBe(
      'PORT=1\nOPENROUTER_API_KEY=new\n',
    );
  });

  it('appends to files with or without a final newline', () => {
    expect(withEnvValue('', 'K', 'v')).toBe('K=v\n');
    expect(withEnvValue('PORT=1', 'K', 'v')).toBe('PORT=1\nK=v\n');
    expect(withEnvValue('# comment\n', 'K', 'v')).toBe('# comment\nK=v\n');
  });
});

describe('saveApiKey', () => {
  it('checks the key with OpenRouter, stores it in .env and uses it right away', async () => {
    const fake = fakeOpenRouter();
    await fs.writeFile(ENV_FILE, '# settings\nPORT=5177\n');
    await saveApiKey('  sk-or-v1-abc  ');
    expect(fake.callsTo('/key')).toHaveLength(1);
    expect(await fs.readFile(ENV_FILE, 'utf8')).toBe('# settings\nPORT=5177\nOPENROUTER_API_KEY=sk-or-v1-abc\n');
    expect((await fs.stat(ENV_FILE)).mode & 0o777).toBe(0o600);
    expect(process.env.OPENROUTER_API_KEY).toBe('sk-or-v1-abc');
  });

  it('rejects keys OpenRouter does not know, and malformed input, without storing anything', async () => {
    fakeOpenRouter({ key: json({ error: { message: 'No auth credentials found' } }, { status: 401 }) });
    await expect(saveApiKey('sk-or-v1-wrong')).rejects.toMatchObject({ code: 'api_key_invalid' });
    await expect(saveApiKey('two words')).rejects.toMatchObject({ code: 'api_key_invalid' });
    await expect(fs.access(ENV_FILE)).rejects.toThrow();
    expect(process.env.OPENROUTER_API_KEY).toBe(original);
  });

  it('reports when OpenRouter cannot check the key', async () => {
    fakeOpenRouter({ key: json({}, { status: 502 }) });
    await expect(saveApiKey('sk-or-v1-abc')).rejects.toMatchObject({ code: 'api_key_unchecked' });
  });
});
